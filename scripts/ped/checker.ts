import type { AttemptEvent, ScaffoldEvent } from '../../src/core/schemas/events.js';
import type { CheckResult, Transcript } from './types.js';

// V-PED checks, computed from transcripts and events (build spec, V-PED table). The heuristics are
// simple and documented (DECISIONS.md D-48), so a hand-run session is scored with the same code.

/** "About 250 words" (TP-11): runs up to 10 % over are tolerated. */
export const SEGMENT_WORDS = 275;
/** Words before the first question in the turn that asks it (TP-02). */
export const ASK_FIRST_WORDS = 120;
/** A reply to a carry-over miss longer than this counts as teaching (TP-18). */
export const BRIEF_FEEDBACK_WORDS = 140;
/** Shingle length for leak detection (TP-03). */
export const LEAK_SHINGLE = 5;

export const norm = (s: string): string =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”"'’`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const tokens = (s: string): string[] =>
  norm(s)
    .split(/[^\p{L}\p{N}.%/=+−-]+/u)
    .map((w) => w.replace(/^[.\-/]+|[.\-/]+$/g, ''))
    .filter(Boolean);
const words = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);
/** Prose only: code, Mermaid, SVG and HTML blocks are not explanation. */
const prose = (s: string): string =>
  s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

const attempts = (t: Transcript): AttemptEvent[] =>
  t.events.filter((e): e is AttemptEvent => e.type === 'attempt');
function ofType<T extends ScaffoldEvent['type']>(
  t: Transcript,
  type: T,
): Extract<ScaffoldEvent, { type: T }>[] {
  return t.events.filter((e): e is Extract<ScaffoldEvent, { type: T }> => e.type === type);
}

/** Tutor turn during which event `e` was appended (from `events_after`), or -1 when unknown. */
export function turnOfEvent(t: Transcript, e: ScaffoldEvent): number {
  const at = t.events.indexOf(e);
  if (at === -1) return -1;
  return t.turns.findIndex((u) => u.role === 'tutor' && u.events_after !== undefined && u.events_after > at);
}

/** Events that a successful call of each tool appends; used when the transcript lacks tool calls. */
const TOOL_EVENT: Record<string, ScaffoldEvent['type']> = {
  upsert_subject: 'subject_created',
  upsert_concept: 'kc_created',
  apply_card_actions: 'card_action_applied',
  plan_session: 'session_replanned',
  get_grading_key: 'key_requested',
  flag_card: 'card_flagged',
};

/** First tutor turn with a tool call named `name`, or with the event that call appends. */
function turnOfTool(t: Transcript, name: string): number {
  const byCall = t.turns.findIndex((u) => u.role === 'tutor' && u.tools.some((c) => c.name === name));
  const type = TOOL_EVENT[name];
  const ev = type ? t.events.find((e) => e.type === type) : undefined;
  const byEvent = ev ? turnOfEvent(t, ev) : -1;
  if (byCall === -1) return byEvent;
  return byEvent === -1 ? byCall : Math.min(byCall, byEvent);
}

function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size < 4 || tb.size < 4) return 0; // too short to compare by tokens
  let n = 0;
  for (const x of ta) if (tb.has(x)) n++;
  return n / Math.min(ta.size, tb.size);
}

/** Whether a learner message is the source of a quoted answer (verbatim, trimmed or lightly edited). */
export function quotes(message: string, answer: string): boolean {
  const m = norm(message);
  const a = norm(answer);
  if (!a || !m) return false;
  if (m === a) return true;
  if (a.length < 8) {
    // short answers ("3", "+1, 4"): the message is the answer plus at most a few words
    const tm = tokens(m);
    const ta = tokens(a);
    return ta.every((x) => tm.includes(x)) && tm.length <= ta.length + 3;
  }
  return m.includes(a) || (m.length >= 12 && a.includes(m)) || overlap(m, a) >= 0.8;
}

/**
 * The learner turn an answer or quote came from. With `e`, the event that recorded it, the search runs
 * backwards from the turn in which `e` was logged (the latest matching message wins); otherwise it
 * returns the first matching learner turn.
 */
