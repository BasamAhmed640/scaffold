import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { lintQuestion } from '../../questions/lint.js';
import { KcId, providerFamily, QuestionId } from '../../schemas/common.js';
import { StepName } from '../../schemas/plan.js';
import { toStem, type Question, type QuestionStem } from '../../schemas/question.js';
import { questionRel } from '../../vault/vault.js';
import { loadBank } from '../bank.js';
import type { Scaffold } from '../scaffold.js';
import { refreshNotes } from '../writers.js';
import { ankiTextByKc } from './anki-hooks.js';

// QB-05 escrow: next_questions returns stems and metadata only. QB-04 cross-model review.

export const NextInput = z.object({
  step: StepName.optional(),
  kc_ids: z.array(KcId).max(10).optional(),
  question_ids: z.array(QuestionId).max(20).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export interface NextItem {
  kc: string;
  kc_title: string;
  subject: string;
  why: string;
  step?: string;
  misconception?: string;
  prerequisite_for?: string;
  question: QuestionStem | null;
  /** When no reviewed bank question exists: what to improvise (QB-04). */
  improvise?: { qtype: string; instruction: string };
}

const IMPROVISE =
  'Improvise one question for this KC: production by default, unambiguous, answerable in one message, worded unlike its Anki cards (QB-01). Record it with record_attempt and question_text.';

export function nextQuestions(sc: Scaffold, raw: unknown, _w: Warnings): { items: NextItem[] } {
  const input = NextInput.parse(raw ?? {});
  const facts = sc.facts();
  const bank = loadBank(sc);
  const byId = new Map(bank.entries.map((e) => [e.question.id, e.question]));
  const titleOf = (k: string): string => facts.kcs[k]?.fields.title ?? k;
  const subjectOf = (k: string): string => facts.kcs[k]?.fields.subject ?? '';
  const ok = (q: Question): boolean => facts.questions[q.id]?.verdict === 'ok' && lintQuestion(q).ok;

  if (input.question_ids) {
    return {
      items: input.question_ids.map((id) => {
        const q = byId.get(id);
        if (!q) throw new ScaffoldError('unknown_question', `Question ${id} is not in the bank.`);
        const k = q.kc_ids[0]!;
        return {
          kc: k,
          kc_title: titleOf(k),
          subject: subjectOf(k),
          why: ok(q) ? 'requested' : 'requested (not yet reviewed ok)',
          question: toStem(q),
        };
      }),
    };
  }
  if (input.step) {
    const open = sc.openSession();
    if (!open)
      throw new ScaffoldError(
        'no_open_session',
        'next_questions by step needs an open session.',
        'Call start_session first.',
      );
    const step = open.plan.steps.find((s) => s.step === input.step);
    if (!step) return { items: [] };
    return {
      items: step.items.slice(0, input.limit).map((it) => {
        const q = it.question_id ? byId.get(it.question_id) : undefined;
        const item: NextItem = {
          kc: it.kc,
          kc_title: titleOf(it.kc),
          subject: it.subject,
          why: it.why,
          step: step.step,
          question: q ? toStem(q) : null,
        };
        if (it.misconception) item.misconception = it.misconception;
        if (it.prerequisite_for) item.prerequisite_for = it.prerequisite_for;
        if (!q)
          item.improvise = {
            qtype: it.qtype ?? (step.step === 'pretest' || step.step === 'new' ? 'predict' : 'recall'),
            instruction: IMPROVISE,
          };
        return item;
      }),
    };
  }
  const kcs = input.kc_ids ?? [];
  if (kcs.length === 0) throw new ScaffoldError('nothing_requested', 'Pass step, kc_ids or question_ids.');
  const derived = sc.derived();
  const items: NextItem[] = [];
  for (const k of kcs) {
    if (!facts.kcs[k]) throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`);
    const recent = new Set(derived.kcs[k]!.recent_question_keys);
    const qs = bank.entries
      .map((e) => e.question)
      .filter((q) => q.kc_ids.includes(k) && ok(q) && !recent.has(q.id));
    if (qs.length === 0)
      items.push({
        kc: k,
        kc_title: titleOf(k),
        subject: subjectOf(k),
        why: 'requested',
        question: null,
        improvise: { qtype: 'recall', instruction: IMPROVISE },
      });
    for (const q of qs.slice(0, input.limit))
      items.push({
        kc: k,
        kc_title: titleOf(k),
        subject: subjectOf(k),
        why: 'requested',
        question: toStem(q),
      });
  }
  return { items: items.slice(0, input.limit) };
}

export const ReviewInput = z.object({
  question_id: QuestionId,
  verdict: z.enum(['ok', 'fix', 'reject']).optional(),
  by: z.string().min(2).max(40).optional(),
  notes: z.string().max(2000).default(''),
});

/**
 * QB-04: a question written in one front-end is reviewed in the other (Claude ↔ ChatGPT).
 * Without a verdict it returns the full question for review; that is refused during an open
 * session so the tutor cannot read keys early (TP-08).
 */
export function reviewQuestion(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = ReviewInput.parse(raw);
  const bank = loadBank(sc);
  const q = bank.entries.find((e) => e.question.id === input.question_id)?.question;
  if (!q) throw new ScaffoldError('unknown_question', `Question ${input.question_id} is not in the bank.`);
  if (!input.verdict) {
    if (sc.openSession())
      throw new ScaffoldError(
        'review_during_session',
        'Questions are reviewed outside tutoring sessions (TP-08 escrow).',
        'End the session, then review in the other front-end.',
      );
    return {
      question: q,
      lint: lintQuestion(q, { ankiText: ankiTextByKc(sc)[q.kc_ids[0]!] ?? [] }),
      checklist: QB01_CHECKLIST,
    };
  }
  if (!input.by)
    throw new ScaffoldError(
      'reviewer_missing',
      'Pass `by` (the reviewing front-end, e.g. "codex" or "claude-code").',
    );
  const author = providerFamily(q.created_by);
  const reviewer = providerFamily(input.by);
  if (author !== 'other' && reviewer === author)
    throw new ScaffoldError(
      'same_model_review',
      `${q.id} was written by ${q.created_by}; it must be reviewed by the other model family (QB-04).`,
      author === 'claude' ? 'Review it in Codex (ChatGPT).' : 'Review it in Claude.',
    );
  if (input.verdict === 'ok') {
    const lint = lintQuestion(q, { ankiText: ankiTextByKc(sc)[q.kc_ids[0]!] ?? [] });
    if (!lint.ok)
      throw new ScaffoldError(
        'lint_failed',
        `${q.id} fails lint: ${lint.errors[0]}`,
        'Record verdict "fix" with notes instead.',
      );
  }
  sc.emit([
    {
      type: 'question_reviewed',
      question_id: q.id,
      verdict: input.verdict,
      by: input.by,
      notes: input.notes,
    },
  ]);
  sc.vault.writeDerived(
    questionRel(q.id),
    { review: { by: input.by, verdict: input.verdict, notes: input.notes } },
    {},
    (m) => w.add(m),
  );
  refreshNotes(sc, { kcs: q.kc_ids }, loadBank(sc), w);
  return { question_id: q.id, verdict: input.verdict, served: input.verdict === 'ok' };
}

export const QB01_CHECKLIST = [
  '1. Targets one KC, or one stated relation between two KCs.',
  '2. Requires production (free, number, or described sketch); multiple choice only for discriminate, each distractor mapped to a known misconception.',
  '3. Has an answer key and a rubric of 1–4 propositions; numeric answers carry units and a tolerance.',
  '4. Unambiguous: one defensible answer, or a rubric that says exactly what counts.',
  '5. Does not leak its answer through the stem, the options or option lengths.',
  '6. Worded differently from the KC’s Anki cards.',
  '7. Four-step hint ladder: H1 orient, H2 principle, H3 partial step, H4 full worked answer.',
  '8. Answerable in one chat message.',
];

export const GetQuestionInput = z.object({ question_id: QuestionId });

/** CLI `q get`: full question for the owner (not an MCP tool, to keep the escrow). */
export function getQuestionFull(sc: Scaffold, raw: unknown) {
  const { question_id } = GetQuestionInput.parse(raw);
  const q = loadBank(sc).entries.find((e) => e.question.id === question_id)?.question;
  if (!q) throw new ScaffoldError('unknown_question', `Question ${question_id} is not in the bank.`);
  return { question: q, verdict: sc.facts().questions[q.id]?.verdict ?? 'pending', lint: lintQuestion(q) };
}

/** QB-03 over the whole bank. */
export function lintBank(sc: Scaffold, _raw: unknown, _w: Warnings) {
  const bank = loadBank(sc);
  const anki = ankiTextByKc(sc);
  const results = bank.entries.map(({ question: q }) => ({
    id: q.id,
    ...lintQuestion(q, { ankiText: anki[q.kc_ids[0]!] ?? [] }),
  }));
  return {
    total: results.length,
    passing: results.filter((r) => r.ok).length,
    failing: results.filter((r) => !r.ok),
    unreadable: bank.issues,
  };
}

/** Questions waiting for a cross-model review, for the batch job (AD-06). */
export function pendingReviews(sc: Scaffold) {
  const facts = sc.facts();
  return loadBank(sc)
    .entries.filter((e) => (facts.questions[e.question.id]?.verdict ?? 'pending') !== 'ok')
    .map((e) => ({
      id: e.question.id,
      created_by: e.question.created_by,
      verdict: facts.questions[e.question.id]?.verdict ?? 'pending',
      reviewer_family: providerFamily(e.question.created_by) === 'claude' ? 'openai' : 'claude',
    }));
}
