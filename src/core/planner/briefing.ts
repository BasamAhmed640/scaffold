import type { Config } from '../config.js';
import type { DerivedState, KcState } from '../model/derive.js';
import type { LearnerFacts } from '../model/facts.js';
import type { Plan } from '../schemas/plan.js';
import type { SubjectFields } from '../schemas/subject.js';
import { DAY_MS, localDate, ms } from '../time.js';
import { cmp, compareKeys, truncate as cut } from '../util.js';
import { lastSessionOn } from './focus.js';
import { backlogCount, rankedNeeds } from './plan.js';

// LM-11: get_briefing returns at most 600 tokens (ARC-11).

export interface AnkiBriefing {
  subject: { min_7d: number; budget_min: number; active_cards: number; intake_year: string } | null;
  total: { min_7d: number; budget_min: number };
  flagged: number;
  /** Up to 3 flagged note ids (ANK-05). */
  flagged_notes?: number[];
  pending_proposals: number;
}

export interface Briefing {
  session_id?: string;
  focus: { subject: string; why: string };
  status?: 'intake_required';
  prefs: Config['prefs'];
  last_session: { date: string; summary: string; open_threads: string[] } | null;
  due: { kc: string; why: string; R?: number }[];
  misconceptions: { id: string; belief: string; since: string }[];
  frontier: string[];
  other_subjects: { subject: string; due: number; forgotten: number; last_session: string | null }[];
  plan: CompactStep[];
  anki: AnkiBriefing | null;
  warnings: string[];
}

export interface CompactStep {
  step: string;
  minutes: number;
  kcs: string[];
  questions?: string[];
  misconception?: string;
}

/** Conservative token estimate for compact JSON (≈3 characters per token). */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 3);
}

export function compactPlan(plan: Plan): CompactStep[] {
  return plan.steps.map((s) => {
    const c: CompactStep = { step: s.step, minutes: s.minutes, kcs: s.items.map((i) => i.kc) };
    const qs = s.items.map((i) => i.question_id).filter((q): q is string => !!q);
    if (qs.length > 0) c.questions = qs;
    const m = s.items.find((i) => i.misconception)?.misconception;
    if (m) c.misconception = m;
    return c;
  });
}

export interface BriefingInput {
  facts: LearnerFacts;
  derived: DerivedState;
  subjects: SubjectFields[];
  cfg: Config;
  plan: Plan;
  now: Date;
  timezone: string;
  anki: AnkiBriefing | null;
  extraWarnings: string[];
  sessionId?: string;
}