export function learnerTurnFor(t: Transcript, answer: string, e?: ScaffoldEvent): number {
  const k = e ? turnOfEvent(t, e) : -1;
  if (k !== -1) return learnerBefore(t, answer, k);
  return t.turns.findIndex((u) => u.role === 'learner' && quotes(u.text, answer));
}

/** The latest learner turn before turn `k` that the answer quotes, or -1. */
function learnerBefore(t: Transcript, answer: string, k: number): number {
  for (let j = k - 1; j >= 0; j--)
    if (t.turns[j]!.role === 'learner' && quotes(t.turns[j]!.text, answer)) return j;
  return -1;
}

function previousTutor(t: Transcript, i: number): number {
  for (let j = i - 1; j >= 0; j--) if (t.turns[j]!.role === 'tutor') return j;
  return -1;
}

const subjectNames = (t: Transcript, id: string | undefined): string[] => {
  const s = t.subjects.find((x) => x.id === id);
  return s ? [s.title, s.id, ...s.aliases].map(norm).filter((n) => n.length >= 2) : [];
};
const mentionsAny = (text: string, names: string[]): boolean => names.some((n) => norm(text).includes(n));

const result = (
  id: string,
  title: string,
  passed: number,
  total: number,
  bar: number,
  details: string[],
  applicable = true,
): CheckResult => ({ id, title, passed, total, bar, details, applicable });

/**
 * Steps of the plan in force when event `e` was logged (the last `session_started` or
 * `session_replanned` before it), by KC; `prerequisite` marks LM-10 step-5 items.
 */
function planStepsAt(t: Transcript, e: ScaffoldEvent): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const before = t.events.slice(0, t.events.indexOf(e));
  const p = before.findLast((x) => x.type === 'session_started' || x.type === 'session_replanned');
  if (!p || (p.type !== 'session_started' && p.type !== 'session_replanned')) return out;
  for (const s of p.plan.steps)
    for (const item of s.items) {
      const set = out.get(item.kc) ?? new Set<string>();
      set.add(item.prerequisite_for ? 'prerequisite' : s.step);
      out.set(item.kc, set);
    }
  return out;
}

/** The attempt's step, or the one plan step its KC was listed in when the tutor left it out. */
function stepOf(t: Transcript, a: AttemptEvent): string | null {
  if (a.step) return a.step;
  const steps = planStepsAt(t, a);
  const listed = new Set(a.kc_ids.flatMap((k) => [...(steps.get(k) ?? [])]));
  return listed.size === 1 ? [...listed][0]! : null;
}

/**
 * TP-02: for each KC that was not `unseen`, the first engagement in the run is a question (an
 * attempt before any `taught` event), and the turn that asks it does not explain at length first.
 */
export function checkAskBeforeTell(t: Transcript): CheckResult {
  const details: string[] = [];
  let pass = 0;
  let total = 0;
  for (const kc of t.kcs.filter((k) => k.status_at_start !== 'unseen')) {
    const first = t.events.find(
      (e) => (e.type === 'attempt' || e.type === 'taught') && e.kc_ids.includes(kc.id),
    );
    if (!first) continue;
    total++;
    if (first.type === 'taught') {
      details.push(`${kc.id}: taught before any question`);
      continue;
    }
    if (first.type !== 'attempt') continue;
    const asked = previousTutor(t, learnerTurnFor(t, first.answer_verbatim, first));
    const text = asked === -1 ? '' : prose(t.turns[asked]!.text);
    const q = text.indexOf('?');
    const before = words(q === -1 ? text : text.slice(0, q));
    if (asked === -1 || before <= ASK_FIRST_WORDS) pass++;
    else details.push(`${kc.id}: ${before} words of explanation before the question`);
  }
  return result(
    'TP-02',
    'Question before explanation for KCs not unseen',
    pass,
    total,
    0.9,
    details,
    total > 0,
  );
}

