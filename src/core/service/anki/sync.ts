import { AnkiActionError, AnkiOffline, type AnkiClient } from '../../anki/client.js';
import type { AnkiMirror, MirrorCard } from '../../anki/mirror.js';
import {
  hasTag,
  kcsOfTags,
  NOTE_TYPES,
  plainText,
  ROOT_DECK,
  subjectOfTags,
  TAG,
  CARD_CSS,
} from '../../anki/notes.js';
import type { Warnings } from '../../envelope.js';
import type { EventDraft, Scaffold } from '../scaffold.js';
import type { QueuedOp } from '../../anki/queue.js';
import { EditedInAnki, GUARDED_UPDATE, guardedUpdate } from './cards.js';
import { clientFor, queueFor, readMirror, writeMirror } from './context.js';
import { budgetPass } from './ops.js';
import { reviewByFlags } from './stale.js';

// ANK-08 sync and ANK-09 replay. Order: version check → replay queued operations once each →
// note types and subject decks → pull cards and notes into the mirror → import new reviews as
// `anki_reviews_imported` (lapse = "Again" on a card in review state) → new leech / check tags →
// volatile KCs past review_by.

interface CardInfo {
  cardId: number;
  note: number;
  deckName: string;
  modelName?: string;
  fields?: Record<string, { value: string; order: number }>;
  interval?: number;
  type?: number;
  queue?: number;
  due?: number;
  reps?: number;
  lapses?: number;
  /** Not documented by AnkiConnect; used when present (home deck of a card in a filtered deck). */
  originalDeckName?: string;
  odid?: number;
}

interface NoteInfo {
  noteId: number;
  tags: string[];
  mod?: number;
  modelName?: string;
}

interface RevlogEntry {
  id: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  time: number;
  type: number;
}

export interface SyncReport {
  online: boolean;
  api_version: number | null;
  replayed: { applied: number; failed: number; still_queued: number };
  created: { decks: string[]; note_types: string[] };
  cards: number;
  reviews_imported: number;
  lapses: number;
  flags: { leech: number; check: number; review_by: number };
  /** Budget proposals made after the sync (ANK-06) and new cards suspended during a pause. */
  budget: { proposed: string[]; paused_new: number };
  next_step?: string;
}

const chunks = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** A queued addNotes that Anki now rejects as a duplicate was applied before: done, not failed. */
const isDuplicate = (e: unknown): boolean => e instanceof AnkiActionError && /duplicate/i.test(e.message);

async function replayQueue(sc: Scaffold, client: AnkiClient, w: Warnings): Promise<SyncReport['replayed']> {
  const q = queueFor(sc);
  const out = { applied: 0, failed: 0, still_queued: 0 };
  const drafts: EventDraft[] = [];
  const record = (
    op: QueuedOp,
    result: 'applied' | 'aborted',
    detail: string,
    created: number[] = [],
  ): void => {
    const actionId = typeof op.context.action_id === 'string' ? op.context.action_id : null;
    const quote = typeof op.context.approval_quote === 'string' ? op.context.approval_quote : null;
    if (!actionId || !quote || (result === 'applied' && op.context.final !== true)) return;
    drafts.push({
      type: 'card_action_applied',
      action_id: actionId,
      approval: { learner_quote: quote },
      result,
      detail: detail.slice(0, 200),
      created_note_ids: created,
    });
  };
  // Each file is renamed to .done (or .failed) right after Anki answers, so an operation runs once.
  for (const { file, op } of q.pending()) {
    try {
      const result =
        op.action === GUARDED_UPDATE
          ? await guardedUpdate(client, op.params)
          : await client.invoke(op.action, op.params);
      q.markDone(file);
      out.applied++;
      const created =
        op.action === 'addNotes' && Array.isArray(result)
          ? result.filter((x): x is number => typeof x === 'number')
          : [];
      record(op, 'applied', 'replayed from the offline queue', created);
    } catch (e) {
      if (e instanceof AnkiOffline) {
        out.still_queued = q.count();
        break;
      }
      if (isDuplicate(e)) {
        // a queued addNotes that already went through before: applied, not failed
        q.markDone(file);
        out.applied++;
        record(op, 'applied', 'already in Anki (duplicate on replay)');
        continue;
      }
      const msg = (e as Error).message;
      q.markFailed(file, msg);
      out.failed++;
      record(op, 'aborted', e instanceof EditedInAnki ? msg : `Anki rejected ${op.action}: ${msg}`);
      w.add(`Queued ${op.action} was not applied and will not be retried: ${msg}`);
    }
  }
  sc.emit(drafts);
  return out;
}

