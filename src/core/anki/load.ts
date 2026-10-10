import type { Config } from '../config.js';
import type { LearnerFacts } from '../model/facts.js';
import type { SubjectFields } from '../schemas/subject.js';
import { DAY_MS, ms } from '../time.js';
import type { AnkiMirror, MirrorCard } from './mirror.js';

// ANK-06: per-subject daily Anki budgets, measured and estimated load, yearly intake, and the
// recommended "This deck" new-card limits (ANK-01). Minutes, not cards.

export interface SubjectLoad {
  subject: string;
  scope: string;
  /** Daily budget in minutes: the subject's number, or its share of what `auto` subjects split. */
  budget_min: number;
  fixed: boolean;
  /** 7-day rolling average from the review log (answer times). */
  measured_min_7d: number;
  /** Σ over active review cards of seconds-per-review ÷ max(interval, 1), plus learning cards. */
  estimated_min: number;
  active_cards: number;
  cards: number;
  /** Unsuspended cards never studied. */
  new_cards: number;
  intake: { used: number; budget: number; remaining: number; warn: boolean };
  recommended_new_per_day: number;
  over_budget: boolean;
}

export interface LoadReport {
  total_budget_min: number;
  seconds_per_review: number;
  /** Cards still active in paused or closed subjects (anchors, protected): off the top of the total. */
  maintenance: { estimated_min: number; measured_min_7d: number; active_cards: number };
  subjects: SubjectLoad[];
  total: { measured_min_7d: number; estimated_min: number; active_cards: number; cards: number };
  recommended_new_total: number;
  warnings: string[];
}

const round = (x: number, d = 1): number => Math.round(x * 10 ** d) / 10 ** d;

/** Expected reviews per day of one card (0 for suspended and new cards). */
export function reviewsPerDay(c: MirrorCard, cfg: Config): number {
  if (c.suspended || c.type === 0) return 0;
  if (c.type === 1 || c.type === 3) return cfg.anki.learning_reviews_per_day;
  return 1 / Math.max(c.interval, 1);
}

export function cardMinutesPerDay(c: MirrorCard, cfg: Config, secondsPerReview: number): number {
  return (reviewsPerDay(c, cfg) * secondsPerReview) / 60;
}

/** Measured minutes per day over the 7 days before `now`, per subject (null key: unknown subject). */
export function measuredMinutes(facts: LearnerFacts, now: Date): Map<string | null, number> {
  const from = now.getTime() - 7 * DAY_MS;
  const out = new Map<string | null, number>();
  for (const r of facts.anki_reviews) {
    const t = ms(r.ts);
    if (t < from || t > now.getTime()) continue;
    out.set(r.subject, (out.get(r.subject) ?? 0) + r.time_ms / 60_000 / 7);
  }
  return out;
}

/** Splits `total` new cards per day in proportion to `weights`, at least 1 each (largest remainder). */
export function splitNewCards(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => (sum > 0 ? (w / sum) * total : total / weights.length));
  const base = shares.map((s) => Math.max(1, Math.floor(s)));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = shares.map((s, i) => ({ i, r: s - Math.floor(s) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i]! += 1;
    left -= 1;
  }
  return base;
}