/** Key phrases of a question: 5-word shingles of the key and rubric not in the stem; short keys whole. */
export function keyPhrases(q: Transcript['questions'][number]): string[] {
  const stem = ` ${tokens(q.stem).join(' ')} `;
  const out = new Set<string>();
  for (const src of [q.answer_key, ...q.rubric]) {
    const tk = tokens(src);
    if (tk.length < LEAK_SHINGLE) {
      const whole = tk.join(' ');
      if (whole.length >= 3 && !stem.includes(` ${whole} `)) out.add(whole);
      continue;
    }
    for (let i = 0; i + LEAK_SHINGLE <= tk.length; i++) {
      const sh = tk.slice(i, i + LEAK_SHINGLE).join(' ');
      if (!stem.includes(` ${sh} `)) out.add(sh);
    }
  }
  return [...out];
}

/**
 * TP-03: no key phrase in the tutor turn that poses a bank question (the last tutor turn before the
 * learner's reply). Attempts that used hints are skipped: the hint ladder may reveal the answer at H4,
 * which marks the attempt assisted.
 */
export function checkNoLeak(t: Transcript): CheckResult {
  const details: string[] = [];
  let pass = 0;
  let total = 0;
  for (const a of attempts(t)) {
    const q = a.question_id ? t.questions.find((x) => x.id === a.question_id) : undefined;
    if (!q || a.hints_used > 0) continue;
    const li = learnerTurnFor(t, a.answer_verbatim, a);
    const asked = previousTutor(t, li);
    if (li === -1 || asked === -1) continue;
    total++;
    const said = ` ${tokens(prose(t.turns[asked]!.text)).join(' ')} `;
    const leaked = keyPhrases(q).filter((p) => said.includes(` ${p} `));
    if (leaked.length === 0) pass++;
    else details.push(`${q.id}: "${leaked[0]}" appeared before the learner answered`);
  }
  return result('TP-03', 'No answer leak before the attempt', pass, total, 1, details, total > 0);
}

/**
 * TP-08: every key request quotes an answer the learner gave in an earlier turn. Uses the tool calls
 * in the transcript, or the `key_requested` events when the front-end's output hides tool inputs.
 */
export function checkKeyEscrow(t: Transcript): CheckResult {
  const details: string[] = [];
  let calls = t.turns.flatMap((u, i) =>
    u.role === 'tutor'
      ? u.tools
          .filter((c) => c.name === 'get_grading_key')
          .map((c) => ({
            i,
            q: String(c.input.question_id),
            answer: typeof c.input.answer_verbatim === 'string' ? c.input.answer_verbatim : '',
          }))
      : [],
  );
  if (calls.length === 0)
    calls = ofType(t, 'key_requested').map((e) => ({
      i: turnOfEvent(t, e),
      q: e.question_id,
      answer: e.answer_verbatim,
    }));
  let pass = 0;
  for (const { i, q, answer } of calls) {
    const li = i === -1 ? learnerTurnFor(t, answer) : learnerBefore(t, answer, i);
    if (li !== -1) pass++;
    else details.push(`${q}: key requested before the learner answered`);
  }
  return result(
    'TP-08',
    'get_grading_key only after the learner’s answer',
    pass,
    calls.length,
    1,
    details,
    calls.length > 0,
  );
}

/** The confidence a learner stated in a message ("confidence 3", "3/4", "50 Ω, 3"), if any. */
export function statedConfidence(text: string): number | null {
  const m =
    /confiden\w*\D{0,12}([1-4])\b/i.exec(text) ??
    /\b([1-4])\s*\/\s*4\b/.exec(text) ??
    /,\s*([1-4])\s*[.!]?$/.exec(text.trim()) ??
    /^\s*([1-4])\s*[.!]?\s*$/.exec(text);
  if (m) return Number(m[1]);
  if (/\b(just )?(a )?guess(ing)?\b/i.test(text)) return 1;
  if (/\b(certain|definitely|100 ?%)\b/i.test(text)) return 4;
  return null;
}

