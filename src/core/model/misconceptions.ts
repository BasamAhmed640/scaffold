import type { Config } from '../config.js';
import { HOUR_MS, ms } from '../time.js';
import { compareKeys } from '../util.js';
import type { AttemptFact, LearnerFacts } from './facts.js';
import { sortAttempts } from './reducer.js';

// LM-05 misconception flag [misremember].
// Opened when an incorrect answer has confidence ≥ 3 and the grader states the wrong belief as a
// proposition, or when the same misconception_id appears twice at any confidence.
// Resolved (derived, never set by hand) after correct unassisted answers to at least 2 questions
// that target that misconception, in at least 2 sessions ≥ 20 h apart.

export type MisconceptionState = 'candidate' | 'open' | 'resolved';

export interface MisconceptionView {
  id: string;
  kc_ids: string[];
  belief: string;
  state: MisconceptionState;
  /** When it (last) opened. */
  since: string | null;
  resolved_ts: string | null;
  exhibits: number;
  /** Distinct targeted questions answered correctly since opening. */
  resolve_progress: { questions: number; sessions: number };
}

interface TimelineItem {
  ts: string;
  order: string;
  kind: 'exhibit' | 'explicit' | 'targeted_correct';
  attempt?: AttemptFact;
}

/** A correct, unassisted, non-guess answer counts as evidence (LM-06; DECISIONS.md D-06). */
export function isEvidenceCorrect(a: Pick<AttemptFact, 'grade' | 'assisted' | 'confidence'>): boolean {
  return a.grade === 'correct' && !a.assisted && (a.confidence ?? 0) >= 2;
}

export function deriveMisconceptions(facts: LearnerFacts, cfg: Config, now: Date): MisconceptionView[] {
  const th = cfg.thresholds;
  const all = sortAttempts(Object.values(facts.attempts));
  const out: MisconceptionView[] = [];
  const ids = Object.keys(facts.misconceptions).sort();
  for (const id of ids) {
    const m = facts.misconceptions[id]!;
    const items: TimelineItem[] = [];
    for (const a of all) {
      if (ms(a.ts) > now.getTime()) continue;
      const targetsM =
        a.misconception_id === id ||
        (a.question_id !== null && (facts.questions[a.question_id]?.misconception_ids ?? []).includes(id));
      if (!targetsM) continue;
      if (a.grade === 'correct') {
        if (isEvidenceCorrect(a)) items.push({ ts: a.ts, order: a.id, kind: 'targeted_correct', attempt: a });
      } else if (a.misconception_id === id && (a.grade === 'incorrect' || a.grade === 'partial')) {
        items.push({ ts: a.ts, order: a.id, kind: 'exhibit', attempt: a });
      }
    }
    for (const ts of m.explicit_open_ts) {
      if (ms(ts) <= now.getTime()) items.push({ ts, order: `~${ts}`, kind: 'explicit' });
    }
    items.sort((x, y) => compareKeys([ms(x.ts), x.order], [ms(y.ts), y.order]));

    let state = 'candidate' as MisconceptionState;
    let since: string | null = null;
    let resolvedTs: string | null = null;
    let exhibits = 0;
    let evidence: AttemptFact[] = [];
    const open = (ts: string): void => {
      if (state !== 'open') {
        state = 'open';
        since = ts;
        evidence = [];
      }
    };
    for (const it of items) {
      if (it.kind === 'explicit') {
        open(it.ts);
      } else if (it.kind === 'exhibit') {
        const a = it.attempt!;
        exhibits += 1;
        const confidentStated =
          a.grade === 'incorrect' &&
          a.confidence! >= th.misconception_open_confidence &&
          !!a.misconception_belief;
        if (state === 'resolved' || confidentStated || exhibits >= 2) open(it.ts);
        else if (state === 'open') evidence = []; // a fresh error restarts the resolution count
      } else if (state === 'open') {
        evidence.push(it.attempt!);
        if (resolutionMet(evidence, th.misconception_resolve_questions, th.session_gap_hours)) {
          state = 'resolved';
          resolvedTs = it.ts;
        }
      }
    }
    const progress = progressOf(evidence, th.session_gap_hours);
    out.push({
      id,
      kc_ids: m.kc_ids,
      belief: m.belief,
      state,
      since,
      resolved_ts: state === 'resolved' ? resolvedTs : null,
      exhibits,
      resolve_progress: progress,
    });
  }
  return out;
}

function sessionKey(a: AttemptFact): string {
  return a.session_id ?? `adhoc:${a.id}`;
}

/** Two attempts in different sessions at least `gapHours` apart. */
export function spreadAcrossSessions(list: AttemptFact[], gapHours: number): boolean {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (sessionKey(a) !== sessionKey(b) && Math.abs(ms(a.ts) - ms(b.ts)) >= gapHours * HOUR_MS) return true;
    }
  }
  return false;
}

function resolutionMet(evidence: AttemptFact[], minQuestions: number, gapHours: number): boolean {
  const questions = new Set(evidence.map((a) => a.question_key));
  return questions.size >= minQuestions && spreadAcrossSessions(evidence, gapHours);
}

function progressOf(evidence: AttemptFact[], gapHours: number): { questions: number; sessions: number } {
  const questions = new Set(evidence.map((a) => a.question_key)).size;
  const sessions = new Set(evidence.map(sessionKey)).size;
  return {
    questions,
    sessions: spreadAcrossSessions(evidence, gapHours) ? Math.max(2, sessions) : Math.min(sessions, 1),
  };
}
