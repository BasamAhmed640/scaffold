import path from 'node:path';
import { z } from 'zod';
import { AnkiOffline, type AnkiClient } from '../../anki/client.js';
import type { MirrorCard } from '../../anki/mirror.js';
import {
  hasTag,
  NOTE_TYPES,
  obsidianLink,
  plainText,
  RETIRE_REASONS,
  ROOT_DECK,
  slugTag,
  TAG,
} from '../../anki/notes.js';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { isEvidenceCorrect } from '../../model/misconceptions.js';
import { wordedAlike } from '../../questions/similarity.js';
import { Actor, KcId, SessionId } from '../../schemas/common.js';
import { Admission, CARD_ACTION_KINDS, type CardActionKind } from '../../schemas/events.js';
import { localDate } from '../../time.js';
import { conceptRel } from '../../vault/vault.js';
import { loadBank } from '../bank.js';
import type { EventDraft, Scaffold } from '../scaffold.js';
import { allocIds, clientFor, loadFor, queueFor, readMirror } from './context.js';

// TP-14 / ANK-03 proposals, TP-17 / ANK-04 card actions and flags. Every state change is a
// proposal; nothing reaches Anki without the learner's approval, quoted in the event. Notes are
// never deleted, nor decks (no delete action is ever sent); retirement and dormancy suspend and tag.

const CardInput = z.object({
  kc_id: KcId,
  note_type: z.enum(['basic', 'cloze']).default('basic'),
  front: z.string().min(3).max(1000),
  back: z.string().max(1000).default(''),
  extra: z.string().max(1000).default(''),
  anchor: z.boolean().default(false),
  admission: Admission,
});

export const ProposeCardsInput = z.object({
  session_id: SessionId.optional(),
  cards: z.array(CardInput).min(1).max(6),
  by: Actor.default('tutor'),
});

const cardsOfKc = (cards: MirrorCard[], kc: string, noteIds: number[] = []): MirrorCard[] =>
  cards.filter((c) => c.kc_ids.includes(kc) || noteIds.includes(c.note_id));
const retired = (c: MirrorCard): boolean => c.tags.some((t) => t.toLowerCase().startsWith('retired::'));