async function ensureStructure(sc: Scaffold, client: AnkiClient): Promise<SyncReport['created']> {
  const created = { decks: [] as string[], note_types: [] as string[] };
  const models = await client.invoke<string[]>('modelNames');
  for (const t of Object.values(NOTE_TYPES)) {
    if (models.includes(t.modelName)) continue;
    await client.invoke('createModel', {
      modelName: t.modelName,
      inOrderFields: [...t.inOrderFields],
      css: CARD_CSS,
      isCloze: t.isCloze,
      cardTemplates: t.cardTemplates.map((c) => ({ ...c })),
    });
    created.note_types.push(t.modelName);
  }
  const decks = new Set(await client.invoke<string[]>('deckNames'));
  for (const deck of [ROOT_DECK, ...sc.subjects().map((s) => s.anki_deck ?? `${ROOT_DECK}::${s.title}`)]) {
    if (decks.has(deck)) continue;
    await client.invoke('createDeck', { deck });
    decks.add(deck);
    created.decks.push(deck);
  }
  return created;
}

function homeDeck(info: CardInfo, subject: string | null, deckOf: Map<string, string>): string {
  if (info.originalDeckName) return info.originalDeckName;
  if (info.deckName.startsWith(`${ROOT_DECK}::`) || info.deckName === ROOT_DECK) return info.deckName;
  // In a filtered deck and AnkiConnect did not report the home deck: judge it by its subject tag.
  return (subject && deckOf.get(subject)) ?? info.deckName;
}

export function toMirrorCard(
  info: CardInfo,
  note: NoteInfo | undefined,
  deckOf: Map<string, string>,
): MirrorCard {
  const tags = note?.tags ?? [];
  const entries = Object.entries(info.fields ?? {}).sort(([, a], [, b]) => a.order - b.order);
  const fields = Object.fromEntries(entries.map(([k, v]) => [k, v.value]));
  const subject = subjectOfTags(tags);
  const kcs = kcsOfTags(tags);
  const kcField = plainText(fields.KC_ID ?? '');
  return {
    card_id: info.cardId,
    note_id: info.note,
    deck: info.deckName,
    home_deck: homeDeck(info, subject, deckOf),
    subject,
    kc_ids: kcs.length ? kcs : kcField ? kcField.split(/[\s,]+/).filter(Boolean) : [],
    anchor: hasTag(tags, TAG.anchor),
    tags,
    model: info.modelName ?? note?.modelName ?? '',
    fields,
    front: plainText(entries[0]?.[1].value ?? ''),
    back: plainText(entries[1]?.[1].value ?? ''),
    interval: info.interval ?? 0,
    queue: info.queue ?? 0,
    type: info.type ?? 0,
    lapses: info.lapses ?? 0,
    reps: info.reps ?? 0,
    suspended: info.queue === -1,
    due: info.due ?? 0,
    note_mod: note?.mod ?? 0,
  };
}

const inactiveCard = (c: MirrorCard): boolean =>
  c.suspended && (hasTag(c.tags, TAG.dormant) || c.tags.some((t) => t.toLowerCase().startsWith('retired::')));

/** Pulls every `tag:scaffold` card; returns the new mirror and the cards' revlogs. */
async function pull(
  sc: Scaffold,
  client: AnkiClient,
  apiVersion: number,
): Promise<{ mirror: AnkiMirror; revlog: Map<number, RevlogEntry[]> }> {
  const deckOf = new Map(sc.subjects().map((s) => [s.id, s.anki_deck ?? `${ROOT_DECK}::${s.title}`]));
  const ids = await client.invoke<number[]>('findCards', { query: 'tag:scaffold' });
  const infos: CardInfo[] = [];
  for (const part of chunks(ids, 500))
    infos.push(...(await client.invoke<CardInfo[]>('cardsInfo', { cards: part })));
  const noteIds = [...new Set(infos.map((c) => c.note))];
  const notes = new Map<number, NoteInfo>();
  for (const part of chunks(noteIds, 500))
    for (const n of await client.invoke<NoteInfo[]>('notesInfo', { notes: part }))
      if (n?.noteId) notes.set(n.noteId, n);
  const revlog = new Map<number, RevlogEntry[]>();
  for (const part of chunks(ids, 500)) {
    const r = await client.invoke<Record<string, RevlogEntry[]>>('getReviewsOfCards', {
      cards: part.map(String),
    });
    for (const [k, v] of Object.entries(r ?? {})) revlog.set(Number(k), v ?? []);
  }
  const monthAgo = sc.now().getTime() - 30 * 86_400_000;
  const recent = [...revlog.values()].flat().filter((r) => r.id >= monthAgo && r.time > 0);
  const avg = recent.length ? recent.reduce((a, r) => a + r.time, 0) / recent.length / 1000 : null;
  let fsrs: boolean | null = null;
  try {
    const conf = await client.invoke<Record<string, unknown> | false>('getDeckConfig', { deck: ROOT_DECK });
    if (conf && typeof conf === 'object') {
      if (typeof conf.fsrs === 'boolean') fsrs = conf.fsrs;
      else if (
        ['fsrsWeights', 'fsrsParams5', 'fsrsParams6'].some(
          (k) => Array.isArray(conf[k]) && (conf[k] as unknown[]).length > 0,
        )
      )
        fsrs = true;
    }
  } catch {
    fsrs = null;
  }
  const mirror: AnkiMirror = {
    synced_at: sc.vault.nowIso(),
    api_version: apiVersion,
    cards: infos.map((i) => toMirrorCard(i, notes.get(i.note), deckOf)).sort((a, b) => a.card_id - b.card_id),
    avg_seconds_per_review: avg === null ? null : Math.min(120, Math.max(1, Math.round(avg * 10) / 10)),
    fsrs_enabled: fsrs,
    decks: (await client.invoke<string[]>('deckNames')).sort(),
  };
  return { mirror, revlog };
}