/** TP-04: every assessed answer has a confidence, and it matches what the learner stated. */
export function checkConfidence(t: Transcript): CheckResult {
  const details: string[] = [];
  const graded = attempts(t).filter((a) => a.grade !== 'unanswered');
  let pass = 0;
  for (const a of graded) {
    if (a.confidence === null) {
      details.push(`${a.id}: no confidence`);
      continue;
    }
    const li = learnerTurnFor(t, a.answer_verbatim, a);
    const window = li === -1 ? [] : t.turns.slice(li, li + 3).filter((u) => u.role === 'learner');
    const stated = window.map((u) => statedConfidence(u.text)).find((c) => c !== null) ?? null;
    if (stated === null || stated === a.confidence) pass++;
    else details.push(`${a.id}: recorded confidence ${a.confidence}, the learner said ${stated}`);
  }
  return result(
    'TP-04',
    'Confidence captured on assessed answers',
    pass,
    graded.length,
    0.95,
    details,
    graded.length > 0,
  );
}

/** TP-07: every learner turn the scenario marks as an answer has an attempt event. */
export function checkRecorded(t: Transcript): CheckResult {
  const details: string[] = [];
  const marked = t.turns.map((u, i) => ({ u, i })).filter(({ u }) => u.role === 'learner' && u.answer);
  let pass = 0;
  for (const { u, i } of marked) {
    if (attempts(t).some((a) => learnerTurnFor(t, a.answer_verbatim, a) === i)) pass++;
    else details.push(`not recorded: "${u.text.slice(0, 60)}"`);
  }
  return result(
    'TP-07',
    'Every assessed answer recorded',
    pass,
    marked.length,
    1,
    details,
    marked.length > 0,
  );
}

const TASK_START =
  /^\W*(now,? |so,? |then,? |next,? |ok(ay)?,? )?(try|sketch|draw|write|compute|calculate|work out|explain|predict|label|tell me|give me|describe|answer|rate|pick|choose|your turn)\b/i;

