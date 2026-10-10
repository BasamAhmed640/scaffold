import type { MirrorCard } from '../../anki/mirror.js';
import { hasTag, TAG } from '../../anki/notes.js';
import type { Warnings } from '../../envelope.js';
import { localDate } from '../../time.js';
import type { EventDraft, Scaffold } from '../scaffold.js';
import type { SyncChange } from '../sync.js';
import { queueFor, readMirror } from './context.js';

// ANK-05: a stale card can't be noticed during review, so detection comes from outside the card.
// Linked cards get `scaffold::check` (queued; applied on the next `anki sync`) and a `card_flagged`
// event, which also marks the KC needs_check (LM-09) and lists the card in the briefing.

const inactive = (c: MirrorCard): boolean =>
  c.suspended && (hasTag(c.tags, TAG.dormant) || c.tags.some((t) => t.toLowerCase().startsWith('retired::')));

/** Active linked notes of a KC: note id → the KCs on that note. */
function linkedNotes(cards: MirrorCard[], kc: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const c of cards) if (c.kc_ids.includes(kc) && !inactive(c)) out.set(c.note_id, c.kc_ids);
  return out;
}

type Reason = 'explanation_changed' | 'answer_key_changed' | 'source_changed' | 'review_by_passed';

function flag(
  sc: Scaffold,
  notes: Map<number, string[]>,
  kc: string,
  reason: Reason,
  detail: string,
): EventDraft[] {
  const drafts: EventDraft[] = [];
  const q = queueFor(sc);
  for (const [note, kcs] of notes) {
    drafts.push({
      type: 'card_flagged',
      note_id: note,
      kc_ids: kcs,
      reason,
      detail,
      proposed: 'check',
      by: 'scaffold-core',
    });
    q.enqueue({
      op_id: sc.vault.ids.eventId(sc.now()),
      created: sc.vault.nowIso(),
      action: 'addTags',
      params: { notes: [note], tags: TAG.check },
      context: { reason, kc },
    });
  }
  if (notes.size === 0 && reason === 'review_by_passed')
    drafts.push({
      type: 'card_flagged',
      note_id: null,
      kc_ids: [kc],
      reason,
      detail,
      proposed: 'check',
      by: 'scaffold-core',
    });
  return drafts;
}

/** Flags cards linked to KCs whose Explanation/Worked example, question keys or sources changed. */
export function flagStaleFromChanges(sc: Scaffold, changes: SyncChange[], w: Warnings): number {
  const cards = readMirror(sc)?.cards ?? [];
  if (cards.length === 0) return 0;
  const facts = sc.facts();
  const drafts: EventDraft[] = [];
  for (const ch of changes) {
    if (ch.kind === 'kc_updated') {
      const sections = ch.changed.filter((c) => c.startsWith('section:')).map((c) => c.slice(8));
      const sources = ch.changed.filter((c) => c.startsWith('source:')).map((c) => c.slice(7));
      const notes = linkedNotes(cards, ch.id);
      if (sections.length)
        drafts.push(...flag(sc, notes, ch.id, 'explanation_changed', `${sections.join(', ')} changed`));
      else if (sources.length)
        drafts.push(...flag(sc, notes, ch.id, 'source_changed', `source ${sources.join(', ')} changed`));
    }
    if (ch.kind === 'question_updated' && ch.changed.includes('answer_key'))
      for (const kc of facts.questions[ch.id]?.kc_ids ?? [])
        drafts.push(
          ...flag(sc, linkedNotes(cards, kc), kc, 'answer_key_changed', `answer key of ${ch.id} changed`),
        );
  }
  if (drafts.length) {
    sc.emit(drafts);
    w.add(`${drafts.length} Anki card(s) flagged scaffold::check after vault edits (ANK-05).`);
  }
  return drafts.length;
}

/** Volatile KCs past `review_by` are flagged once per review date (ANK-05). */
export function reviewByFlags(sc: Scaffold, w: Warnings): number {
  const facts = sc.facts();
  const today = localDate(sc.now(), sc.tz());
  const cards = readMirror(sc)?.cards ?? [];
  const drafts: EventDraft[] = [];
  for (const k of Object.values(facts.kcs)) {
    const by = k.fields.review_by;
    if (k.fields.volatility !== 'volatile' || !by || by > today) continue;
    const done = facts.card_flags.some(
      (f) =>
        f.reason === 'review_by_passed' &&
        f.kc_ids.includes(k.fields.id) &&
        localDate(new Date(f.ts), sc.tz()) >= by,
    );
    if (done) continue;
    drafts.push(
      ...flag(
        sc,
        linkedNotes(cards, k.fields.id),
        k.fields.id,
        'review_by_passed',
        `review_by ${by} has passed`,
      ),
    );
  }
  if (drafts.length) {
    sc.emit(drafts);
    w.add(`${drafts.length} volatile KC card flag(s): review_by has passed (ANK-05).`);
  }
  return drafts.length;
}