/** ANK-02 card rules that code can check: atomic, one answer, no lists, unlike the tutor's questions. */
export function lintCard(c: z.infer<typeof CardInput>, stems: string[]): string[] {
  const issues: string[] = [];
  const back = plainText(c.back);
  if (c.note_type === 'cloze') {
    const numbers = new Set([...c.front.matchAll(/\{\{c(\d+)::/g)].map((m) => m[1]));
    if (numbers.size === 0) issues.push('a cloze card needs one {{c1::…}} deletion');
    if (numbers.size > 1) issues.push('one cloze deletion per card (atomic, ANK-02)');
  } else if (!back) issues.push('the back is empty');
  const lines = back.split(/\n/).filter((l) => l.trim());
  if (lines.length > 2 || /^\s*([-*•]|\d+[.)])\s/m.test(back))
    issues.push('the back is a list; one retrievable answer per card (ANK-02)');
  else if ((back.match(/,/g)?.length ?? 0) >= 3)
    issues.push('the back looks like a set of items; split it or test the idea instead (ANK-02)');
  const similar = stems.find((s) => wordedAlike(plainText(c.front), s));
  if (similar)
    issues.push(
      `the front is worded like a tutor question ("${similar.slice(0, 60)}…"); word cards differently (QB-01 item 6)`,
    );
  return issues;
}

export function proposeCards(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = ProposeCardsInput.parse(raw);
  const facts = sc.facts();
  const cfg = sc.cfg().anki;
  const session = input.session_id ? facts.sessions[input.session_id] : sc.openSession();
  if (!session)
    throw new ScaffoldError(
      'no_open_session',
      'Cards are proposed during a session, after a correct retrieval of the KC (TP-14).',
      'Start or resume a session, retrieve the KC correctly, then propose.',
    );
  const mirror = readMirror(sc);
  const cards = mirror?.cards ?? [];
  const load = loadFor(sc, mirror);
  const bank = loadBank(sc).entries.map((e) => e.question);
  const errors: string[] = [];
  const pendingAdds = Object.values(facts.card_actions).filter((a) => a.kind === 'add' && a.result === null);
  const pendingFor = (kc: string) =>
    pendingAdds
      .map((a) => facts.card_proposals[String(a.payload.proposal_id)])
      .filter((p) => p && p.kc_id === kc);
  const batchBySubject = new Map<string, number>();
  input.cards.forEach((c, i) => {
    const at = `card ${i + 1} (${c.kc_id})`;
    const kc = facts.kcs[c.kc_id];
    if (!kc) {
      errors.push(`${at}: unknown KC.`);
      return;
    }
    const subject = facts.subjects[kc.fields.subject];
    if (subject?.fields.scope !== 'active') {
      errors.push(
        `${at}: its subject ${kc.fields.subject} is ${subject?.fields.scope ?? 'missing'}; cards go to active subjects only.`,
      );
      return;
    }
    const retrieved = Object.values(facts.attempts).some(
      (a) => a.session_id === session.id && a.kc_ids.includes(c.kc_id) && isEvidenceCorrect(a),
    );
    if (!retrieved)
      errors.push(
        `${at}: no card before a correct, unassisted retrieval of ${c.kc_id} in this session (TP-14).`,
      );
    const existing = cardsOfKc(cards, c.kc_id, kc.fields.anki_note_ids).filter((x) => !retired(x));
    const existingNotes = new Set(existing.map((x) => x.note_id));
    const pending = pendingFor(c.kc_id);
    const inBatch = input.cards.slice(0, i + 1).filter((x) => x.kc_id === c.kc_id);
    const total = existingNotes.size + pending.length + inBatch.length;
    if (total > cfg.max_cards_per_kc)
      errors.push(
        `${at}: ${c.kc_id} would have ${total} cards; the cap is ${cfg.max_cards_per_kc} per KC (ANK-03).`,
      );
    const hasAnchor = existing.some((x) => x.anchor) || pending.some((p) => p!.anchor);
    const batchAnchors = input.cards.filter((x) => x.kc_id === c.kc_id && x.anchor).length;
    if (c.anchor && (hasAnchor || batchAnchors > 1))
      errors.push(`${at}: ${c.kc_id} already has an anchor card; exactly one per KC (ANK-01).`);
    if (!c.anchor && !hasAnchor && batchAnchors === 0)
      errors.push(
        `${at}: the first card of ${c.kc_id} must be its anchor (anchor: true on its most central fact).`,
      );
    const stems = bank.filter((q) => q.kc_ids.includes(c.kc_id)).map((q) => q.stem);
    for (const issue of lintCard(c, stems)) errors.push(`${at}: ${issue}.`);
    batchBySubject.set(kc.fields.subject, (batchBySubject.get(kc.fields.subject) ?? 0) + 1);
  });
  for (const [subject, n] of batchBySubject) {
    const row = load.subjects.find((r) => r.subject === subject);
    if (!row) continue;
    const pendingN = pendingAdds.filter((a) => a.subject === subject).length;
    if (row.intake.used + pendingN + n > row.intake.budget)
      errors.push(
        `${subject}: over its yearly intake budget (${row.intake.used + pendingN} of ${row.intake.budget} cards used; anki_minutes × 365 ÷ ${cfg.card_lifetime_minutes}, ANK-06).`,
      );
    else if (row.intake.warn) {
      const thisSession = Object.values(facts.card_proposals).filter(
        (p) => p.session_id === session.id && p.subject === subject,
      ).length;
      if (thisSession + n > 1)
        errors.push(
          `${subject}: past ${Math.round(cfg.intake_warn_fraction * 100)} % of its yearly intake, at most one card per session (ANK-06).`,
        );
    }
  }
  if (errors.length)
    throw new ScaffoldError(
      'card_rejected',
      errors.join(' '),
      'Fix the listed cards and propose again; nothing was saved.',
    );

  const pIds = allocIds(sc, 'P', input.cards.length);
  const aIds = allocIds(sc, 'CA', input.cards.length);
  const vaultName = path.basename(sc.vault.root);
  const today = localDate(sc.now(), sc.tz());
  const drafts: EventDraft[] = [];
  const out = input.cards.map((c, i) => {
    const kc = facts.kcs[c.kc_id]!;
    const extra =
      kc.fields.volatility === 'volatile' && !/\bas of\b/i.test(c.extra)
        ? `${c.extra}${c.extra ? ' · ' : ''}as of ${today}`
        : c.extra;
    const link = obsidianLink(vaultName, conceptRel(c.kc_id));
    drafts.push({
      type: 'card_proposed',
      proposal_id: pIds[i],
      session_id: session.id,
      kc_id: c.kc_id,
      subject: kc.fields.subject,
      note_type: c.note_type,
      front: c.front,
      back: c.back,
      extra,
      anchor: c.anchor,
      admission: c.admission,
      link,
    });
    drafts.push({
      type: 'card_action_proposed',
      action_id: aIds[i],
      kind: 'add',
      subject: kc.fields.subject,
      kc_ids: [c.kc_id],
      note_ids: [],
      card_ids: [],
      reason: `new ${c.anchor ? 'anchor ' : ''}card for ${c.kc_id}`,
      payload: { proposal_id: pIds[i] },
      by: input.by,
    });
    return {
      proposal_id: pIds[i]!,
      action_id: aIds[i]!,
      kc_id: c.kc_id,
      anchor: c.anchor,
      front: c.front,
      back: c.back,
      extra,
    };
  });
  sc.emit(drafts);
  const row = load.subjects.find((r) => r.subject === facts.kcs[input.cards[0]!.kc_id]!.fields.subject);
  if (row?.intake.warn)
    w.add(
      `Yearly intake for ${row.subject} is past ${Math.round(cfg.intake_warn_fraction * 100)} %: one card per session from now on.`,
    );
  return {
    proposals: out,
    next_step:
      'Show each card to the learner. Apply only the ones they approve (or edit) with apply_card_actions and their words as approval.',
  };
}

// ---- card actions -------------------------------------------------------------------------------

const ActionInput = z.object({
  kind: z.enum(
    CARD_ACTION_KINDS.filter((k) => k !== 'add') as [
      Exclude<CardActionKind, 'add'>,
      ...Exclude<CardActionKind, 'add'>[],
    ],
  ),
  note_ids: z.array(z.number().int()).max(2000).default([]),
  subject: z.string().max(80).nullish(),
  reason: z.string().min(3).max(500),
  /** rewrite / rewrite_reset: new field values; retire: retire_reason; compress: anchor fields. */
  fields: z.record(z.string(), z.string().max(4000)).optional(),
  retire_reason: z.enum(RETIRE_REASONS).optional(),
});

export const ProposeActionsInput = z.object({
  actions: z.array(ActionInput).min(1).max(20),
  by: Actor.default('tutor'),
});

export function proposeCardActions(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = ProposeActionsInput.parse(raw);
  const mirror = readMirror(sc);
  const byNote = new Map<number, MirrorCard[]>();
  for (const c of mirror?.cards ?? []) byNote.set(c.note_id, [...(byNote.get(c.note_id) ?? []), c]);
  const facts = sc.facts();
  const errors: string[] = [];
  input.actions.forEach((a, i) => {
    const at = `action ${i + 1} (${a.kind})`;
    const subjectWide = a.kind === 'pause_new' || a.kind === 'unpause_new';
    if (subjectWide && !(a.subject && facts.subjects[a.subject]))
      errors.push(`${at}: needs an existing subject.`);
    if (!subjectWide && a.note_ids.length === 0) errors.push(`${at}: needs note_ids.`);
    for (const n of a.note_ids)
      if (!byNote.has(n)) errors.push(`${at}: note ${n} is not in the Anki mirror; run anki sync first.`);
    if ((a.kind === 'rewrite' || a.kind === 'rewrite_reset') && !a.fields)
      errors.push(`${at}: give the new field values in fields.`);
  });
  if (errors.length)
    throw new ScaffoldError(
      'action_rejected',
      errors.join(' '),
      'Fix the listed actions; nothing was saved.',
    );
  const ids = allocIds(sc, 'CA', input.actions.length);
  const drafts: EventDraft[] = input.actions.map((a, i) => {
    const cards = a.note_ids.flatMap((n) => byNote.get(n) ?? []);
    const subject = a.subject ?? cards[0]?.subject ?? null;
    return {
      type: 'card_action_proposed',
      action_id: ids[i],
      kind: a.kind,
      subject,
      kc_ids: [...new Set(cards.flatMap((c) => c.kc_ids))].sort(),
      note_ids: a.note_ids,
      card_ids: cards.map((c) => c.card_id),
      reason: a.reason,
      payload: {
        ...(a.fields ? { fields: a.fields } : {}),
        ...(a.retire_reason ? { retire_reason: a.retire_reason } : {}),
        // Edits made in Anki after this point win: the rewrite is aborted (ANK-08).
        base_mod: Object.fromEntries(a.note_ids.map((n) => [String(n), byNote.get(n)?.[0]?.note_mod ?? 0])),
        base_fields: Object.fromEntries(a.note_ids.map((n) => [String(n), byNote.get(n)?.[0]?.fields ?? {}])),
      },
      by: input.by,
    };
  });
  sc.emit(drafts);
  if (input.actions.some((a) => a.kind === 'dormant'))
    w.add('Dormancy keeps memory state; anchors and protected cards should stay active (ANK-06).');
  return {
    actions: ids.map((id, i) => ({
      action_id: id,
      kind: input.actions[i]!.kind,
      note_ids: input.actions[i]!.note_ids,
    })),
    next_step: 'Ask the learner to approve; then call apply_card_actions with their words.',
  };
}

export const ApplyActionsInput = z.object({
  action_ids: z
    .array(z.string().regex(/^CA-\d{4,}$/))
    .min(1)
    .max(20),
  approval: z.object({ learner_quote: z.string().min(1, 'quote the learner’s explicit approval').max(500) }),
  /** Learner edits to proposed new cards, by action id. */
  edits: z
    .record(
      z.string(),
      z.object({
        front: z.string().max(1000).optional(),
        back: z.string().max(1000).optional(),
        extra: z.string().max(1000).optional(),
      }),
    )
    .default({}),
});

interface Step {
  action: string;
  params: Record<string, unknown>;
}

/** Pseudo-action: update fields only if the note is unchanged since the proposal (ANK-08). */
export const GUARDED_UPDATE = 'scaffold.guardedUpdate';

/**
 * Runs steps in order. Once Anki stops answering, this step and the rest are queued (ANK-09); the
 * last queued step carries `final`, so its replay records the action as applied.
 */
export async function execute(
  sc: Scaffold,
  steps: Step[],
  context: Record<string, unknown>,
): Promise<{ queued: boolean; results: unknown[] }> {
  const client = clientFor(sc);
  const q = queueFor(sc);
  const results: unknown[] = [];
  let offline = false;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (!offline) {
      try {
        results.push(
          s.action === GUARDED_UPDATE
            ? await guardedUpdate(client, s.params)
            : await client.invoke(s.action, s.params),
        );
        continue;
      } catch (e) {
        if (!(e instanceof AnkiOffline)) throw e;
        offline = true;
      }
    }
    q.enqueue({
      op_id: sc.vault.ids.eventId(sc.now()),
      created: sc.vault.nowIso(),
      action: s.action,
      params: s.params,
      context: { ...context, ...(i === steps.length - 1 ? { final: true } : {}) },
    });
  }
  return { queued: offline, results };
}