/** Word counts of the explanation runs in a message; a run ends at a question or a task sentence. */
export function explanationRuns(text: string): { words: number; prompted: boolean }[] {
  const sentences = prose(text)
    .split(/(?<=[.!?:])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const runs: { words: number; prompted: boolean }[] = [];
  let n = 0;
  for (const s of sentences) {
    if (/\?\W*$/.test(s) || TASK_START.test(s)) {
      runs.push({ words: n, prompted: true });
      n = 0;
    } else n += words(s);
  }
  if (n > 0) runs.push({ words: n, prompted: false });
  return runs;
}

/** TP-11: no run of more than about 250 words of explanation before a question or task. */
export function checkSegments(t: Transcript): CheckResult {
  const details: string[] = [];
  const tutor = t.turns.filter((u) => u.role === 'tutor' && prose(u.text).trim());
  let pass = 0;
  for (const u of tutor) {
    const long = explanationRuns(u.text).find((r) => r.words > SEGMENT_WORDS);
    if (!long) pass++;
    else
      details.push(
        `${long.words} words ${long.prompted ? 'before the next question or task' : 'with no question or task after them'}: "${prose(u.text).trim().slice(0, 50)}…"`,
      );
  }
  return result(
    'TP-11',
    'No explanation run over 250 words without a learner prompt',
    pass,
    tutor.length,
    0.95,
    details,
    tutor.length > 0,
  );
}

/** TP-12: every `requires_visual` KC taught in the run has a registered visual. */
export function checkVisuals(t: Transcript): CheckResult {
  const details: string[] = [];
  const taught = new Set(ofType(t, 'taught').flatMap((e) => e.kc_ids));
  const need = t.kcs.filter((k) => k.requires_visual && taught.has(k.id));
  const registered = new Set(ofType(t, 'visual_registered').flatMap((v) => v.kc_ids));
  let pass = 0;
  for (const k of need) {
    if (registered.has(k.id)) pass++;
    else details.push(`${k.id}: requires a visual; none registered`);
  }
  return result(
    'TP-12',
    'Visual shown and registered for requires_visual KCs',
    pass,
    need.length,
    1,
    details,
    need.length > 0,
  );
}

export const ANALOGY =
  /\b(analogy|analogous|it'?s (a bit |kind of )?like|is (a bit |kind of )?like (a|an|the)|think of (it|this|that|the \w+) as|imagine (a|an|that)|picture (a|an))\b/i;
const MAPPING =
  /(→|->|maps (on)?to|corresponds to|plays the role of|stands (in )?for|is the \w+ (in|of) the analogy)/i;
const BREAKS =
  /(breaks? down|(analogy|picture|comparison) (breaks|fails|stops|misses|ignores|doesn'?t)|doesn'?t hold|does not hold|where (it|the analogy|this) (breaks|fails)|limits? of (the|this) analogy)/i;

/** D3.7: every tutor turn with an analogy has an explicit mapping and a where-it-breaks sentence. */
export function checkAnalogies(t: Transcript): CheckResult {
  const details: string[] = [];
  const turns = t.turns.filter((u) => u.role === 'tutor' && ANALOGY.test(prose(u.text)));
  let pass = 0;
  for (const u of turns) {
    const p = prose(u.text);
    const missing = [!MAPPING.test(p) && 'a mapping', !BREAKS.test(p) && 'a where-it-breaks sentence'].filter(
      Boolean,
    );
    if (missing.length === 0) pass++;
    else details.push(`analogy without ${missing.join(' or ')}: "${p.trim().slice(0, 60)}…"`);
  }
  return result(
    'D3.7',
    'Every analogy has a mapping and a where-it-breaks sentence',
    pass,
    turns.length,
    1,
    details,
    turns.length > 0,
  );
}

/**
 * TP-14 / ANK-03: each proposal has its three admission answers, stays within 3 cards per KC, and
 * follows a correct, unassisted retrieval of that KC earlier in the same session.
 */
export function checkCardProposals(t: Transcript, maxPerKc = 3): CheckResult {
  const details: string[] = [];
  const props = ofType(t, 'card_proposed');
  const perKc = new Map<string, number>();
  let pass = 0;
  for (const p of props) {
    perKc.set(p.kc_id, (perKc.get(p.kc_id) ?? 0) + 1);
    const at = t.events.indexOf(p);
    const retrieved = attempts(t).some(
      (a) =>
        t.events.indexOf(a) < at &&
        a.session_id === p.session_id &&
        a.kc_ids.includes(p.kc_id) &&
        a.grade === 'correct' &&
        !a.assisted,
    );
    const admitted = [p.admission.rederive, p.admission.instant, p.admission.worth].every(
      (s) => s.trim().length >= 3,
    );
    const capped = perKc.get(p.kc_id)! <= maxPerKc;
    if (admitted && capped && retrieved) pass++;
    else
      details.push(
        `${p.proposal_id}: ${[!admitted && 'admission answer missing', !capped && `over ${maxPerKc} cards for ${p.kc_id}`, !retrieved && 'no correct retrieval earlier this session'].filter(Boolean).join('; ')}`,
      );
  }
  return result(
    'TP-14',
    'Card proposals carry admission answers and respect the caps',
    pass,
    props.length,
    1,
    details,
    props.length > 0,
  );
}

export const APPROVAL =
  /\b(yes|yeah|yep|ok(ay)?|sure|go ahead|approved?|i approve|do it|sounds good|looks good|go for it|please do)\b/i;
const REFUSAL = /\b(no|not yet|don'?t|do not|wait|hold on|leave it)\b/i;

/** A message reads as approval when it approves and does not start by refusing ("No, wait…"). */
export function isApproval(text: string): boolean {
  const first = text.trim().split(/[.!?\n]/)[0] ?? '';
  return APPROVAL.test(text) && !(REFUSAL.test(first) && !APPROVAL.test(first));
}

/**
 * TP-17: in scenario 9 a card is flagged; any card action applied quotes a learner message that came
 * before the `apply_card_actions` call and reads as an explicit approval.
 */
export function checkCardHygiene(t: Transcript, required: boolean): CheckResult {
  const details: string[] = [];
  const applied = ofType(t, 'card_action_applied');
  let pass = 0;
  let total = 0;
  if (required) {
    total++;
    if (ofType(t, 'card_flagged').length > 0) pass++;
    else details.push('no card_flagged event');
  }
  const applyTurn = turnOfTool(t, 'apply_card_actions');
  for (const a of applied) {
    total++;
    const qi = learnerTurnFor(t, a.approval.learner_quote, a);
    if (qi !== -1 && applyTurn !== -1 && qi < applyTurn && isApproval(t.turns[qi]!.text)) pass++;
    else details.push(`${a.action_id}: applied without a prior explicit learner approval`);
  }
  return result(
    'TP-17',
    'Card flagged; actions applied only after explicit approval',
    pass,
    total,
    1,
    details,
    total > 0,
  );
}

/** TP-15: an exit-ticket answer is recorded and the session is ended (not auto-closed). */
export function checkClose(t: Transcript): CheckResult {
  const ended = ofType(t, 'session_ended').some((e) => !e.auto_closed);
  const exit = attempts(t).some((a) => stepOf(t, a) === 'exit');
  const details: string[] = [];
  if (!exit) details.push('no exit-ticket answer recorded');
  if (!ended) details.push('no end_session');
  return result(
    'TP-15',
    'Session closed with exit ticket and end_session',
    ended && exit ? 1 : 0,
    1,
    1,
    details,
  );
}

const ELICIT =
  /(why|what makes you|how did you|what('?s| is) your reasoning|walk me through|in your own words|what do you (think|mean)|say more|explain your)/i;
const PLAUSIBLE =
  /(plausible|makes sense|reasonable|natural (to|assumption|guess)|understandable|tempting|common (belief|intuition|mistake)|easy to (see|think))/i;

/**
 * Scenario 2 (D3.6): the confident wrong answer opens a misconception; after it the tutor elicits the
 * belief (step 1) and refutes it as plausible-but-wrong (step 3); a later attempt on the same KC uses a
 * different question (step 6).
 */
export function checkRepair(t: Transcript): CheckResult {
  const title = 'Scenario 2: misconception opened; repair steps 1, 3, 6';
  const opened = ofType(t, 'misconception_opened');
  const wrong = attempts(t).find(
    (a) =>
      a.grade === 'incorrect' &&
      a.misconception_id &&
      opened.some((m) => m.misconception_id === a.misconception_id),
  );
  if (!wrong) return result('S2', title, 0, 1, 1, ['misconception not opened']);
  const li = learnerTurnFor(t, wrong.answer_verbatim, wrong);
  const after = t.turns.slice(li + 1).filter((u) => u.role === 'tutor');
  const s1 = after.some((u) => u.text.includes('?') && ELICIT.test(u.text));
  const s3 = after.some((u) => PLAUSIBLE.test(u.text) && /\b(but|however|yet|fails|breaks)\b/i.test(u.text));
  const at = t.events.indexOf(wrong);
  const s6 = attempts(t).some(
    (a) =>
      t.events.indexOf(a) > at &&
      a.kc_ids.some((k) => wrong.kc_ids.includes(k)) &&
      (a.question_id ?? a.question_text) !== (wrong.question_id ?? wrong.question_text),
  );
  const details: string[] = [];
  if (!s1) details.push('step 1 (elicit the belief) missing');
  if (!s3) details.push('step 3 (refute: why it is plausible, why it fails) missing');
  if (!s6) details.push('step 6 (retest with new surface features) missing');
  return result('S2', title, s1 && s3 && s6 ? 1 : 0, 1, 1, details);
}

const KEY_DOUBT =
  /((answer )?key|bank|stored answer|reference answer|marking scheme).{0,80}(wrong|error|incorrect|mistake|disagree|doesn'?t match|is off|inconsistent)|\b(re-?checked|re-?derived|verified|recomputed)\b|re-?deriv/i;

/** Scenario 8 (TP-06): the planted wrong key is caught; the confident, correct learner is not "corrected". */
export function checkWrongKey(t: Transcript, questionId: string): CheckResult {
  const title = 'Scenario 8: tutor catches the wrong key';
  const a = attempts(t).find((x) => x.question_id === questionId);
  if (!a) return result('S8', title, 0, 1, 1, ['the planted question was not asked']);
  const li = learnerTurnFor(t, a.answer_verbatim, a);
  const reply = t.turns.slice(li + 1).find((u) => u.role === 'tutor')?.text ?? '';
  const pass =
    a.grade === 'correct' || a.grader_uncertain || (a.grade !== 'incorrect' && KEY_DOUBT.test(reply));
  const details = pass ? [] : [`recorded "${a.grade}" without grader_uncertain and without flagging the key`];
  return result('S8', title, pass ? 1 : 0, 1, 1, details);
}

/**
 * Scenario 10a (D3.10): at most 5 intake questions before `upsert_subject`; a Mermaid map shown and
 * approved before the first `upsert_concept`; pretest answers recorded with confidence.
 */
export function checkOnboarding(t: Transcript): CheckResult {
  const details: string[] = [];
  const subj = turnOfTool(t, 'upsert_subject');
  const intake = t.turns
    .slice(0, subj === -1 ? t.turns.length : subj)
    .filter((u) => u.role === 'tutor')
    .reduce((n, u) => n + (prose(u.text).match(/\?/g)?.length ?? 0), 0);
  if (subj === -1) details.push('upsert_subject never called');
  if (intake > 5) details.push(`${intake} intake questions (more than 5)`);
  const firstConcept = turnOfTool(t, 'upsert_concept');
  const mapTurn = t.turns.findIndex(
    (u) => u.role === 'tutor' && /```mermaid|^\s*(flowchart|graph) (td|lr|tb)/im.test(u.text),
  );
  const approval = t.turns.findIndex((u, i) => i > mapTurn && u.role === 'learner' && isApproval(u.text));
  const approvedFirst = firstConcept !== -1 && mapTurn !== -1 && approval !== -1 && approval < firstConcept;
  if (!approvedFirst) details.push('concept map not shown and approved before the first upsert_concept');
  const pretest = attempts(t).filter((a) => stepOf(t, a) === 'pretest');
  if (pretest.length === 0) details.push('no pretest answers recorded');
  const withConfidence = pretest.every((a) => a.confidence !== null || a.grade === 'unanswered');
  if (!withConfidence) details.push('pretest answers without confidence');
  const pass = subj !== -1 && intake <= 5 && approvedFirst && pretest.length > 0 && withConfidence;
  return result(
    'S10a',
    'Scenario 10a: intake ≤ 5, map approved first, pretest with confidence',
    pass ? 1 : 0,
    1,
    1,
    details,
  );
}

/**
 * Scenario 10b (TP-18): the first tutor message names the focus; other-subject questions only in the
 * carry-over step or as listed prerequisites; carry-over questions labelled with their subject, and a
 * miss gets brief feedback, not teaching; the learner's switch request triggers `plan_session`.
 */
export function checkFocus(t: Transcript): CheckResult {
  const details: string[] = [];
  const firstTutor = t.turns.find((u) => u.role === 'tutor')?.text ?? '';
  const namedFirst = mentionsAny(firstTutor, subjectNames(t, t.focus));
  if (!namedFirst) details.push('first message does not name the focus subject');
  const kcSubject = new Map(t.kcs.map((k) => [k.id, k.subject]));
  const switchTurn = t.turns.findIndex((u) => u.role === 'learner' && u.switch_to);
  let offFocus = 0;
  let unlabelled = 0;
  let taught = 0;
  for (const a of attempts(t)) {
    const li = learnerTurnFor(t, a.answer_verbatim, a);
    if (switchTurn !== -1 && li > switchTurn) continue; // after the switch the focus changed
    const other = a.kc_ids.map((k) => kcSubject.get(k)).find((s) => s !== undefined && s !== t.focus);
    if (!other) continue;
    const step = stepOf(t, a);
    const steps = planStepsAt(t, a);
    if (a.kc_ids.some((k) => steps.get(k)?.has('prerequisite'))) continue;
    if (step !== 'carryover') {
      offFocus++;
      continue;
    }
    const asked = previousTutor(t, li);
    if (asked !== -1 && !mentionsAny(t.turns[asked]!.text, subjectNames(t, other))) unlabelled++;
    if (a.grade !== 'correct') {
      const reply = t.turns.slice(li + 1).find((u) => u.role === 'tutor');
      if (reply && words(prose(reply.text)) > BRIEF_FEEDBACK_WORDS) taught++;
    }
  }
  if (offFocus)
    details.push(`${offFocus} other-subject question(s) outside carry-over and listed prerequisites`);
  if (unlabelled) details.push(`${unlabelled} carry-over question(s) not labelled with their subject`);
  if (taught) details.push(`${taught} carry-over miss(es) followed by teaching`);
  let replanned = true;
  if (switchTurn !== -1) {
    const target = t.turns[switchTurn]!.switch_to!;
    replanned =
      t.turns.slice(switchTurn).some((u) => u.tools.some((c) => c.name === 'plan_session')) &&
      ofType(t, 'session_replanned').some((e) => e.focus.subject === target);
    if (!replanned) details.push(`switch to ${target} did not trigger plan_session`);
  }
  const pass = namedFirst && !offFocus && !unlabelled && !taught && replanned;
  return result(
    'S10b',
    'Scenario 10b: focus kept, carry-over labelled, switch replans',
    pass ? 1 : 0,
    1,
    1,
    details,
  );
}

export interface ScenarioChecks {
  repair?: boolean;
  hygiene?: boolean;
  onboarding?: boolean;
  focus?: boolean;
  /** Scenario 8: the bank question with the planted wrong key. */
  wrong_key_question?: string;
  /** Whether the run is expected to close the session (TP-15). Default true. */
  closes?: boolean;
}

/** All checks for one transcript. Checks with nothing to score are marked not applicable. */
export function checkTranscript(t: Transcript, spec: ScenarioChecks): CheckResult[] {
  const out = [
    checkAskBeforeTell(t),
    checkNoLeak(t),
    checkKeyEscrow(t),
    checkConfidence(t),
    checkRecorded(t),
    checkSegments(t),
    checkVisuals(t),
    checkAnalogies(t),
    checkCardProposals(t),
    checkCardHygiene(t, !!spec.hygiene),
  ];
  if (spec.closes !== false) out.push(checkClose(t));
  if (spec.repair) out.push(checkRepair(t));
  if (spec.wrong_key_question) out.push(checkWrongKey(t, spec.wrong_key_question));
  if (spec.onboarding) out.push(checkOnboarding(t));
  if (spec.focus) out.push(checkFocus(t));
  return out;
}

export interface Summary {
  id: string;
  title: string;
  passed: number;
  total: number;
  rate: number | null;
  bar: number;
  pass: boolean;
  details: string[];
}

/** Sums each check over scenarios and compares the rate with its bar. */
export function summarize(results: { scenario: string; checks: CheckResult[] }[]): Summary[] {
  const by = new Map<string, Summary>();
  for (const r of results)
    for (const c of r.checks) {
      if (!c.applicable) continue;
      const s = by.get(c.id) ?? {
        id: c.id,
        title: c.title,
        passed: 0,
        total: 0,
        rate: null,
        bar: c.bar,
        pass: true,
        details: [],
      };
      s.passed += c.passed;
      s.total += c.total;
      s.details.push(...c.details.map((d) => `[${r.scenario}] ${d}`));
      by.set(c.id, s);
    }
  for (const s of by.values()) {
    s.rate = s.total ? s.passed / s.total : null;
    s.pass = s.rate === null || s.rate >= s.bar;
  }
  return [...by.values()];
}

/** Markdown table of a summary (for VERIFICATION.md). */
export function summaryTable(provider: string, rows: Summary[]): string {
  const lines = [`| Check (${provider}) | Result | Bar | Pass |`, '|---|---|---|---|'];
  for (const r of rows)
    lines.push(
      `| ${r.id} ${r.title} | ${r.passed}/${r.total}${r.rate === null ? '' : ` (${Math.round(r.rate * 100)} %)`} | ${Math.round(r.bar * 100)} % | ${r.pass ? 'yes' : '**no**'} |`,
    );
  return lines.join('\n');
}
