import type { Config } from '../config.js';
import type { Status } from '../schemas/common.js';
import { DAY_MS, ms } from '../time.js';
import type { AttemptFact } from './facts.js';
import type { ConceptMemory } from './memory.js';
import { isEvidenceCorrect, spreadAcrossSessions } from './misconceptions.js';

// LM-05 status rules as pure functions. Thresholds come from config.json.

export interface StatusInput {
  attempts: AttemptFact[]; // sorted by time
  taught: boolean;
  anchorLapseTs: string[];
  misconceptionActive: boolean;
  memory: ConceptMemory | null;
  now: Date;
}

export interface MasteryView {
  met: boolean;
  conditions_met: number;
  conditions_total: number;
  latest_correct: boolean;
  summary: string;
}

export interface StatusResult {
  status: Status;
  mastery: MasteryView;
  forgotten_reason: string | null;
  last_success_ts: string | null;
}

export function mastery(input: StatusInput, cfg: Config): MasteryView {
  const th = cfg.thresholds;
  const windowStart = input.now.getTime() - th.mastery_window_days * DAY_MS;
  const strong = input.attempts.filter(
    (a) =>
      ms(a.ts) >= windowStart &&
      ms(a.ts) <= input.now.getTime() &&
      a.grade === 'correct' &&
      !a.assisted &&
      (a.confidence ?? 0) >= th.mastery_min_confidence,
  );
  const c1 = strong.length >= th.mastery_min_correct;
  const qtypes = new Set(strong.map((a) => a.qtype));
  const c2 =
    qtypes.size >= th.mastery_min_qtypes && [...qtypes].some((q) => th.mastery_deep_qtypes.includes(q));
  const c3 =
    th.mastery_min_sessions <= 1 ? strong.length > 0 : spreadAcrossSessions(strong, th.session_gap_hours);
  const met3 = [c1, c2, c3].filter(Boolean).length;
  const past = input.attempts.filter((a) => ms(a.ts) <= input.now.getTime());
  const latest = past[past.length - 1];
  const latestCorrect = latest?.grade === 'correct';
  const met = c1 && c2 && c3 && latestCorrect && !input.misconceptionActive;
  let summary = `${met3} of 3 conditions met`;
  if (met3 === 3 && !latestCorrect) summary += '; latest attempt not correct';
  if (met3 === 3 && input.misconceptionActive) summary += '; misconception active';
  return { met, conditions_met: met3, conditions_total: 3, latest_correct: latestCorrect, summary };
}

export function computeStatus(input: StatusInput, cfg: Config): StatusResult {
  const th = cfg.thresholds;
  const nowMs = input.now.getTime();
  const past = input.attempts.filter((a) => ms(a.ts) <= nowMs);
  const successes = past.filter(isEvidenceCorrect);
  const m = mastery(input, cfg);
  const lastSuccess = successes[successes.length - 1];
  if (!lastSuccess) {
    // Incorrect pretest answers leave a KC unseen; a guess is not evidence (LM-06).
    return {
      status: input.taught ? 'introduced' : 'unseen',
      mastery: m,
      forgotten_reason: null,
      last_success_ts: null,
    };
  }
  const lastSuccessMs = ms(lastSuccess.ts);
  let forgotten: string | null = null;
  const failedLater = past.find(
    (a) =>
      ms(a.ts) > lastSuccessMs &&
      !a.assisted &&
      (a.grade === 'incorrect' || a.grade === 'unanswered') &&
      ms(a.ts) - lastSuccessMs >= th.forgotten_after_days * DAY_MS,
  );
  if (failedLater) forgotten = `missed ${th.forgotten_after_days}+ days after the last success`;
  else if (input.anchorLapseTs.some((t) => ms(t) > lastSuccessMs && ms(t) <= nowMs))
    forgotten = 'anchor Anki card lapsed';
  else if (input.memory && input.memory.retrievability < th.forgotten_retrievability)
    forgotten = `retrievability ${input.memory.retrievability.toFixed(2)} < ${th.forgotten_retrievability}`;
  if (forgotten)
    return { status: 'forgotten', mastery: m, forgotten_reason: forgotten, last_success_ts: lastSuccess.ts };
  return {
    status: m.met ? 'solid' : 'fragile',
    mastery: m,
    forgotten_reason: null,
    last_success_ts: lastSuccess.ts,
  };
}