/** A rewrite target was edited in Anki after the proposal: Anki's text wins (ANK-08). */
export class EditedInAnki extends Error {}

/** Updates a note's fields if it is unchanged since the proposal, then resets its cards and clears the check tag. */
export async function guardedUpdate(client: AnkiClient, p: Record<string, unknown>): Promise<null> {
  const note = Number(p.note);
  const [info] = await client.invoke<
    { noteId?: number; mod?: number; fields?: Record<string, { value: string }> }[]
  >('notesInfo', { notes: [note] });
  const base = Number(p.base_mod ?? 0);
  const baseFields = (p.base_fields ?? {}) as Record<string, string>;
  if (!info?.noteId) throw new EditedInAnki(`note ${note} no longer exists in Anki; nothing was changed`);
  const fieldsChanged = Object.entries(baseFields).some(
    ([k, v]) => info.fields?.[k] !== undefined && info.fields[k]!.value !== v,
  );
  if ((base && info.mod !== undefined && info.mod !== base) || fieldsChanged)
    throw new EditedInAnki(
      `note ${note} was edited in Anki after the proposal; Anki's text wins and nothing was overwritten (ANK-08). Re-propose from the current text.`,
    );
  await client.invoke('updateNoteFields', { note: { id: note, fields: p.fields } });
  const forget = (p.forget_cards as number[] | undefined) ?? [];
  if (forget.length) await client.invoke('forgetCards', { cards: forget });
  const remove = (p.remove_tags as string[] | undefined) ?? [];
  if (remove.length) await client.invoke('removeTags', { notes: [note], tags: remove.join(' ') });
  return null;
}

