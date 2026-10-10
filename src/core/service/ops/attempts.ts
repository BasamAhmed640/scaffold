import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { shortHash } from '../../ids.js';
import { questionKey } from '../../model/reducer.js';
import { gradeMultipleChoice, gradeNumeric, isIDontKnow, type CodeGrade } from '../../questions/grade.js';
import { optionIndex } from '../../questions/lint.js';
import { Grade, KcId, MisconceptionId, QFormat, QType, QuestionId, SessionId } from '../../schemas/common.js';
import { NumericKey, type Question } from '../../schemas/question.js';
import { localDate, ms } from '../../time.js';
import { conceptRel, questionRel } from '../../vault/vault.js';
import { loadBank } from '../bank.js';
import type { EventDraft, Scaffold } from '../scaffold.js';
import { refreshNotes } from '../writers.js';

// TP-07 record everything; LM-04 idempotent; REL-02 code grades mc/numeric; TP-08 / QB-05 escrow.

export const RecordAttemptInput = z.object({
  id: z.string().min(6).max(40).optional(),
  session_id: SessionId.nullish(),
  question_id: QuestionId.nullish(),
  question_text: z.string().min(5).max(4000).nullish(),
  kc_ids: z.array(KcId).min(1).max(2).optional(),
  qtype: QType.optional(),
  format: QFormat.optional(),
  answer_verbatim: z.string().min(1).max(4000),
  grade: Grade.optional(),
  rubric_hits: z
    .array(z.string().max(300))
    .max(10)
    .default([])
    .describe('Rubric ids ("R1"), or the rubric point text; text is matched to its id.'),
  evidence_quotes: z.array(z.string().max(500)).max(10).default([]),
  confidence: z.number().int().min(1).max(4).nullish(),
  hints_used: z.number().int().min(0).max(4).default(0),
  assisted: z.boolean().default(false),
  grader: z.string().min(2).max(40),
  grader_uncertain: z.boolean().default(false),
  misconception_id: MisconceptionId.nullish(),
  misconception_belief: z.string().min(5).max(500).nullish(),
  step: z.enum(['pretest', 'warmup', 'carryover', 'repair', 'new', 'exit', 'other']).nullish(),
  /** Key for an improvised mc/numeric question, so code can grade it (REL-02). */
  improvised_key: z
    .object({
      numeric: NumericKey.optional(),
      options: z.array(z.string().min(1).max(300)).max(6).optional(),
      mc_answer: z.string().max(300).optional(),
    })
    .optional(),
});

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s“”"'’]+/g, ' ')
    .trim();

/** A rubric point named by id ("R1", "r1", "R1: …") or by its proposition text → its id. */
export function rubricId(hit: string, q: Question): string {
  const t = hit.trim();
  const byId = q.rubric.find(
    (r) =>
      r.id.toLowerCase() === t.toLowerCase() ||
      t.toLowerCase().startsWith(`${r.id.toLowerCase()}:`) ||
      t.toLowerCase().startsWith(`${r.id.toLowerCase()} `),
  );
  if (byId) return byId.id;
  const n = norm(t).replace(/[.;,]+$/, '');
  const byText = q.rubric.find((r) => {
    const p = norm(r.proposition).replace(/[.;,]+$/, '');
    return p === n || (n.length >= 8 && (p.includes(n) || n.includes(p)));
  });
  if (byText) return byText.id;
  throw new ScaffoldError(
    'unknown_rubric_point',
    `"${t.slice(0, 60)}" is not a rubric point of ${q.id}.`,
    `Use its rubric ids: ${q.rubric.map((r) => r.id).join(', ')}.`,
  );
}