export async function ankiSync(sc: Scaffold, w: Warnings): Promise<SyncReport> {
  const client = clientFor(sc);
  const cfg = sc.cfg().anki;
  let version: number;
  try {
    version = await client.invoke<number>('version');
  } catch (e) {
    if (!(e instanceof AnkiOffline)) throw e;
    const queued = queueFor(sc).count();
    return {
      online: false,
      api_version: null,
      replayed: { applied: 0, failed: 0, still_queued: queued },
      created: { decks: [], note_types: [] },
      cards: readMirror(sc)?.cards.length ?? 0,
      reviews_imported: 0,
      lapses: 0,
      flags: { leech: 0, check: 0, review_by: 0 },
      budget: { proposed: [], paused_new: 0 },
      next_step: `Anki is not answering at ${e.url}. Open Anki (with AnkiConnect, add-on 2055492159) and run \`scaffold anki sync\`; ${queued} operation(s) wait in the queue.`,
    };
  }
  if (version < cfg.api_version)
    w.add(
      `AnkiConnect reports API version ${version}; Scaffold expects ${cfg.api_version}. Update the AnkiConnect add-on.`,
    );
  // Flag first, so the queued `scaffold::check` tags go out in this sync's replay.
  const reviewBy = reviewByFlags(sc, w);
  const replayed = await replayQueue(sc, client, w);
  const created = await ensureStructure(sc, client);
  const prev = readMirror(sc);
  const { mirror, revlog } = await pull(sc, client, version);
  writeMirror(sc, mirror);

  const facts = sc.facts();
  const byCard = new Map(mirror.cards.map((c) => [c.card_id, c]));
  const reviews: Record<string, unknown>[] = [];
  let lapses = 0;
  for (const [cardId, entries] of [...revlog].sort(([a], [b]) => a - b)) {
    const c = byCard.get(cardId);
    if (!c) continue;
    for (const r of [...entries].sort((a, b) => a.id - b.id)) {
      if (facts.anki_review_ids[`${r.id}:${cardId}`]) continue;
      // A lapse is "Again" (ease 1) on a card in review state (revlog type 1). Dormant and retired
      // cards produce no signal (LM-09).
      const lapse = r.ease === 1 && r.type === 1 && !inactiveCard(c);
      if (lapse) lapses++;
      reviews.push({
        review_id: r.id,
        card_id: cardId,
        note_id: c.note_id,
        kc_ids: c.kc_ids,
        subject: c.subject,
        anchor: c.anchor,
        ease: r.ease,
        revlog_type: r.type,
        ivl: r.ivl,
        last_ivl: r.lastIvl,
        time_ms: Math.max(0, r.time),
        ts: new Date(r.id).toISOString(),
        lapse,
      });
    }
  }
  const prevTags = new Map((prev?.cards ?? []).map((c) => [c.note_id, c.tags]));
  const flaggedNotes = new Set(facts.card_flags.map((f) => f.note_id));
  const flags: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  for (const c of mirror.cards) {
    if (seen.has(c.note_id) || inactiveCard(c)) continue;
    seen.add(c.note_id);
    const before = prevTags.get(c.note_id) ?? [];
    if (hasTag(c.tags, TAG.leech) && !hasTag(before, TAG.leech))
      flags.push({ note_id: c.note_id, card_id: c.card_id, kc_ids: c.kc_ids, kind: 'leech' });
    else if (hasTag(c.tags, TAG.check) && !hasTag(before, TAG.check) && !flaggedNotes.has(c.note_id))
      flags.push({ note_id: c.note_id, card_id: c.card_id, kc_ids: c.kc_ids, kind: 'check' });
  }
  if (reviews.length || flags.length)
    sc.emit([{ type: 'anki_reviews_imported', since: facts.last_anki_import_ts, reviews, flags }]);
  if (mirror.fsrs_enabled === false) w.add('FSRS is off in Anki: enable it in Deck Options → FSRS (ANK-01).');
  const budget = await budgetPass(sc, w);
  return {
    online: true,
    api_version: version,
    replayed,
    created,
    cards: mirror.cards.length,
    reviews_imported: reviews.length,
    lapses,
    flags: {
      leech: flags.filter((f) => f.kind === 'leech').length,
      check: flags.filter((f) => f.kind === 'check').length,
      review_by: reviewBy,
    },
    budget,
  };
}
