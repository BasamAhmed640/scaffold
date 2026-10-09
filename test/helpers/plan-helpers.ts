import { defaultConfig, type Config } from '../../src/core/config.js';
import { deriveState } from '../../src/core/model/derive.js';
import { buildBriefing, type AnkiBriefing } from '../../src/core/planner/briefing.js';
import { resolveFocus } from '../../src/core/planner/focus.js';
import { backlogCount, planSession, rankedNeeds, type BankQuestion } from '../../src/core/planner/plan.js';
import type { LearnerFacts } from '../../src/core/model/facts.js';
import type { Plan } from '../../src/core/schemas/plan.js';
import { TZ, type LogBuilder } from './builder.js';

export function bankFromFacts(
  facts: LearnerFacts,
  stems: Record<string, { qtype: string; stem: string; difficulty?: number }> = {},
): BankQuestion[] {
  return Object.values(facts.questions).map((q) => ({
    id: q.id,
    kc_ids: q.kc_ids,
    qtype: (stems[q.id]?.qtype ?? 'recall') as BankQuestion['qtype'],
    difficulty: stems[q.id]?.difficulty ?? 2,
    stem: stems[q.id]?.stem ?? q.id,
    misconception_ids: q.misconception_ids,
    verdict: q.verdict,
  }));
}

/** Question types and stems straight from the question_added events. */
export function bankFromLog(b: LogBuilder): BankQuestion[] {
  const facts = b.facts();
  const meta: Record<string, { qtype: string; stem: string; difficulty: number }> = {};
  for (const e of b.events)
    if (e.type === 'question_added')
      meta[e.question_id] = {
        qtype: e.question.qtype,
        stem: e.question.stem,
        difficulty: e.question.difficulty,
      };
  return bankFromFacts(facts, meta);
}

export interface PlanOpts {
  focus?: string | null;
  minutes?: number;
  carryover?: number;
  cfg?: Config;
  now?: Date;
  ankiText?: Record<string, string[]>;
}

export function planFor(b: LogBuilder, opts: PlanOpts = {}): Plan {
  const cfg = opts.cfg ?? defaultConfig();
  const facts = b.facts();
  const now = opts.now ?? new Date(b.t);
  const derived = deriveState(facts, cfg, now, { timezone: TZ });
  const subjects = Object.values(facts.subjects).map((s) => s.fields);
  const due: Record<string, number> = {};
  for (const s of subjects)
    due[s.id] = backlogCount(
      Object.values(derived.kcs).filter((k) => k.subject === s.id),
      cfg,
    );
  const focus = resolveFocus(subjects, facts, due, opts.focus ?? null);
  return planSession({
    facts,
    derived,
    subjects,
    cfg,
    focus,
    minutes: opts.minutes ?? cfg.planner.session_minutes,
    carryover: opts.carryover ?? cfg.planner.carryover,
    questions: bankFromLog(b),
    ankiText: opts.ankiText ?? {},
  });
}

export function briefingFor(
  b: LogBuilder,
  opts: PlanOpts & { anki?: AnkiBriefing | null; warnings?: string[] } = {},
) {
  const cfg = opts.cfg ?? defaultConfig();
  const facts = b.facts();
  const now = opts.now ?? new Date(b.t);
  const derived = deriveState(facts, cfg, now, { timezone: TZ });
  const plan = planFor(b, opts);
  return buildBriefing({
    facts,
    derived,
    subjects: Object.values(facts.subjects).map((s) => s.fields),
    cfg,
    plan,
    now,
    timezone: TZ,
    anki: opts.anki ?? null,
    extraWarnings: opts.warnings ?? [],
  });
}

export { rankedNeeds };
