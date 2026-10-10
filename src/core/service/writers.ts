import type { Warnings } from '../envelope.js';
import { derivedFrontmatter, type DerivedState, type KcState } from '../model/derive.js';
import type { LearnerFacts } from '../model/facts.js';
import { lastSessionOn } from '../planner/focus.js';
import { backlogCount, reviewNeed } from '../planner/plan.js';
import type { AttemptEvent } from '../schemas/events.js';
import { localDate, ms } from '../time.js';
import { cmp } from '../util.js';
import { conceptMap } from '../vault/mermaid.js';
import { region } from '../vault/markers.js';
import { conceptRel, FOLDERS, sessionRel, subjectRel } from '../vault/vault.js';
import type { BankLoad } from './bank.js';
import type { Scaffold } from './scaffold.js';

// Generated parts of notes. Only derived keys and marker regions are written (LM-02).

const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function kcDerived(k: KcState, sc: Scaffold): Record<string, unknown> {
  const due = reviewNeed(k, sc.cfg());
  return { ...derivedFrontmatter(k, sc.tz()), due: !!due && due.category <= 4 };
}

export function writeConceptNote(
  sc: Scaffold,
  k: KcState,
  facts: LearnerFacts,
  derived: DerivedState,
  bank: BankLoad,
  w: Warnings,
): boolean {
  const rel = conceptRel(k.id);
  if (!sc.vault.exists(rel)) return false;
  const ms_ = derived.misconceptions.filter((m) => m.kc_ids.includes(k.id) && m.state !== 'candidate');
  const misText = ms_.length
    ? ms_
        .map(
          (m) => `- **${m.id}** (${m.state}${m.since ? `, since ${m.since.slice(0, 10)}` : ''}): ${m.belief}`,
        )
        .join('\n')
    : '_None recorded._';
  const visuals = Object.values(facts.visuals)
    .filter((v) => v.kc_ids.includes(k.id))
    .sort((a, b) => cmp(a.id, b.id));
  const visText = visuals.length
    ? visuals.map((v) => `- [[Scaffold/Visuals/${v.id}/spec|${v.id} · ${esc(v.title)}]]`).join('\n')
    : '_None yet._';
  const qs = bank.entries.filter((e) => e.question.kc_ids.includes(k.id)).map((e) => e.question);
  const qText = qs.length
    ? qs
        .map((q) => {
          const verdict = facts.questions[q.id]?.verdict ?? 'pending';
          return `- [[Scaffold/Questions/${q.id}|${q.id}]] · ${q.qtype} · review: ${verdict}`;
        })
        .join('\n')
    : '_None yet._';
  return sc.vault.writeDerived(
    rel,
    kcDerived(k, sc),
    { misconceptions: misText, visuals: visText, questions: qText },
    (m) => w.add(m),
  );
}

export function writeSubjectNote(
  sc: Scaffold,
  subjectId: string,
  facts: LearnerFacts,
  derived: DerivedState,
  w: Warnings,
): boolean {
  const rel = subjectRel(subjectId);
  if (!sc.vault.exists(rel)) return false;
  const kcs = Object.values(derived.kcs).filter((k) => k.subject === subjectId);
  const last = lastSessionOn(facts, subjectId);
  const ids = new Set(kcs.map((k) => k.id));
  const external = new Set<string>();
  for (const k of kcs) for (const p of k.prerequisites) if (!ids.has(p) && derived.kcs[p]) external.add(p);
  const nodes = [
    ...kcs.map((k) => ({
      id: k.id,
      title: k.title,
      status: k.status,
      prerequisites: k.prerequisites,
      misconception: k.misconception_active,
    })),
    ...[...external].map((id) => {
      const e = derived.kcs[id]!;
      return {
        id,
        title: `${e.title} (${e.subject})`,
        status: e.status,
        prerequisites: [],
        misconception: e.misconception_active,
        external: true,
      };
    }),
  ];
  const map = kcs.length ? conceptMap(nodes) : '_No concepts yet._';
  return sc.vault.writeDerived(
    rel,
    {
      last_session: last ? localDate(new Date(ms(last.started_ts)), sc.tz()) : null,
      due: backlogCount(kcs, sc.cfg()),
    },
    { 'concept-map': map },
    (m) => w.add(m),
  );
}