export function recordAttempt(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = RecordAttemptInput.parse(raw);
  const facts = sc.facts();
  const bank = loadBank(sc);
  let q: Question | undefined;
  if (input.question_id) {
    q = bank.entries.find((e) => e.question.id === input.question_id)?.question;
    if (!q)
      throw new ScaffoldError(
        'unknown_question',
        `Question ${input.question_id} is not in the bank.`,
        'Use question_text for an improvised question.',
      );
  } else if (!input.question_text) {
    throw new ScaffoldError(
      'question_missing',
      'Pass question_id, or question_text for an improvised question.',
    );
  }
  const kcIds = q ? q.kc_ids : input.kc_ids;
  if (!kcIds) throw new ScaffoldError('kc_missing', 'Improvised questions need kc_ids.');
  if (q && input.kc_ids && input.kc_ids.join() !== q.kc_ids.join())
    w.add(`Using the bank question's KCs (${q.kc_ids.join(', ')}).`);
  for (const k of kcIds) if (!facts.kcs[k]) throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`);
  const qtype = q?.qtype ?? input.qtype ?? 'recall';
  const format = q?.format ?? input.format ?? 'free';
  const open = sc.openSession();
  const sessionId = input.session_id === undefined ? (open?.id ?? null) : input.session_id;
  if (sessionId && !facts.sessions[sessionId])
    throw new ScaffoldError('unknown_session', `Unknown session ${sessionId}.`);

  // Grade: code for mc/numeric (REL-02); the grader's grade for free text; LM-07 for "I don't know".
  let grade = input.grade;
  let gradedBy: 'code' | 'grader' = 'grader';
  let code: CodeGrade | null = null;
  let codeKey: unknown = null;
  if (format === 'numeric') {
    const key = q?.numeric ?? input.improvised_key?.numeric;
    if (!key)
      throw new ScaffoldError(
        'key_missing',
        'Numeric answers are graded by code: the question needs a numeric key (improvised_key.numeric).',
      );
    code = gradeNumeric(input.answer_verbatim, key);
    codeKey = key;
  } else if (format === 'mc') {
    const options = q?.options ?? input.improvised_key?.options;
    const key = q?.answer_key ?? input.improvised_key?.mc_answer;
    if (!options || !key)
      throw new ScaffoldError(
        'key_missing',
        'Multiple choice is graded by code: pass the options and the correct option (improvised_key).',
      );
    code = gradeMultipleChoice(input.answer_verbatim, options, key);
    codeKey = { answer: key, options };
  }
  if (code) {
    if (grade && grade !== code.grade)
      w.add(
        `Code graded this ${format} answer "${code.grade}" (${code.detail}); the grader's "${grade}" was ignored (REL-02).`,
      );
    grade = code.grade;
    gradedBy = 'code';
  } else if (isIDontKnow(input.answer_verbatim)) {
    grade = 'unanswered';
  }
  if (!grade)
    throw new ScaffoldError(
      'grade_missing',
      'Free-text answers need a grade (correct, partial, incorrect, unanswered).',
    );
  if (grade !== 'unanswered' && (input.confidence === null || input.confidence === undefined))
    throw new ScaffoldError(
      'confidence_missing',
      'Every assessed answer needs a confidence rating 1–4 before feedback (TP-04).',
      'Ask the learner for confidence, then record.',
    );

  // TP-07: a quoted piece of evidence for each rubric point, taken from the verbatim answer.
  if (gradedBy === 'grader' && (grade === 'correct' || grade === 'partial')) {
    if (input.rubric_hits.length === 0 && q)
      throw new ScaffoldError(
        'evidence_missing',
        'Name the rubric points the answer hits (rubric_hits) (TP-07).',
      );
    if (input.evidence_quotes.length < Math.max(1, input.rubric_hits.length))
      throw new ScaffoldError(
        'evidence_missing',
        'Quote the learner’s words as evidence for each rubric point (TP-07).',
        'Add evidence_quotes copied from the answer.',
      );
  }
  for (const quote of input.evidence_quotes) {
    if (!norm(input.answer_verbatim).includes(norm(quote)))
      throw new ScaffoldError(
        'evidence_not_in_answer',
        `Evidence "${quote.slice(0, 60)}" is not in the learner's answer.`,
        'Quote the answer verbatim.',
      );
  }
  // Tutors name rubric points by id or by their text (seen in the V-PED runs); store ids for bank
  // questions, and short text for improvised ones (D-92).
  const rubricHits = q
    ? [...new Set(input.rubric_hits.map((h) => rubricId(h, q!)))]
    : input.rubric_hits.map((h) => h.trim().slice(0, 200));

  // Hints: H4 (the full answer) makes the attempt assisted (QB-01 item 7).
  let assisted = input.assisted;
  let hints = input.hints_used;
  if (q) {
    const asked = facts.escrow.hints.filter((h) => h.question_id === q!.id && h.session_id === sessionId);
    const maxLevel = asked.reduce((m, h) => Math.max(m, h.level), 0);
    if (maxLevel > hints) hints = maxLevel;
    if (maxLevel >= 4 && !assisted) {
      assisted = true;
      w.add('Hint H4 (full answer) was shown, so this attempt is recorded as assisted.');
    }
  }
  if (hints >= 4) assisted = true;

  // Misconceptions: an id for every stated belief; mc distractors map to their misconception.
  let mid = input.misconception_id ?? null;
  let belief = input.misconception_belief ?? null;
  if (code?.chosen !== undefined && grade === 'incorrect' && q) {
    const options = q.options ?? [];
    const letter = String.fromCharCode(65 + code.chosen);
    const target = q.misconception_targets.find(
      (t) =>
        t.misconception_id &&
        (norm(t.option_or_belief) === norm(options[code.chosen!] ?? '') ||
          norm(t.option_or_belief) === norm(letter)),
    );
    if (target && !mid) {
      mid = target.misconception_id;
      belief ??= facts.misconceptions[mid!]?.belief ?? options[code.chosen] ?? null;
    }
  }
  if (grade === 'unanswered') {
    mid = null; // LM-07: never a wrong guess
    belief = null;
  }
  if (mid && !facts.misconceptions[mid] && !belief)
    throw new ScaffoldError(
      'unknown_misconception',
      `Unknown misconception ${mid}.`,
      'Pass misconception_belief to open a new one, or call list_misconceptions.',
    );
  if (belief && !mid) mid = sc.nextId('M');

  const qKey = questionKey(input.question_id ?? null, input.question_text ?? null);
  const id =
    input.id ??
    `A${shortHash([sessionId, qKey, input.answer_verbatim, kcIds.join(','), grade, input.confidence, hints, assisted].join('|'), 15)}`;
  const already = facts.attempts[id];
  const before = sc.derived();
  const draft: EventDraft = {
    type: 'attempt',
    id,
    session_id: sessionId,
    question_id: input.question_id ?? null,
    question_text: input.question_id ? null : input.question_text!,
    kc_ids: kcIds,
    qtype,
    format,
    answer_verbatim: input.answer_verbatim,
    grade,
    rubric_hits: rubricHits,
    evidence_quotes: input.evidence_quotes,
    confidence: grade === 'unanswered' ? (input.confidence ?? null) : input.confidence!,
    hints_used: hints,
    assisted,
    grader: gradedBy === 'code' ? `code:${input.grader}`.slice(0, 40) : input.grader,
    grader_uncertain: input.grader_uncertain,
    misconception_id: mid,
    misconception_belief: belief,
    step: input.step === 'other' ? null : (input.step ?? null),
  };
  const drafts: EventDraft[] = [draft];
  const written = sc.emit(drafts);
  const after = sc.derived();
  // Make the opening explicit in the log when the LM-05 rule fires (readable history).
  const opened: string[] = [];
  if (mid) {
    const was = before.misconceptions.find((m) => m.id === mid)?.state;
    const now = after.misconceptions.find((m) => m.id === mid)?.state;
    if (now === 'open' && was !== 'open') {
      opened.push(mid);
      sc.emit([
        {
          type: 'misconception_opened',
          misconception_id: mid,
          kc_ids: kcIds,
          belief: belief ?? facts.misconceptions[mid]?.belief ?? 'belief not stated',
          session_id: sessionId,
          attempt_id: id,
          by: input.grader,
        },
      ]);
    }
  }
  if (q) updateQuestionStats(sc, q, w);
  refreshNotes(sc, { kcs: kcIds }, loadBank(sc), w);
  const final = sc.derived();
  const firstCorrectThisSession =
    grade === 'correct' &&
    !assisted &&
    (input.confidence ?? 0) >= 2 &&
    !!sessionId &&
    sessionCorrectCount(sc, kcIds, sessionId) === 1;
  const res: Record<string, unknown> = {
    attempt_id: id,
    duplicate: written.length === 0 && !!already,
    grade,
    graded_by: gradedBy,
    assisted,
    status: Object.fromEntries(
      kcIds.map((k) => [k, { before: before.kcs[k]!.status, after: final.kcs[k]!.status }]),
    ),
    misconception: mid
      ? {
          id: mid,
          state: final.misconceptions.find((m) => m.id === mid)?.state ?? 'candidate',
          opened_now: opened.includes(mid),
        }
      : null,
    card_eligible: firstCorrectThisSession, // TP-14: first correct retrieval this session
  };
  // D3.6 step 7: a targeted misconception stays active until the delayed probes resolve it.
  const targeted = new Set(
    q ? q.misconception_targets.map((t) => t.misconception_id).filter((x): x is string => !!x) : [],
  );
  if (mid) targeted.add(mid);
  if (targeted.size)
    res.misconceptions_targeted = final.misconceptions
      .filter((m) => targeted.has(m.id))
      .map((m) => ({ id: m.id, state: m.state, resolve_progress: m.resolve_progress }));
  if (code) {
    res.code_detail = code.detail;
    res.key = codeKey; // the learner has answered: the key can be used for feedback (TP-05)
  }
  return res;
}

