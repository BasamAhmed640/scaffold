import type { Config } from '../config.js';
import type { DerivedState } from '../model/derive.js';
import type { LearnerFacts } from '../model/facts.js';
import type { CardActionKind } from '../schemas/events.js';
import type { SubjectFields } from '../schemas/subject.js';
import { DAY_MS, ms } from '../time.js';
import { cardMinutesPerDay, type LoadReport } from './load.js';
import type { AnkiMirror, MirrorCard } from './mirror.js';
import { hasTag, TAG } from './notes.js';
import type { ProtectedSet } from './protected.js';

// ANK-06 active-set controller and ANK-07 goal-scope proposals. Pure: it reads load, mirror and the
// protected set and returns proposals; nothing changes until the learner approves (ANK-04).

export interface ProposedAction {
  kind: CardActionKind;
  subject: string | null;
  kc_ids: string[];
  note_ids: number[];
  card_ids: number[];
  reason: string;
  payload: Record<string, unknown>;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

function summarize(
  kind: CardActionKind,
  subject: string,
  cards: MirrorCard[],
  reason: string,
  payload: Record<string, unknown> = {},
): ProposedAction {
  return {
    kind,
    subject,
    kc_ids: uniq(cards.flatMap((c) => c.kc_ids)).sort(),
    note_ids: uniq(cards.map((c) => c.note_id)),
    card_ids: cards.map((c) => c.card_id),
    reason,
    payload,
  };
}

/** The applied `pause_new` still in force for a subject (no later applied `unpause_new`). */
export function activePause(facts: LearnerFacts, subject: string): { ts: string } | null {
  const applied = Object.values(facts.card_actions)
    .filter(
      (a) =>
        a.subject === subject &&
        a.result === 'applied' &&
        (a.kind === 'pause_new' || a.kind === 'unpause_new'),
    )
    .sort((a, b) => ms(a.applied_ts!) - ms(b.applied_ts!));
  const last = applied.at(-1);
  return last?.kind === 'pause_new' ? { ts: last.applied_ts! } : null;
}

/** Number of KCs that depend on `kc`, transitively (the value side of cost-to-value). */
function dependents(derived: DerivedState): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const k of Object.values(derived.kcs))
    for (const p of k.prerequisites) children.set(p, [...(children.get(p) ?? []), k.id]);
  const out = new Map<string, number>();
  for (const id of Object.keys(derived.kcs)) {
    const seen = new Set<string>();
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(...(children.get(c) ?? []));
    }
    out.set(id, seen.size);
  }
  return out;
}

export interface RankedCard {
  card: MirrorCard;
  cost_min_per_day: number;
  value: number;
  mature: boolean;
}

/** Unprotected active cards of one subject, highest cost-to-value first; mature cards last. */
export function rankForDormancy(
  cards: MirrorCard[],
  protect: ProtectedSet,
  derived: DerivedState,
  cfg: Config,
  secondsPerReview: number,
): RankedCard[] {
  const deps = dependents(derived);
  return cards
    .filter((c) => !c.suspended && !protect.isProtected(c))
    .map((c) => ({
      card: c,
      cost_min_per_day: cardMinutesPerDay(c, cfg, secondsPerReview),
      value: 1 + Math.max(0, ...c.kc_ids.map((k) => deps.get(k) ?? 0)),
      mature: c.interval >= cfg.anki.mature_interval_days,
    }))
    .sort(
      (a, b) =>
        Number(a.mature) - Number(b.mature) ||
        b.cost_min_per_day / b.value - a.cost_min_per_day / a.value ||
        a.card.card_id - b.card.card_id,
    );
}

export interface ControllerInput {
  subjects: SubjectFields[];
  load: LoadReport;
  mirror: AnkiMirror | null;
  protect: ProtectedSet;
  derived: DerivedState;
  facts: LearnerFacts;
  cfg: Config;
  now: Date;
}

/**
 * Over budget (7-day average above the budget): 1. pause the subject's new cards; 2. if still over
 * budget `overbudget_dormancy_days` after the pause, compression for detail cards of solid KCs that
 * passed transfer, then dormancy for unprotected cards by cost-to-value (mature last), as many as
 * the estimate needs to get back under budget. Back under budget while paused: unpause.
 */