const tagsOf = (cards: MirrorCard[]): string[] => [...new Set(cards.flatMap((c) => c.tags))];
const removeMatching = (cards: MirrorCard[], pred: (t: string) => boolean): string[] =>
  tagsOf(cards).filter(pred);

export async function applyCardActions(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = ApplyActionsInput.parse(raw);
  const facts = sc.facts();
  const mirror = readMirror(sc);
  const cards = mirror?.cards ?? [];
  const byNote = (ids: number[]): MirrorCard[] => cards.filter((c) => ids.includes(c.note_id));
  const today = localDate(sc.now(), sc.tz());
  const results: {
    action_id: string;
    result: 'applied' | 'queued' | 'aborted' | 'skipped';
    detail: string;
    created_note_ids?: number[];
  }[] = [];
  for (const id of input.action_ids) {
    const a = facts.card_actions[id];
    if (!a) {
      results.push({ action_id: id, result: 'skipped', detail: 'unknown action' });
      continue;
    }
    if (a.result === 'applied' || a.result === 'queued') {
      results.push({ action_id: id, result: 'skipped', detail: `already ${a.result}` });
      continue;
    }
    const ctx = { action_id: id, approval_quote: input.approval.learner_quote };
    const noteCards = byNote(a.note_ids);
    const cardIds = noteCards.map((c) => c.card_id);
    let steps: Step[] = [];
    let detail = '';
    let aborted: string | null = null;
    const subject = a.subject ? facts.subjects[a.subject] : undefined;
    switch (a.kind) {
      case 'add': {
        const p = facts.card_proposals[String(a.payload.proposal_id)];
        if (!p) {
          aborted = 'its proposal is missing';
          break;
        }
        const e = input.edits[id] ?? {};
        const t = p.note_type === 'cloze' ? NOTE_TYPES.cloze : NOTE_TYPES.basic;
        const front = e.front ?? p.front;
        const back = e.back ?? p.back;
        const extra = e.extra ?? p.extra;
        const fields =
          p.note_type === 'cloze'
            ? { Text: front, 'Back Extra': back, KC_ID: p.kc_id, Link: p.link, Extra: extra }
            : { Front: front, Back: back, KC_ID: p.kc_id, Link: p.link, Extra: extra };
        const paused =
          !!a.subject &&
          Object.values(facts.card_actions).some(
            (x) =>
              x.subject === a.subject &&
              x.kind === 'pause_new' &&
              (x.result === 'applied' || x.result === 'queued'),
          ) &&
          !Object.values(facts.card_actions).some(
            (x) =>
              x.subject === a.subject &&
              x.kind === 'unpause_new' &&
              (x.result === 'applied' || x.result === 'queued'),
          );
        const tags = [
          TAG.scaffold,
          TAG.subject(p.subject),
          TAG.kc(p.kc_id),
          ...(p.anchor ? [TAG.anchor] : []),
          ...(paused ? [TAG.newPaused] : []),
        ];
        steps = [
          {
            action: 'addNotes',
            params: {
              notes: [
                {
                  deckName:
                    subject?.fields.anki_deck ?? `${ROOT_DECK}::${subject?.fields.title ?? p.subject}`,
                  modelName: t.modelName,
                  fields,
                  tags,
                  options: { allowDuplicate: false, duplicateScope: 'deck' },
                },
              ],
            },
          },
        ];
        detail = `${p.anchor ? 'anchor ' : ''}card for ${p.kc_id}${paused ? ' (new cards paused: it starts suspended on the next sync)' : ''}`;
        break;
      }
      case 'rewrite':
      case 'rewrite_reset': {
        const fields = (a.payload.fields ?? {}) as Record<string, string>;
        const base = (a.payload.base_mod ?? {}) as Record<string, number>;
        const baseFields = (a.payload.base_fields ?? {}) as Record<string, Record<string, string>>;
        for (const n of a.note_ids) {
          const old = byNote([n])[0];
          const backKey = Object.keys(old?.fields ?? {})[1] ?? 'Back';
          const answerChanged =
            fields[backKey] !== undefined && plainText(fields[backKey]!) !== (old?.back ?? '');
          const forget = a.kind === 'rewrite_reset' || answerChanged;
          steps.push({
            action: GUARDED_UPDATE,
            params: {
              note: n,
              fields,
              base_mod: base[String(n)] ?? 0,
              base_fields: baseFields[String(n)] ?? {},
              forget_cards: forget ? byNote([n]).map((c) => c.card_id) : [],
              remove_tags: removeMatching(byNote([n]), (t) => t.toLowerCase() === TAG.check),
            },
          });
          detail += `${detail ? '; ' : ''}note ${n} rewritten${forget ? ' and reset (forgetCards: its memory state belonged to the old answer)' : ''}`;
        }
        break;
      }
      case 'retire': {
        const reason = (a.payload.retire_reason as (typeof RETIRE_REASONS)[number] | undefined) ?? 'outdated';
        steps = [
          { action: 'suspend', params: { cards: cardIds } },
          { action: 'addTags', params: { notes: a.note_ids, tags: TAG.retired(reason) } },
        ];
        const check = removeMatching(noteCards, (t) => t.toLowerCase() === TAG.check);
        if (check.length)
          steps.push({ action: 'removeTags', params: { notes: a.note_ids, tags: check.join(' ') } });
        detail = `${a.note_ids.length} note(s) retired (${reason}); suspended, not deleted`;
        break;
      }
      case 'dormant': {
        const tag = TAG.dormantOn(today, String(a.payload.reason_tag ?? slugTag(a.reason)));
        steps = [
          { action: 'suspend', params: { cards: cardIds } },
          { action: 'addTags', params: { notes: a.note_ids, tags: `${TAG.dormant} ${tag}` } },
        ];
        detail = `${a.note_ids.length} note(s) dormant; memory state kept`;
        break;
      }
      case 'unsuspend': {
        const remove = removeMatching(
          noteCards,
          (t) => t.toLowerCase().startsWith(TAG.dormant) || t.toLowerCase() === TAG.newPaused,
        );
        steps = [{ action: 'unsuspend', params: { cards: cardIds } }];
        if (remove.length)
          steps.push({ action: 'removeTags', params: { notes: a.note_ids, tags: remove.join(' ') } });
        detail = `${a.note_ids.length} note(s) back in rotation`;
        break;
      }
      case 'pause_new': {
        const fresh = cards.filter((c) => c.subject === a.subject && !c.suspended && c.type === 0);
        if (fresh.length) {
          steps = [
            { action: 'suspend', params: { cards: fresh.map((c) => c.card_id) } },
            {
              action: 'addTags',
              params: { notes: [...new Set(fresh.map((c) => c.note_id))], tags: TAG.newPaused },
            },
          ];
        }
        detail = `${fresh.length} new card(s) of ${a.subject} paused; cards added during the pause start paused`;
        break;
      }
      case 'unpause_new': {
        const paused = cards.filter((c) => c.subject === a.subject && hasTag(c.tags, TAG.newPaused));
        if (paused.length) {
          steps = [
            { action: 'unsuspend', params: { cards: paused.map((c) => c.card_id) } },
            {
              action: 'removeTags',
              params: { notes: [...new Set(paused.map((c) => c.note_id))], tags: TAG.newPaused },
            },
          ];
        }
        detail = `${paused.length} paused new card(s) of ${a.subject} unsuspended`;
        break;
      }
      case 'compress': {
        // From the controller: anchor_note_id; proposed by hand: the anchor among the notes given.
        const anchorNote = Number(
          a.payload.anchor_note_id ?? noteCards.find((c) => c.anchor)?.note_id ?? NaN,
        );
        if (!Number.isFinite(anchorNote)) {
          aborted = 'compression needs the KC’s anchor card among the notes';
          break;
        }
        const details = ((a.payload.detail_note_ids as number[] | undefined) ?? a.note_ids).filter(
          (n) => n !== anchorNote,
        );
        const fields =
          (input.edits[id]
            ? { Back: input.edits[id]!.back ?? '' }
            : (a.payload.fields as Record<string, string> | undefined)) ?? null;
        if (fields && Object.values(fields).some((v) => v)) {
          const base = (a.payload.base_mod ?? {}) as Record<string, number>;
          steps.push({
            action: GUARDED_UPDATE,
            params: {
              note: anchorNote,
              fields,
              base_mod: base[String(anchorNote)] ?? byNote([anchorNote])[0]?.note_mod ?? 0,
              forget_cards: [],
              remove_tags: [],
            },
          });
        }
        const detailCards = byNote(details);
        steps.push(
          { action: 'suspend', params: { cards: detailCards.map((c) => c.card_id) } },
          { action: 'addTags', params: { notes: details, tags: TAG.retired('superseded') } },
        );
        detail = `${details.length} detail note(s) folded into anchor ${anchorNote} and retired (superseded)`;
        break;
      }
      case 'keep': {
        const check = removeMatching(noteCards, (t) => t.toLowerCase() === TAG.check);
        if (check.length)
          steps = [{ action: 'removeTags', params: { notes: a.note_ids, tags: check.join(' ') } }];
        detail = 'kept as is; check flag cleared';
        break;
      }
    }
    if (aborted) {
      sc.emit([
        {
          type: 'card_action_applied',
          action_id: id,
          approval: input.approval,
          result: 'aborted',
          detail: aborted,
          created_note_ids: [],
        },
      ]);
      results.push({ action_id: id, result: 'aborted', detail: aborted });
      continue;
    }
    let run: { queued: boolean; results: unknown[] };
    try {
      run = await execute(sc, steps, ctx);
    } catch (e) {
      const why = e instanceof EditedInAnki ? e.message : `Anki rejected it: ${(e as Error).message}`;
      sc.emit([
        {
          type: 'card_action_applied',
          action_id: id,
          approval: input.approval,
          result: 'aborted',
          detail: why.slice(0, 200),
          created_note_ids: [],
        },
      ]);
      results.push({ action_id: id, result: 'aborted', detail: why });
      continue;
    }
    const created =
      a.kind === 'add' && Array.isArray(run.results[0])
        ? (run.results[0] as unknown[]).filter((x): x is number => typeof x === 'number')
        : [];
    if (a.kind === 'add' && !run.queued && created.length === 0) {
      sc.emit([
        {
          type: 'card_action_applied',
          action_id: id,
          approval: input.approval,
          result: 'aborted',
          detail: 'Anki did not create the note (duplicate?)',
          created_note_ids: [],
        },
      ]);
      results.push({
        action_id: id,
        result: 'aborted',
        detail: 'Anki did not create the note (a duplicate of an existing card?)',
      });
      continue;
    }
    const result = run.queued ? 'queued' : 'applied';
    sc.emit([
      {
        type: 'card_action_applied',
        action_id: id,
        approval: input.approval,
        result,
        detail: detail.slice(0, 200),
        created_note_ids: created,
      },
    ]);
    results.push({ action_id: id, result, detail, ...(created.length ? { created_note_ids: created } : {}) });
  }
  if (results.some((r) => r.result === 'queued'))
    w.add('Anki is not answering: approved changes are queued and applied on the next `anki sync` (ANK-09).');
  return { results };
}

