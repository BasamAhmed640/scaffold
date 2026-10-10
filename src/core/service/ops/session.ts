import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { parseFrontmatter } from '../../vault/frontmatter.js';
import { buildBriefing, type AnkiBriefing, type Briefing } from '../../planner/briefing.js';
import { resolveFocus } from '../../planner/focus.js';
import { backlogCount, planSession } from '../../planner/plan.js';
import type { Plan } from '../../schemas/plan.js';
import { HOUR_MS, ms } from '../../time.js';
import { FOLDERS } from '../../vault/vault.js';
import { bankForPlanner, type BankLoad } from '../bank.js';
import type { Scaffold } from '../scaffold.js';
import { syncFromVault } from '../sync.js';
import { calibrationLine, refreshNotes, sessionAttempts, writeSessionLog } from '../writers.js';
import { ankiBriefing, ankiTextByKc } from './anki-hooks.js';
import { maybeWeeklyReport } from './reports.js';

// D3.3 session script support: start_session, plan_session, get_briefing, end_session (LM-10, LM-11, LM-15).

export const PlanInput = z.object({
  focus: z.string().max(120).nullish(),
  minutes: z.number().min(1).max(240).optional(),
  carryover: z.number().int().min(0).max(2).optional(),
});
export type PlanInput = z.infer<typeof PlanInput>;

/** Learner preferences: config.json defaults, overridden by Learner/Profile.md properties. */
export function learnerPrefs(sc: Scaffold): ReturnType<Scaffold['cfg']>['prefs'] {
  const cfg = sc.cfg();
  const prefs = { ...cfg.prefs };
  try {
    const text = sc.vault.readText(`${FOLDERS.learner}/Profile.md`);
    if (text) {
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      const data = m ? parseFrontmatter(m[1]!) : {};
      if (typeof data.session_minutes === 'number' && data.session_minutes >= 5)
        prefs.session_minutes = data.session_minutes;
      if (data.analogies === 'off' || data.analogies === 'sparing' || data.analogies === 'on')
        prefs.analogies = data.analogies;
      if (typeof data.level === 'string' && data.level.trim()) prefs.level = data.level.trim();
    }
  } catch {
    // a broken profile never blocks a session (REL-03); doctor reports YAML errors
  }
  return prefs;
}

interface Computed {
  plan: Plan;
  bank: BankLoad;
}

function computePlan(sc: Scaffold, input: PlanInput, bank: BankLoad, w: Warnings): Computed {
  const cfg = sc.cfg();
  const prefs = learnerPrefs(sc);
  const facts = sc.facts(w);
  const derived = sc.derived();
  const subjects = Object.values(facts.subjects).map((s) => s.fields);
  const due: Record<string, number> = {};
  for (const s of subjects)
    due[s.id] = backlogCount(
      Object.values(derived.kcs).filter((k) => k.subject === s.id),
      cfg,
    );
  const open = sc.openSession();
  let requested = input.focus ?? null;
  if (!requested && open) requested = open.focus_history[open.focus_history.length - 1]!.subject;
  const focus = resolveFocus(subjects, facts, due, requested);
  if (!input.focus && open && requested) focus.why = 'focus of the open session';
  const plan = planSession({
    facts,
    derived,
    subjects,
    cfg,
    focus,
    minutes: input.minutes ?? prefs.session_minutes ?? cfg.planner.session_minutes,
    carryover: input.carryover ?? cfg.planner.carryover,
    questions: bankForPlanner(sc, bank),
    ankiText: ankiTextByKc(sc),
  });
  return { plan, bank };
}

function briefingFor(sc: Scaffold, plan: Plan, w: Warnings, sessionId?: string): Briefing {
  const anki: AnkiBriefing | null = ankiBriefing(sc, plan.focus.subject, w);
  const extra: string[] = [];
  for (const m of w.items) if (/queued|Anki is not running|over budget/i.test(m)) extra.push(m);
  const facts = sc.facts();
  const b = buildBriefing({
    facts,
    derived: sc.derived(),
    subjects: Object.values(facts.subjects).map((s) => s.fields),
    cfg: { ...sc.cfg(), prefs: learnerPrefs(sc) },
    plan,
    now: sc.now(),
    timezone: sc.tz(),
    anki,
    extraWarnings: extra,
    ...(sessionId ? { sessionId } : {}),
  });
  return b;
}

export function getBriefing(sc: Scaffold, raw: unknown, w: Warnings): Briefing {
  const input = PlanInput.parse(raw ?? {});
  const { bank } = syncFromVault(sc, w);
  const { plan } = computePlan(sc, input, bank, w);
  const open = sc.openSession();
  return briefingFor(sc, plan, w, open?.id);
}

