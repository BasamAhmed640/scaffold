import type { Config } from '../config.js';
import type { Status } from '../schemas/common.js';
import { localDate, ms } from '../time.js';
import type { AttemptFact, LearnerFacts } from './facts.js';
import { FsrsConceptScheduler, ratingFor, type ConceptMemory, type ConceptScheduler } from './memory.js';
import { deriveMisconceptions, isEvidenceCorrect, type MisconceptionView } from './misconceptions.js';
import { attemptsFor } from './reducer.js';
import { computeStatus, type MasteryView } from './status.js';

// Derived state at an instant: what the core writes to the vault and what the planner reads.

export interface KcState {
  id: string;
  title: string;
  subject: string;
  status: Status;
  misconception_active: boolean;
  misconceptions: string[];
  mastery: MasteryView;
  memory: ConceptMemory | null;
  last_assessed: string | null;
  needs_check: boolean;
  needs_check_reason: string | null;
  forgotten_reason: string | null;
  tested_transfer: boolean;
  attempts: number;
  /** question keys of the last 2 attempts (variant rotation, LM-10). */
  recent_question_keys: string[];
  last_success_ts: string | null;
  prerequisites: string[];
  confusable_with: string[];
  requires_visual: boolean;
}

export interface DerivedState {
  now: string;
  kcs: Record<string, KcState>;
  misconceptions: MisconceptionView[];
}

export interface DeriveOptions {
  scheduler?: ConceptScheduler;
  timezone: string;
}

/** Attempts that feed concept memory: from the first teaching or first evidence of knowing. */
export function memoryAttempts(attempts: AttemptFact[], taughtTs: string[]): AttemptFact[] {
  const firstTaught = taughtTs.length > 0 ? Math.min(...taughtTs.map(ms)) : Infinity;
  const firstEvidence = attempts.find(isEvidenceCorrect);
  const start = Math.min(firstTaught, firstEvidence ? ms(firstEvidence.ts) : Infinity);
  if (!Number.isFinite(start)) return [];
  return attempts.filter((a) => ms(a.ts) >= start);
}

export function deriveState(facts: LearnerFacts, cfg: Config, now: Date, opts: DeriveOptions): DerivedState {
  const scheduler =
    opts.scheduler ?? new FsrsConceptScheduler(cfg.fsrs.desired_retention, cfg.fsrs.maximum_interval_days);
  const misconceptions = deriveMisconceptions(facts, cfg, now);
  const openByKc = new Map<string, string[]>();
  for (const m of misconceptions) {
    if (m.state !== 'open') continue;
    for (const k of m.kc_ids) openByKc.set(k, [...(openByKc.get(k) ?? []), m.id]);
  }
  const kcs: Record<string, KcState> = {};
  for (const id of Object.keys(facts.kcs).sort()) {
    const kf = facts.kcs[id]!;
    const attempts = attemptsFor(facts, id).filter((a) => ms(a.ts) <= now.getTime());
    const taughtTs = kf.taught_ts.filter((t) => ms(t) <= now.getTime());
    const memAttempts = memoryAttempts(attempts, taughtTs);
    const memory = scheduler.replay(
      memAttempts.map((a) => ({ ts: new Date(ms(a.ts)), rating: ratingFor(a) })),
      now,
    );
    const mIds = openByKc.get(id) ?? [];
    const st = computeStatus(
      {
        attempts,
        taught: taughtTs.length > 0,
        anchorLapseTs: kf.anchor_lapse_ts,
        misconceptionActive: mIds.length > 0,
        memory,
        now,
      },
      cfg,
    );
    const last = attempts[attempts.length - 1];
    const checkTs = kf.check_flag_ts && ms(kf.check_flag_ts) <= now.getTime() ? kf.check_flag_ts : null;
    const needsCheck = !!checkTs && !(last && ms(last.ts) > ms(checkTs));
    kcs[id] = {
      id,
      title: kf.fields.title,
      subject: kf.fields.subject,
      status: st.status,
      misconception_active: mIds.length > 0,
      misconceptions: mIds,
      mastery: st.mastery,
      memory,
      last_assessed: last ? localDate(new Date(ms(last.ts)), opts.timezone) : null,
      needs_check: needsCheck,
      needs_check_reason: needsCheck ? kf.check_flag_reason : null,
      forgotten_reason: st.forgotten_reason,
      tested_transfer: attempts.some((a) => a.qtype === 'transfer' && isEvidenceCorrect(a)),
      attempts: attempts.length,
      recent_question_keys: attempts.slice(-2).map((a) => a.question_key),
      last_success_ts: st.last_success_ts,
      prerequisites: kf.fields.prerequisites,
      confusable_with: kf.fields.confusable_with,
      requires_visual: kf.fields.requires_visual,
    };
  }
  return { now: now.toISOString(), kcs, misconceptions };
}

/** Derived frontmatter for a concept note (LM-01 derived block). */
export function derivedFrontmatter(
  k: KcState,
  tz: string,
): {
  status: Status;
  misconception_active: boolean;
  mastery: string;
  memory: { stability_days: number; difficulty: number; retrievability: number; next_check: string } | null;
  last_assessed: string | null;
  needs_check: boolean;
} {
  return {
    status: k.status,
    misconception_active: k.misconception_active,
    mastery: k.mastery.summary,
    memory: k.memory
      ? {
          stability_days: k.memory.stability_days,
          difficulty: k.memory.difficulty,
          retrievability: k.memory.retrievability,
          next_check: localDate(k.memory.next_check, tz),
        }
      : null,
    last_assessed: k.last_assessed,
    needs_check: k.needs_check,
  };
}