export function writeLedger(sc: Scaffold, derived: DerivedState, w: Warnings): boolean {
  const rel = `${FOLDERS.learner}/Misconceptions.md`;
  if (!sc.vault.exists(rel)) return false;
  const rows = derived.misconceptions.filter((m) => m.state !== 'candidate');
  const text = rows.length
    ? [
        '| ID | Belief | Concepts | State | Since | Resolved |',
        '|---|---|---|---|---|---|',
        ...rows.map(
          (m) =>
            `| ${m.id} | ${esc(m.belief)} | ${m.kc_ids.map((k) => `[[Scaffold/Concepts/${k}\\|${k}]]`).join(', ')} | ${m.state} | ${(m.since ?? '').slice(0, 10)} | ${(m.resolved_ts ?? '').slice(0, 10)} |`,
        ),
      ].join('\n')
    : '_No misconceptions recorded._';
  return sc.vault.writeDerived(rel, {}, { ledger: text }, (m) => w.add(m));
}

const CALLOUT: Record<string, string> = {
  correct: 'success',
  partial: 'warning',
  incorrect: 'failure',
  unanswered: 'question',
};

/** D3.9: one-line calibration summary for a set of attempts. */
export function calibrationLine(
  attempts: Pick<AttemptEvent, 'grade' | 'confidence' | 'kc_ids'>[],
  titles: Record<string, string>,
): string {
  const graded = attempts.filter((a) => a.grade !== 'unanswered' && a.confidence !== null);
  const confident = graded.filter((a) => (a.confidence ?? 0) >= 3);
  const right = confident.filter((a) => a.grade === 'correct').length;
  const wrong = confident.filter((a) => a.grade !== 'correct');
  const unsureRight = graded.filter((a) => (a.confidence ?? 0) <= 2 && a.grade === 'correct').length;
  let line = `Confident and right: ${right}. Confident and wrong: ${wrong.length}`;
  if (wrong.length > 0) {
    const topics = [...new Set(wrong.flatMap((a) => a.kc_ids))].map((k) => titles[k] ?? k);
    line +=
      wrong.length === 1
        ? `, on ${topics.join(', ')}`
        : topics.length === 1
          ? `, all on ${topics[0]}`
          : `, on ${topics.join(', ')}`;
  }
  line += `. Unsure but right: ${unsureRight}.`;
  return line;
}

export function sessionAttempts(sc: Scaffold, sessionId: string): AttemptEvent[] {
  return sc
    .events()
    .filter((e): e is AttemptEvent => e.type === 'attempt' && e.session_id === sessionId)
    .sort((a, b) => ms(a.ts) - ms(b.ts));
}