function sessionCorrectCount(sc: Scaffold, kcIds: string[], sessionId: string): number {
  return Object.values(sc.facts().attempts).filter(
    (a) =>
      a.session_id === sessionId &&
      a.grade === 'correct' &&
      !a.assisted &&
      (a.confidence ?? 0) >= 2 &&
      a.kc_ids.some((k) => kcIds.includes(k)),
  ).length;
}

/** QB-02 stats are core-owned. */
function updateQuestionStats(sc: Scaffold, q: Question, w: Warnings): void {
  const attempts = Object.values(sc.facts().attempts).filter(
    (a) => a.question_id === q.id && a.grade !== 'unanswered',
  );
  const correct = attempts.filter((a) => a.grade === 'correct').length;
  const last = attempts
    .map((a) => a.ts)
    .sort((a, b) => ms(a) - ms(b))
    .pop();
  try {
    sc.vault.writeDerived(questionRel(q.id), {
      stats: {
        attempts: attempts.length,
        correct_rate: attempts.length ? Math.round((correct / attempts.length) * 100) / 100 : null,
        last_used: last ? localDate(new Date(ms(last)), sc.tz()) : null,
      },
    });
  } catch (e) {
    w.add(`${q.id}: stats not updated (${(e as Error).message})`);
  }
}