// ---- flags --------------------------------------------------------------------------------------

export const FlagCardInput = z.object({
  note_id: z.number().int().optional(),
  kc_ids: z.array(KcId).max(10).optional(),
  reason: z
    .enum([
      'tutor_check',
      'explanation_changed',
      'answer_key_changed',
      'source_changed',
      'review_by_passed',
      'leech',
    ])
    .default('tutor_check'),
  detail: z.string().min(3).max(500),
  proposed: z.enum(['retire', 'rewrite', 'keep', 'check']),
  by: Actor.default('tutor'),
});

export async function flagCard(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = FlagCardInput.parse(raw);
  const mirror = readMirror(sc);
  const cards = mirror?.cards ?? [];
  let notes: number[];
  let kcs = input.kc_ids ?? [];
  if (input.note_id !== undefined) {
    const c = cards.find((x) => x.note_id === input.note_id);
    if (!c && !kcs.length)
      throw new ScaffoldError(
        'unknown_note',
        `Note ${input.note_id} is not in the Anki mirror.`,
        'Run anki sync, or pass kc_ids.',
      );
    notes = [input.note_id];
    if (!kcs.length && c) kcs = c.kc_ids;
  } else if (kcs.length) {
    notes = [
      ...new Set(
        cards.filter((c) => c.kc_ids.some((k) => kcs.includes(k)) && !retired(c)).map((c) => c.note_id),
      ),
    ];
  } else
    throw new ScaffoldError(
      'nothing_to_flag',
      'Pass note_id or kc_ids.',
      'Name the card (note id) or the KC whose cards are wrong.',
    );
  const facts = sc.facts();
  for (const k of kcs) if (!facts.kcs[k]) throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`);
  const drafts: EventDraft[] = (notes.length ? notes : [null]).map((n) => ({
    type: 'card_flagged',
    note_id: n,
    kc_ids: n === null ? kcs : (cards.find((c) => c.note_id === n)?.kc_ids ?? kcs),
    reason: input.reason,
    detail: input.detail,
    proposed: input.proposed,
    by: input.by,
  }));
  sc.emit(drafts);
  let tagged: 'applied' | 'queued' | 'none' = 'none';
  if (notes.length) {
    const r = await execute(sc, [{ action: 'addTags', params: { notes, tags: TAG.check } }], {
      reason: 'flag_card',
    });
    tagged = r.queued ? 'queued' : 'applied';
    if (r.queued) w.add('Anki is not answering: the scaffold::check tag is queued (ANK-09).');
  }
  return {
    flagged: notes,
    kc_ids: kcs,
    tag: tagged,
    next_step:
      'Propose retire, rewrite-and-reset or keep with propose_card_actions, and apply it only after the learner explicitly approves (TP-17).',
  };
}

export function listCardActions(sc: Scaffold, raw: unknown) {
  const input = z.object({ pending_only: z.boolean().default(true) }).parse(raw ?? {});
  const facts = sc.facts();
  const actions = Object.values(facts.card_actions)
    .filter((a) => !input.pending_only || a.result === null)
    .sort((a, b) => a.action_id.localeCompare(b.action_id))
    .map((a) => {
      const p = a.kind === 'add' ? facts.card_proposals[String(a.payload.proposal_id)] : undefined;
      return {
        action_id: a.action_id,
        kind: a.kind,
        subject: a.subject,
        kc_ids: a.kc_ids,
        note_ids: a.note_ids,
        reason: a.reason,
        status: a.result ?? 'pending',
        ...(p ? { card: { front: p.front, back: p.back, anchor: p.anchor } } : {}),
      };
    });
  return { actions };
}