export function budgetProposals(input: ControllerInput): ProposedAction[] {
  const { load, mirror, protect, derived, facts, cfg, now } = input;
  const out: ProposedAction[] = [];
  const sec = load.seconds_per_review;
  for (const row of load.subjects.filter((r) => r.scope === 'active')) {
    const cards = (mirror?.cards ?? []).filter((c) => c.subject === row.subject);
    const pause = activePause(facts, row.subject);
    if (!row.over_budget) {
      if (pause) {
        const paused = cards.filter((c) => hasTag(c.tags, TAG.newPaused));
        out.push(
          summarize(
            'unpause_new',
            row.subject,
            paused,
            `${row.subject} is back under its Anki budget (${row.measured_min_7d} ≤ ${row.budget_min} min/day): unsuspend its paused new cards.`,
          ),
        );
      }
      continue;
    }
    if (!pause) {
      const fresh = cards.filter((c) => !c.suspended && c.type === 0);
      out.push(
        summarize(
          'pause_new',
          row.subject,
          fresh,
          `${row.subject} averages ${row.measured_min_7d} min/day in Anki, over its ${row.budget_min} min budget: pause its new cards first (ANK-06).`,
        ),
      );
      continue;
    }
    const days = (now.getTime() - ms(pause.ts)) / DAY_MS;
    if (days < cfg.anki.overbudget_dormancy_days) continue;
    const solidTransfer = new Set(
      Object.values(derived.kcs)
        .filter((k) => k.status === 'solid' && k.tested_transfer)
        .map((k) => k.id),
    );
    const compressible = new Map<string, MirrorCard[]>();
    for (const c of cards)
      if (!c.suspended && !c.anchor && !protect.isProtected(c))
        for (const k of c.kc_ids)
          if (solidTransfer.has(k)) compressible.set(k, [...(compressible.get(k) ?? []), c]);
    const compressed = new Set<number>();
    for (const [kc, details] of [...compressible].sort(([a], [b]) => a.localeCompare(b))) {
      const anchor = cards.find((c) => c.anchor && c.kc_ids.includes(kc));
      if (!anchor) continue;
      for (const d of details) compressed.add(d.card_id);
      out.push(
        summarize(
          'compress',
          row.subject,
          details,
          `${kc} is solid and passed transfer: fold its detail cards into the anchor and retire them (ANK-04).`,
          {
            kc,
            anchor_note_id: anchor.note_id,
            detail_note_ids: uniq(details.map((d) => d.note_id)),
          },
        ),
      );
    }
    const ranked = rankForDormancy(
      cards.filter((c) => !compressed.has(c.card_id)),
      protect,
      derived,
      cfg,
      sec,
    );
    // Over budget is measured; each card's share of the measured time is taken in proportion to its
    // estimated cost. Choose the fewest cards that bring the measured load back under budget.
    const scale = row.estimated_min > 0 ? Math.max(1, row.measured_min_7d / row.estimated_min) : 1;
    let excess = row.measured_min_7d - row.budget_min;
    const chosen: RankedCard[] = [];
    for (const r of ranked) {
      if (excess <= 0 && chosen.length > 0) break;
      chosen.push(r);
      excess -= r.cost_min_per_day * scale;
    }
    if (chosen.length)
      out.push(
        summarize(
          'dormant',
          row.subject,
          chosen.map((r) => r.card),
          `${row.subject} is still over budget ${Math.floor(days)} days after pausing new cards: make the costliest unprotected cards dormant (mature cards last).`,
          {
            ranking: chosen.map((r) => ({
              note_id: r.card.note_id,
              card_id: r.card.card_id,
              cost_min_per_day: Math.round(r.cost_min_per_day * 1000) / 1000,
              value: r.value,
              mature: r.mature,
            })),
            reason_tag: 'over-budget',
          },
        ),
      );
  }
  return out;
}

/** ANK-07: proposals for a scope change. Pause/close: non-anchor, unprotected cards go dormant. Reopen: unsuspend dormant cards. */
export function scopeProposals(
  subject: string,
  from: string,
  to: string,
  input: Pick<ControllerInput, 'mirror' | 'protect'>,
): ProposedAction[] {
  const cards = (input.mirror?.cards ?? []).filter((c) => c.subject === subject);
  if (to !== 'active' && from === 'active') {
    const goDormant = cards.filter((c) => !c.suspended && !c.anchor && !input.protect.isProtected(c));
    if (!goDormant.length) return [];
    return [
      summarize(
        'dormant',
        subject,
        goDormant,
        `${subject} is now ${to}: its non-anchor cards go dormant; anchors and protected cards stay active (ANK-07).`,
        { reason_tag: `subject-${to}` },
      ),
    ];
  }
  if (to === 'active' && from !== 'active') {
    const dormant = cards.filter(
      (c) => c.suspended && hasTag(c.tags, TAG.dormant) && !c.tags.some((t) => t.startsWith('retired::')),
    );
    if (!dormant.length) return [];
    return [
      summarize(
        'unsuspend',
        subject,
        dormant,
        `${subject} is active again: unsuspend its dormant cards (FSRS schedules the overdue ones); its KCs get needs_check (ANK-07).`,
      ),
    ];
  }
  return [];
}