export const KeyInput = z.object({
  question_id: QuestionId,
  /** TP-08: the key is released only after the learner answered; pass the verbatim answer (or "skipped"). */
  answer_verbatim: z.string().min(1).max(4000),
  session_id: SessionId.nullish(),
});

export function getGradingKey(sc: Scaffold, raw: unknown, _w: Warnings) {
  const input = KeyInput.parse(raw);
  const q = loadBank(sc).entries.find((e) => e.question.id === input.question_id)?.question;
  if (!q) throw new ScaffoldError('unknown_question', `Question ${input.question_id} is not in the bank.`);
  sc.emit([
    {
      type: 'key_requested',
      session_id: input.session_id ?? sc.openSession()?.id ?? null,
      question_id: q.id,
      answer_verbatim: input.answer_verbatim.slice(0, 4000),
    },
  ]);
  const out: Record<string, unknown> = {
    question_id: q.id,
    format: q.format,
    answer_key: q.answer_key,
    rubric: q.rubric,
    misconception_targets: q.misconception_targets,
  };
  if (q.numeric) out.numeric = q.numeric;
  if (q.options) {
    out.options = q.options;
    out.correct_option = String.fromCharCode(65 + optionIndex(q.options, q.answer_key));
  }
  if (q.format === 'mc' || q.format === 'numeric')
    out.note = 'Code grades this format: record_attempt with the verbatim answer.';
  return out;
}

export const HintInput = z.object({
  question_id: QuestionId,
  level: z.number().int().min(1).max(4),
  session_id: SessionId.nullish(),
});