export function computeLoad(
  subjects: SubjectFields[],
  mirror: AnkiMirror | null,
  facts: LearnerFacts,
  cfg: Config,
  now: Date,
): LoadReport {
  const A = cfg.anki;
  const sec = mirror?.avg_seconds_per_review ?? A.default_seconds_per_review;
  const cards = mirror?.cards ?? [];
  const measured = measuredMinutes(facts, now);
  const warnings: string[] = [];
  const bySubject = new Map<string, MirrorCard[]>();
  for (const c of cards) {
    const s = c.subject ?? '';
    bySubject.set(s, [...(bySubject.get(s) ?? []), c]);
  }
  const est = (list: MirrorCard[]): number => list.reduce((a, c) => a + cardMinutesPerDay(c, cfg, sec), 0);

  const inactive = subjects.filter((s) => s.scope !== 'active');
  const active = subjects.filter((s) => s.scope === 'active');
  const maintenanceCards = inactive.flatMap((s) => (bySubject.get(s.id) ?? []).filter((c) => !c.suspended));
  const maintenance = {
    estimated_min: round(est(maintenanceCards), 2),
    measured_min_7d: round(
      inactive.reduce((a, s) => a + (measured.get(s.id) ?? 0), 0),
      2,
    ),
    active_cards: maintenanceCards.length,
  };

  const fixedSum = active.reduce((a, s) => a + (typeof s.anki_minutes === 'number' ? s.anki_minutes : 0), 0);
  const allFixed = subjects.reduce(
    (a, s) => a + (typeof s.anki_minutes === 'number' ? s.anki_minutes : 0),
    0,
  );
  if (allFixed > A.minutes_per_day)
    warnings.push(
      `Fixed Anki budgets add up to ${allFixed} min/day, more than the total of ${A.minutes_per_day} (ANK-06). Lower a subject's anki_minutes or raise anki.minutes_per_day.`,
    );
  const autos = active.filter((s) => s.anki_minutes === 'auto');
  const left = Math.max(0, A.minutes_per_day - maintenance.estimated_min - fixedSum);
  const autoShare = autos.length ? left / autos.length : 0;

  const yearAgo = now.getTime() - 365 * DAY_MS;
  const createdIds = new Map<string, Set<number>>();
  for (const c of cards) {
    if (c.note_id < yearAgo || c.note_id > now.getTime() + DAY_MS) continue; // note ids are creation ms
    const s = c.subject ?? '';
    const set = createdIds.get(s) ?? new Set<number>();
    set.add(c.note_id);
    createdIds.set(s, set);
  }
  const queuedAdds = new Map<string, number>();
  for (const a of Object.values(facts.card_actions)) {
    if (a.kind !== 'add' || a.result !== 'queued' || !a.subject || ms(a.ts) < yearAgo) continue;
    const n = Array.isArray(a.payload.proposal_ids) ? a.payload.proposal_ids.length : 1;
    queuedAdds.set(a.subject, (queuedAdds.get(a.subject) ?? 0) + n);
  }

  const rows: SubjectLoad[] = subjects.map((s) => {
    const list = bySubject.get(s.id) ?? [];
    const isActive = s.scope === 'active';
    const fixed = typeof s.anki_minutes === 'number';
    const budget = isActive ? (fixed ? (s.anki_minutes as number) : autoShare) : 0;
    const intakeBudget = Math.floor((budget * 365) / A.card_lifetime_minutes);
    const used = (createdIds.get(s.id)?.size ?? 0) + (queuedAdds.get(s.id) ?? 0);
    const m7 = measured.get(s.id) ?? 0;
    return {
      subject: s.id,
      scope: s.scope,
      budget_min: round(budget, 2),
      fixed,
      measured_min_7d: round(m7, 2),
      estimated_min: round(est(list), 2),
      active_cards: list.filter((c) => !c.suspended).length,
      cards: list.length,
      new_cards: list.filter((c) => !c.suspended && c.type === 0).length,
      intake: {
        used,
        budget: intakeBudget,
        remaining: Math.max(0, intakeBudget - used),
        warn: intakeBudget > 0 && used >= A.intake_warn_fraction * intakeBudget,
      },
      recommended_new_per_day: 0,
      over_budget: isActive && budget > 0 && m7 > budget,
    };
  });
  const activeRows = rows.filter((r) => r.scope === 'active');
  const split = splitNewCards(
    A.new_cards_per_day_total,
    activeRows.map((r) => r.budget_min),
  );
  activeRows.forEach((r, i) => (r.recommended_new_per_day = split[i]!));
  if (activeRows.length > A.new_cards_per_day_total)
    warnings.push(
      `${activeRows.length} active subjects but ${A.new_cards_per_day_total} new cards a day in total: each subject deck gets at least 1 (ANK-01).`,
    );
  return {
    total_budget_min: A.minutes_per_day,
    seconds_per_review: round(sec, 1),
    maintenance,
    subjects: rows,
    total: {
      measured_min_7d: round(
        [...measured.values()].reduce((a, b) => a + b, 0),
        2,
      ),
      estimated_min: round(est(cards), 2),
      active_cards: cards.filter((c) => !c.suspended).length,
      cards: cards.length,
    },
    recommended_new_total: A.new_cards_per_day_total,
    warnings,
  };
}