export function buildBriefing(input: BriefingInput): Briefing {
  const { cfg, derived, plan, facts } = input;
  const focus = plan.focus.subject;
  const isAll = focus === 'all';
  const active = input.subjects.filter((s) => s.scope === 'active');
  const kcsOf = (sid: string): KcState[] => Object.values(derived.kcs).filter((k) => k.subject === sid);
  const focusKcs = isAll
    ? Object.values(derived.kcs).filter((k) => active.some((s) => s.id === k.subject))
    : kcsOf(focus);

  // TP-16: recap from the last session on the focus subject.
  let last: Briefing['last_session'] = null;
  if (!isAll) {
    const s = lastSessionOn(facts, focus, { endedOnly: true });
    if (s)
      last = {
        date: localDate(new Date(ms(s.started_ts)), input.timezone),
        summary: s.summary!,
        open_threads: s.open_threads,
      };
  }

  const due = rankedNeeds(focusKcs, cfg).map((n) => {
    const d: { kc: string; why: string; R?: number } = { kc: n.kc.id, why: n.why };
    if (n.kc.memory) d.R = Math.round(n.kc.memory.retrievability * 100) / 100;
    return d;
  });
  const focusIds = new Set(focusKcs.map((k) => k.id));
  const misconceptions = derived.misconceptions
    .filter((m) => m.state === 'open' && m.kc_ids.some((k) => focusIds.has(k)))
    .map((m) => ({ id: m.id, belief: m.belief, since: m.since!.slice(0, 10) }));
  const frontier = plan.steps
    .filter((s) => s.step === 'new')
    .flatMap((s) => s.items.filter((i) => !i.prerequisite_for).map((i) => i.kc));

  const warnings: string[] = [];
  const others = active.filter((s) => s.id !== focus).sort((a, b) => cmp(a.id, b.id));
  const otherRows = others.map((s) => {
    const kcs = kcsOf(s.id);
    const lastS = lastSessionOn(facts, s.id);
    const backlog = backlogCount(kcs, cfg);
    // a subject that never had a session counts from its creation
    const sinceTs = lastS ? ms(lastS.started_ts) : ms(facts.subjects[s.id]!.created_ts);
    if (backlog > cfg.briefing.backlog_warn)
      warnings.push(`${s.id}: review backlog ${backlog} KCs; plan a session on it or pause it (ANK-07).`);
    else if (kcs.length > 0 && sinceTs < input.now.getTime() - cfg.briefing.stale_subject_days * DAY_MS)
      warnings.push(
        `${s.id}: no session in ${cfg.briefing.stale_subject_days}+ days; plan a session on it or pause it (ANK-07).`,
      );
    return {
      subject: s.id,
      due: rankedNeeds(kcs, cfg).length,
      forgotten: kcs.filter((k) => k.status === 'forgotten').length,
      last_session: lastS ? localDate(new Date(ms(lastS.started_ts)), input.timezone) : null,
    };
  });
  otherRows.sort((a, b) => compareKeys([-a.due, a.subject], [-b.due, b.subject]));
  warnings.push(...plan.notes.filter((n) => n.includes('backlog') || n.includes('min (>')));
  warnings.push(...input.extraWarnings);

  const b: Briefing = {
    focus: plan.focus,
    prefs: cfg.prefs,
    last_session: last,
    due,
    misconceptions,
    frontier,
    other_subjects: otherRows.slice(0, cfg.briefing.other_subjects_max),
    plan: compactPlan(plan),
    anki: input.anki,
    warnings,
  };
  if (input.sessionId) b.session_id = input.sessionId;
  if (plan.status === 'intake_required') b.status = 'intake_required';
  return fitBriefing(b, cfg.briefing.max_tokens);
}

/** Compacts the briefing in a fixed order until it fits the token budget (ARC-11). */
export function fitBriefing(b: Briefing, maxTokens: number): Briefing {
  const steps: ((x: Briefing) => void)[] = [
    (x) => {
      x.due = x.due.slice(0, 6);
      x.other_subjects = x.other_subjects.slice(0, 3);
    },
    (x) => {
      if (x.last_session) {
        x.last_session.summary = cut(x.last_session.summary, 200);
        x.last_session.open_threads = x.last_session.open_threads.slice(0, 3).map((t) => cut(t, 80));
      }
      x.misconceptions = x.misconceptions.slice(0, 4).map((m) => ({ ...m, belief: cut(m.belief, 80) }));
    },
    (x) => {
      x.warnings = x.warnings.map((w) => cut(w, 110));
      if (x.warnings.length > 4)
        x.warnings = [...x.warnings.slice(0, 4), `+${x.warnings.length - 4} more warnings`];
    },
    (x) => {
      x.due = x.due.slice(0, 4).map((d) => ({ ...d, why: cut(d.why, 40) }));
    },
    (x) => {
      for (const s of x.plan)
        if (s.questions && s.questions.length > 4) s.questions = s.questions.slice(0, 4);
    },
    (x) => {
      if (x.last_session) {
        x.last_session.summary = cut(x.last_session.summary, 100);
        x.last_session.open_threads = x.last_session.open_threads.slice(0, 2).map((t) => cut(t, 60));
      }
      x.misconceptions = x.misconceptions.slice(0, 3).map((m) => ({ ...m, belief: cut(m.belief, 50) }));
      x.other_subjects = x.other_subjects.slice(0, 2);
    },
    (x) => {
      x.due = x.due.slice(0, 3);
      x.warnings = x.warnings.slice(0, 3).map((w) => cut(w, 80));
    },
    (x) => {
      for (const s of x.plan) {
        delete s.questions;
        s.kcs = s.kcs.slice(0, 5);
      }
    },
  ];
  const out: Briefing = structuredClone(b);
  for (const step of steps) {
    if (estimateTokens(out) <= maxTokens) break;
    step(out);
  }
  return out;
}