function describeChange(prev: Plan | null, next: Plan): string {
  if (!prev) return `Plan: ${next.focus.subject}, ${next.minutes_planned} of ${next.minutes_requested} min.`;
  const parts: string[] = [];
  if (prev.focus.subject !== next.focus.subject)
    parts.push(`focus ${prev.focus.subject} → ${next.focus.subject}`);
  if (prev.minutes_requested !== next.minutes_requested)
    parts.push(`time ${prev.minutes_requested} → ${next.minutes_requested} min`);
  if (prev.carryover !== next.carryover) parts.push(`carry-over ${prev.carryover} → ${next.carryover}`);
  const steps = (p: Plan): string =>
    p.steps.map((s) => `${s.step}:${s.items.map((i) => i.kc).join(',')}`).join('|');
  if (parts.length === 0 && steps(prev) !== steps(next)) parts.push('plan updated from new results');
  return parts.length ? `Changed: ${parts.join('; ')}.` : 'No change to the plan.';
}

export function planSessionOp(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = PlanInput.parse(raw ?? {});
  const { bank } = syncFromVault(sc, w);
  const { plan } = computePlan(sc, input, bank, w);
  const open = sc.openSession();
  let change = describeChange(null, plan);
  if (open) {
    change = describeChange(open.plan, plan);
    // LM-10 / TP-09: a plan_session call during an open session logs session_replanned.
    sc.emit([
      {
        type: 'session_replanned',
        session_id: open.id,
        focus: plan.focus,
        minutes: plan.minutes_requested,
        carryover: plan.carryover,
        plan,
        reason: change.slice(0, 500),
      },
    ]);
  }
  return { session_id: open?.id ?? null, change, plan };
}

export function startSession(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = PlanInput.parse(raw ?? {});
  const { bank } = syncFromVault(sc, w);
  const cfg = sc.cfg();
  const open = sc.openSession();
  let resumed = false;
  if (open) {
    const ageH = (sc.now().getTime() - ms(open.started_ts)) / HOUR_MS;
    if (ageH < cfg.planner.open_session_resume_hours) {
      resumed = true;
    } else {
      sc.emit([
        {
          type: 'session_ended',
          session_id: open.id,
          summary: 'Session was not ended; closed automatically.',
          open_threads: [],
          next_preview: '',
          auto_closed: true,
        },
      ]);
      writeSessionLog(sc, open.id, bank, w);
      w.add(`Session ${open.id} was still open; it was closed automatically (REL-03).`);
    }
  }
  const { plan } = computePlan(sc, resumed ? { ...input, focus: input.focus ?? null } : input, bank, w);
  let sessionId: string;
  if (resumed && open) {
    sessionId = open.id;
    sc.emit([
      {
        type: 'session_replanned',
        session_id: sessionId,
        focus: plan.focus,
        minutes: plan.minutes_requested,
        carryover: plan.carryover,
        plan,
        reason: 'resumed',
      },
    ]);
  } else {
    sessionId = sc.newSessionId();
    sc.emit([
      {
        type: 'session_started',
        session_id: sessionId,
        focus: plan.focus,
        minutes: plan.minutes_requested,
        carryover: plan.carryover,
        plan,
      },
    ]);
  }
  refreshNotes(sc, { all: true }, bank, w);
  writeSessionLog(sc, sessionId, bank, w);
  const briefing = briefingFor(sc, plan, w, sessionId);
  const out: { session_id: string; resumed: boolean; briefing: Briefing; next_step?: string } = {
    session_id: sessionId,
    resumed,
    briefing,
  };
  if (plan.status === 'intake_required')
    out.next_step =
      'Onboard the subject (D3.10): ≤5 intake questions, an approved KC map saved with upsert_concept, then plan_session for the pretest.';
  return out;
}

export const EndInput = z.object({
  session_id: z.string().max(40).optional(),
  summary: z.string().min(3).max(4000),
  open_threads: z.array(z.string().max(500)).max(10).default([]),
  next_preview: z.string().min(3).max(500),
});

export function endSession(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = EndInput.parse(raw);
  const facts = sc.facts();
  const open = input.session_id ? facts.sessions[input.session_id] : sc.openSession();
  if (!open)
    throw new ScaffoldError(
      'no_open_session',
      'There is no open session to end.',
      'Call start_session first.',
    );
  if (open.ended_ts)
    throw new ScaffoldError('session_already_ended', `Session ${open.id} has already ended.`);
  const attempts = sessionAttempts(sc, open.id);
  const exitDone = attempts.some((a) => a.step === 'exit');
  if (!exitDone) w.add('No exit-ticket answer was recorded this session (TP-15).');
  sc.emit([
    {
      type: 'session_ended',
      session_id: open.id,
      summary: input.summary,
      open_threads: input.open_threads,
      next_preview: input.next_preview,
    },
  ]);
  const { bank } = syncFromVault(sc, w);
  refreshNotes(sc, { all: true }, bank, w);
  writeSessionLog(sc, open.id, bank, w);
  const titles: Record<string, string> = {};
  for (const k of Object.values(sc.facts().kcs)) titles[k.fields.id] = k.fields.title;
  const weekly = maybeWeeklyReport(sc, w);
  return {
    session_id: open.id,
    log: `${FOLDERS.sessions}/${open.id}.md`,
    // D3.9: calibration in one line
    calibration: calibrationLine(attempts, titles),
    answers_recorded: attempts.length,
    next_preview: input.next_preview,
    weekly_report: weekly,
  };
}