export function getHint(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = HintInput.parse(raw);
  const q = loadBank(sc).entries.find((e) => e.question.id === input.question_id)?.question;
  if (!q) throw new ScaffoldError('unknown_question', `Question ${input.question_id} is not in the bank.`);
  const sessionId = input.session_id ?? sc.openSession()?.id ?? null;
  const before = sc
    .facts()
    .escrow.hints.filter((h) => h.question_id === q.id && h.session_id === sessionId)
    .reduce((m, h) => Math.max(m, h.level), 0);
  if (input.level > before + 1)
    w.add(`Skipping from H${before} to H${input.level}; the ladder works best one step at a time.`);
  sc.emit([{ type: 'hint_requested', session_id: sessionId, question_id: q.id, level: input.level }]);
  const names = ['H1 orient', 'H2 principle', 'H3 partial step', 'H4 full worked answer'];
  return {
    question_id: q.id,
    level: input.level,
    name: names[input.level - 1],
    hint: q.hints[input.level - 1] ?? '',
    assisted_if_used: input.level === 4,
  };
}

export const OverrideInput = z.object({
  attempt_id: z.string().min(6).max(40),
  grade: Grade,
  reason: z.string().min(3).max(500),
  by: z.string().min(2).max(40).default('owner'),
});

export function overrideGrade(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = OverrideInput.parse(raw);
  const a = sc.facts().attempts[input.attempt_id];
  if (!a) throw new ScaffoldError('unknown_attempt', `Unknown attempt ${input.attempt_id}.`);
  sc.emit([
    {
      type: 'grade_overridden',
      attempt_id: input.attempt_id,
      grade: input.grade,
      by: input.by,
      reason: input.reason,
    },
  ]);
  refreshNotes(sc, { kcs: a.kc_ids }, loadBank(sc), w);
  return { attempt_id: input.attempt_id, from: a.grade, to: input.grade };
}

export const TaughtInput = z.object({
  kc_ids: z.array(KcId).min(1).max(5),
  visual_ids: z
    .array(z.string().regex(/^V-\d{4,}$/))
    .max(10)
    .default([]),
  note: z.string().max(500).default(''),
  session_id: SessionId.nullish(),
});

export function markTaught(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = TaughtInput.parse(raw);
  const facts = sc.facts();
  for (const k of input.kc_ids) if (!facts.kcs[k]) throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`);
  const missingVisual = input.kc_ids.filter(
    (k) => facts.kcs[k]!.fields.requires_visual && input.visual_ids.length === 0,
  );
  if (missingVisual.length)
    w.add(
      `${missingVisual.join(', ')} require a visual (TP-12): show one and register it with register_visual.`,
    );
  sc.emit([
    {
      type: 'taught',
      session_id: input.session_id ?? sc.openSession()?.id ?? null,
      kc_ids: input.kc_ids,
      visual_ids: input.visual_ids,
      note: input.note,
    },
  ]);
  refreshNotes(sc, { kcs: input.kc_ids }, loadBank(sc), w);
  return {
    kc_ids: input.kc_ids,
    status: Object.fromEntries(input.kc_ids.map((k) => [k, sc.derived().kcs[k]!.status])),
  };
}

export const TeachBackInput = z.object({
  kc_id: KcId,
  text: z.string().min(10).max(2000),
});

/** D3.8: save the best teach-back to the concept note's "## In my words" (inside its marker region). */
export function saveTeachBack(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = TeachBackInput.parse(raw);
  if (!sc.facts().kcs[input.kc_id]) throw new ScaffoldError('unknown_kc', `Unknown KC ${input.kc_id}.`);
  const words = input.text.trim().split(/\s+/).length;
  if (words > 150) w.add(`The teach-back has ${words} words; the prompt asks for at most 150 (D3.8).`);
  const date = localDate(sc.now(), sc.tz());
  const ok = sc.vault.writeDerived(
    conceptRel(input.kc_id),
    {},
    { 'in-my-words': `${input.text.trim()}\n\n_Saved from a teach-back on ${date}._` },
    (m) => w.add(m),
  );
  return { kc_id: input.kc_id, saved: ok, words };
}