/** VLT-01: the session log reads like a tutor's notebook. Regenerated inside the `log` region. */
export function writeSessionLog(sc: Scaffold, sessionId: string, bank: BankLoad, w: Warnings): boolean {
  const facts = sc.facts();
  const s = facts.sessions[sessionId];
  if (!s) return false;
  const rel = sessionRel(sessionId);
  const tz = sc.tz();
  const subjectTitle = (id: string): string =>
    id === 'all' ? 'Mixed review' : (facts.subjects[id]?.fields.title ?? id);
  const focus = s.focus_history[s.focus_history.length - 1]!.subject;
  const titles: Record<string, string> = {};
  for (const k of Object.values(facts.kcs)) titles[k.fields.id] = k.fields.title;
  const stems = new Map(bank.entries.map((e) => [e.question.id, e.question.stem]));
  const attempts = sessionAttempts(sc, sessionId);
  const derived = sc.derived();
  const opened = derived.misconceptions.filter((m) => attempts.some((a) => a.misconception_id === m.id));

  const goals = s.plan.steps.map(
    (st) => `- **${st.step}** (${st.minutes} min): ${st.items.map((i) => titles[i.kc] ?? i.kc).join(', ')}`,
  );
  if (s.focus_history.length > 1)
    goals.push(`- Focus changed: ${s.focus_history.map((f) => subjectTitle(f.subject)).join(' → ')}`);
  const qLines: string[] = [];
  for (const a of attempts) {
    const stem = a.question_id
      ? (stems.get(a.question_id) ?? '(question no longer in the bank)')
      : (a.question_text ?? '');
    const head = `> [!${CALLOUT[a.grade]}] ${a.question_id ?? 'Improvised'} · ${a.qtype} · ${a.kc_ids.map((k) => titles[k] ?? k).join(' + ')}${a.step === 'carryover' ? ' · carry-over' : ''}`;
    qLines.push(
      head,
      `> **Asked:** ${stem.replace(/\r?\n/g, ' ')}`,
      `> **Answer:** "${a.answer_verbatim.replace(/\r?\n/g, ' ')}"${a.confidence !== null ? ` (confidence ${a.confidence})` : ''}`,
      `> **Outcome:** ${a.grade}${a.assisted ? ', assisted' : ''}${a.hints_used ? `, ${a.hints_used} hint(s)` : ''}${a.grader_uncertain ? ', grader unsure' : ''}`,
      ...(a.misconception_belief ? [`> **Belief:** ${a.misconception_belief}`] : []),
      '',
    );
  }
  const body = [
    '## Goals',
    '',
    ...(goals.length ? goals : ['- (no plan recorded)']),
    '',
    '## What we did',
    '',
    s.summary ?? '_Session still open._',
    '',
    '## Questions',
    '',
    ...(qLines.length ? qLines : ['_No assessed answers._', '']),
    '## Misconceptions noticed',
    '',
    ...(opened.length ? opened.map((m) => `- **${m.id}** (${m.state}): ${m.belief}`) : ['_None._']),
    '',
    '## Calibration',
    '',
    calibrationLine(attempts, titles),
    '',
    '## Next',
    '',
    s.next_preview ?? '_To be decided._',
    ...(s.open_threads.length ? ['', '**Open threads:**', ...s.open_threads.map((t) => `- ${t}`)] : []),
  ].join('\n');

  const date = localDate(new Date(ms(s.started_ts)), tz);
  if (!sc.vault.exists(rel)) {
    const text = [
      '---',
      `session_id: ${sessionId}`,
      `date: ${date}`,
      `focus: ${focus}`,
      `minutes: ${s.minutes}`,
      'cssclasses: [scaffold, scaffold-session]',
      '---',
      '',
      `# ${sessionId} · ${subjectTitle(focus)}`,
      '',
      region('log', body, '\n'),
      '',
      '## My notes',
      '',
    ].join('\n');
    sc.vault.writeText(rel, text);
    return true;
  }
  return sc.vault.writeDerived(rel, {}, { log: body }, (m) => w.add(m));
}

export interface RefreshScope {
  kcs?: string[];
  subjects?: string[];
  all?: boolean;
  ledger?: boolean;
}

/** Writes derived fields for the listed (or all) notes. Only changed files are rewritten. */
export function refreshNotes(sc: Scaffold, scope: RefreshScope, bank: BankLoad, w: Warnings): number {
  const facts = sc.facts();
  const derived = sc.derived();
  let n = 0;
  const kcIds = scope.all ? Object.keys(derived.kcs) : (scope.kcs ?? []);
  const subjectIds = new Set(scope.all ? Object.keys(facts.subjects) : (scope.subjects ?? []));
  for (const id of kcIds) {
    const k = derived.kcs[id];
    if (!k) continue;
    subjectIds.add(k.subject);
    try {
      if (writeConceptNote(sc, k, facts, derived, bank, w)) n++;
    } catch (e) {
      w.add(`${conceptRel(id)}: not updated (${(e as Error).message})`);
    }
  }
  for (const sid of subjectIds) {
    try {
      if (writeSubjectNote(sc, sid, facts, derived, w)) n++;
    } catch (e) {
      w.add(`${subjectRel(sid)}: not updated (${(e as Error).message})`);
    }
  }
  if (scope.all || scope.ledger || kcIds.length > 0) {
    try {
      if (writeLedger(sc, derived, w)) n++;
    } catch (e) {
      w.add(`Misconceptions ledger not updated (${(e as Error).message})`);
    }
  }
  return n;
}
