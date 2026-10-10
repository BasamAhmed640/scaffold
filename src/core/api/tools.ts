import { z } from 'zod';
import { guard, type Envelope, type Warnings } from '../envelope.js';
import { addQuestion, upsertConcepts, upsertSubject } from '../service/ops/content.js';
import { doctorVault, rebuildVault, validateVault } from '../service/ops/maintenance.js';
import {
  endSession,
  EndInput,
  getBriefing,
  planSessionOp,
  PlanInput,
  startSession,
} from '../service/ops/session.js';
import {
  getGradingKey,
  getHint,
  HintInput,
  KeyInput,
  markTaught,
  overrideGrade,
  OverrideInput,
  recordAttempt,
  RecordAttemptInput,
  saveTeachBack,
  TaughtInput,
  TeachBackInput,
} from '../service/ops/attempts.js';
import { nextQuestions, NextInput, reviewQuestion, ReviewInput } from '../service/ops/questions.js';
import {
  getConcept,
  GetConceptInput,
  listMisconceptions,
  ListMisconceptionsInput,
  listSubjects,
  openMisconception,
  OpenMisconceptionInput,
} from '../service/ops/learner.js';
import type { Scaffold } from '../service/scaffold.js';
import { ankiDoctor } from '../service/anki/ops.js';
import { ANKI_TOOLS } from './anki-tools.js';

// IF-01: CLI and MCP share one implementation. Each tool: MCP name, JSON input schema, handler.
// IF-02: every call returns {ok, data, warnings[], errors[]}.

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly?: boolean;
  /** Excluded from MCP (CLI-only owner tools). */
  cliOnly?: boolean;
  handler: (sc: Scaffold, input: unknown, w: Warnings) => unknown;
}

const Empty = z.object({});

/** Wraps a free-form input in an object schema so MCP clients see a JSON Schema. */
const UpsertSubjectSchema = z
  .object({
    id: z.string().max(80).optional().describe('Stable slug; derived from the title if omitted.'),
    title: z.string().min(1).max(120),
    aliases: z.array(z.string().max(80)).max(20).optional(),
    goals: z.array(z.string().max(500)).max(20).optional(),
    scope: z
      .enum(['active', 'paused', 'closed'])
      .optional()
      .describe('Only at creation; later use set_subject_scope.'),
    anki_minutes: z.union([z.literal('auto'), z.number().min(0).max(240)]).optional(),
    anki_deck: z.string().max(200).optional(),
  })
  .loose(); // loose: derived keys reach the handler and are rejected with a specific message

const ConceptSchema = z
  .object({
    id: z.string().max(80).describe('kc-<subject>-<slug>; never renamed'),
    title: z.string().max(200),
    subject: z.string().max(80),
    kind: z.enum(['fact', 'concept', 'principle', 'procedure']).optional(),
    prerequisites: z.array(z.string().max(80)).max(30).optional(),
    confusable_with: z.array(z.string().max(80)).max(10).optional(),
    requires_visual: z.boolean().optional(),
    volatility: z.enum(['stable', 'evolving', 'volatile']).optional(),
    review_by: z.string().max(10).nullable().optional(),
    sources: z.array(z.string().max(500)).max(30).optional(),
    explanation: z.string().max(20_000).optional().describe('Written only if the section is empty (LM-02).'),
    worked_example: z.string().max(20_000).optional(),
  })
  .loose();
const UpsertConceptSchema = z.object({ concepts: z.array(ConceptSchema).min(1).max(40) });

const QuestionSchema = z.object({
  kc_ids: z.array(z.string().max(80)).min(1).max(2),
  qtype: z.enum([
    'recall',
    'explain',
    'predict',
    'apply',
    'discriminate',
    'diagnose',
    'transfer',
    'teach-back',
    'visual',
  ]),
  format: z.enum(['free', 'mc', 'numeric', 'visual']),
  difficulty: z.number().int().min(1).max(5),
  stem: z.string().max(4000),
  options: z.array(z.string().max(300)).max(6).optional(),
  answer_key: z.string().max(4000),
  numeric: z
    .object({
      value: z.number(),
      unit: z.string().max(30),
      tolerance: z.union([z.number(), z.string().max(10)]),
    })
    .optional(),
  rubric: z.array(z.object({ id: z.string().max(10), proposition: z.string().max(500) })).max(4),
  hints: z.array(z.string().max(2000)).max(4),
  misconception_targets: z
    .array(
      z.object({ option_or_belief: z.string().max(500), misconception_id: z.string().max(10).nullable() }),
    )
    .max(8)
    .optional(),
  visual_id: z.string().max(10).optional(),
  source_ref: z.string().max(500).optional(),
  variant_of: z.string().max(10).optional(),
  created_by: z
    .string()
    .min(2)
    .max(40)
    .describe('Front-end that wrote it: claude-desktop, claude-code, codex…'),
});

const ConceptRef = GetConceptInput;
const RebuildInput = z.object({ restore_missing: z.boolean().default(false) });

export const CORE_TOOLS: ToolDef[] = [
  {
    name: 'doctor',
    title: 'Health check',
    description:
      'Checks the vault, event log, config, concept graph, CSS snippet and Anki (AnkiConnect version, FSRS, deck structure, budgets, queue). Each failure has one next step.',
    input: Empty,
    readOnly: true,
    handler: async (sc, _i, w) => ({ checks: [...doctorVault(sc, w), ...(await ankiDoctor(sc))] }),
  },
  {
    name: 'get_briefing',
    title: 'Briefing',
    description:
      'At most 600 tokens: resolved focus and why, recap of the last session on that subject, due KCs, misconceptions, frontier, plan, other subjects, Anki load, warnings (LM-11). focus: a subject name/alias or "all".',
    input: PlanInput,
    readOnly: true,
    handler: (sc, i, w) => getBriefing(sc, i, w),
  },
  {
    name: 'plan_session',
    title: 'Plan session',
    description:
      'Deterministic plan that fits `minutes` (LM-10). During an open session it is logged as a replan; call it again when the learner changes the focus subject or the time (TP-09).',
    input: PlanInput,
    handler: (sc, i, w) => planSessionOp(sc, i, w),
  },
  {
    name: 'start_session',
    title: 'Start session',
    description:
      'Start here (D3.3). Pass the subject the learner named, if any. Resolves the focus (LM-15), records it with the plan, and returns the briefing. unknown_subject → offer onboarding (D3.10); subject_not_active → offer to reopen (ANK-07).',
    input: PlanInput,
    handler: (sc, i, w) => startSession(sc, i, w),
  },
  {
    name: 'end_session',
    title: 'End session',
    description:
      'Close every session (TP-15): after the exit ticket, with a summary, open threads and a one-line preview of next time. Writes the session log and returns the calibration line (D3.9).',
    input: EndInput,
    handler: (sc, i, w) => endSession(sc, i, w),
  },
  {
    name: 'upsert_subject',
    title: 'Create or update a subject',
    description:
      'Creates a subject (scope active, title, aliases) and its Anki deck Scaffold::<title> (LM-14, ANK-01). Derived fields are rejected. Scope changes go through set_subject_scope.',
    input: UpsertSubjectSchema,
    handler: (sc, i, w) => upsertSubject(sc, i, w),
  },
  {
    name: 'list_subjects',
    title: 'List subjects',
    description:
      'Subjects with ids, titles, aliases, scope, KC and due counts. Use it to map the learner’s loose phrasing to a subject.',
    input: Empty,
    readOnly: true,
    handler: (sc, i, w) => listSubjects(sc, i, w),
  },
  {
    name: 'get_concept',
    title: 'Get a concept',
    description:
      'One KC: fields, status, mastery, memory, misconceptions, recent attempts, question ids and (optionally) its note text.',
    input: ConceptRef,
    readOnly: true,
    handler: (sc, i, w) => getConcept(sc, i, w),
  },
  {
    name: 'upsert_concept',
    title: 'Create or update concepts',
    description:
      'Saves KCs (one or a batch, e.g. an approved onboarding map). Derived fields are rejected; prerequisites must form a DAG (LM-12). Explanation text is written only into empty sections.',
    input: UpsertConceptSchema,
    handler: (sc, i, w) => upsertConcepts(sc, i, w),
  },
  {
    name: 'next_questions',
    title: 'Next questions',
    description:
      'Question stems for a plan step (or KCs, or ids). Never returns keys or hints (QB-05). Items without a reviewed question say what to improvise.',
    input: NextInput,
    readOnly: true,
    handler: (sc, i, w) => nextQuestions(sc, i, w),
  },
  {
    name: 'add_question',
    title: 'Add a question',
    description:
      'Adds a bank question (QB-01/QB-02). Returns the lint result. It is served only after a cross-model review with verdict ok (QB-04).',
    input: QuestionSchema,
    handler: (sc, i, w) => addQuestion(sc, i, w),
  },
  {
    name: 'review_question',
    title: 'Review a question',
    description:
      'Cross-model review (QB-04): without verdict returns the question and QB-01 checklist (refused during a session); with verdict ok|fix|reject records it. The reviewer must be the other model family.',
    input: ReviewInput,
    handler: (sc, i, w) => reviewQuestion(sc, i, w),
  },
  {
    name: 'get_grading_key',
    title: 'Grading key (escrow)',
    description:
      'Only after the learner has answered or skipped (TP-08): pass their verbatim answer. Returns the key, rubric and misconception map. Logged.',
    input: KeyInput,
    handler: (sc, i, w) => getGradingKey(sc, i, w),
  },
  {
    name: 'get_hint',
    title: 'Hint (escrow)',
    description:
      'Only when the learner asks for help or after a wrong attempt (TP-08). Levels H1 orient, H2 principle, H3 partial step, H4 full answer (marks the attempt assisted). Logged.',
    input: HintInput,
    handler: (sc, i, w) => getHint(sc, i, w),
  },
  {
    name: 'record_attempt',
    title: 'Record an answer',
    description:
      'Record every assessed answer before moving on (TP-07, REL-01): verbatim answer, confidence 1–4 (TP-04), grade for free text with rubric_hits and evidence_quotes copied from the answer. Code grades mc/numeric. "I don\'t know" → unanswered. State a wrong belief as a proposition in misconception_belief. Idempotent.',
    input: RecordAttemptInput,
    handler: (sc, i, w) => recordAttempt(sc, i, w),
  },
  {
    name: 'mark_taught',
    title: 'Mark KCs taught',
    description:
      'Log that a KC was explained (moves unseen → introduced). Include visual ids for requires_visual KCs (TP-12).',
    input: TaughtInput,
    handler: (sc, i, w) => markTaught(sc, i, w),
  },
  {
    name: 'save_teach_back',
    title: 'Save a teach-back',
    description:
      'Saves the learner’s best teach-back (≤150 words) to the concept note’s "In my words" (D3.8).',
    input: TeachBackInput,
    handler: (sc, i, w) => saveTeachBack(sc, i, w),
  },
  {
    name: 'override_grade',
    title: 'Override a grade',
    description:
      'Correct a recorded grade (for example after verifying the key, TP-06). Logged as grade_overridden.',
    input: OverrideInput,
    handler: (sc, i, w) => overrideGrade(sc, i, w),
  },
  {
    name: 'list_misconceptions',
    title: 'List misconceptions',
    description:
      'Open, candidate and resolved misconceptions with beliefs and resolution progress. Reuse an existing id when the same belief recurs.',
    input: ListMisconceptionsInput,
    readOnly: true,
    handler: (sc, i, w) => listMisconceptions(sc, i, w),
  },
  {
    name: 'open_misconception',
    title: 'Open a misconception',
    description:
      'Opens a misconception with the wrong belief stated as a proposition. Resolution is derived, never set by hand.',
    input: OpenMisconceptionInput,
    handler: (sc, i, w) => openMisconception(sc, i, w),
  },
  {
    name: 'validate',
    title: 'Validate',
    description: 'Checks the concept DAG, notes, questions and the event log.',
    input: Empty,
    readOnly: true,
    handler: (sc, _i, w) => validateVault(sc, w),
  },
  {
    name: 'rebuild',
    title: 'Rebuild',
    description: 'Recomputes all derived fields from events.jsonl (ARC-08).',
    input: RebuildInput,
    cliOnly: true,
    handler: (sc, i, w) => rebuildVault(sc, { restoreMissing: RebuildInput.parse(i).restore_missing }, w),
  },
];

export function allTools(): ToolDef[] {
  return [...CORE_TOOLS, ...ANKI_TOOLS];
}

export function toolByName(name: string): ToolDef | undefined {
  return allTools().find((t) => t.name === name);
}

export async function callTool(sc: Scaffold, name: string, input: unknown): Promise<Envelope<unknown>> {
  const tool = toolByName(name);
  if (!tool)
    return {
      ok: false,
      data: null,
      warnings: [],
      errors: [{ code: 'unknown_tool', message: `No tool ${name}.` }],
    };
  return guard(async (w) => tool.handler(sc, tool.input.parse(input ?? {}), w));
}
