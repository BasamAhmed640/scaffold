import { z } from 'zod';
import {
  Actor,
  Confidence,
  Grade,
  IsoTs,
  KcId,
  LongText,
  MediumText,
  MisconceptionId,
  QFormat,
  QType,
  QuestionId,
  Scope,
  SessionId,
  ShortText,
  SubjectId,
  VisualId,
} from './common.js';
import { KcFields } from './kc.js';
import { Plan, Focus } from './plan.js';
import { QuestionInput, ReviewVerdict } from './question.js';
import { SubjectFields } from './subject.js';

// LM-03: Scaffold/_system/events.jsonl, append-only, one JSON object per line, validated with zod.

const EventId = z.string().min(6).max(40);
const base = { id: EventId, ts: IsoTs };

export const SessionStarted = z.object({
  type: z.literal('session_started'),
  ...base,
  session_id: SessionId,
  focus: Focus,
  minutes: z.number().min(1).max(240),
  carryover: z.number().int().min(0).max(2),
  plan: Plan,
});

export const SessionReplanned = z.object({
  type: z.literal('session_replanned'),
  ...base,
  session_id: SessionId,
  focus: Focus,
  minutes: z.number().min(1).max(240),
  carryover: z.number().int().min(0).max(2),
  plan: Plan,
  reason: ShortText.default(''),
});

export const SessionEnded = z.object({
  type: z.literal('session_ended'),
  ...base,
  session_id: SessionId,
  summary: MediumText,
  open_threads: z.array(ShortText).max(10),
  next_preview: ShortText,
  auto_closed: z.boolean().default(false),
});

export const Taught = z.object({
  type: z.literal('taught'),
  ...base,
  session_id: SessionId.nullable(),
  kc_ids: z.array(KcId).min(1).max(5),
  visual_ids: z.array(VisualId).max(10).default([]),
  note: ShortText.default(''),
});

/** The attempt event; every field present, null only where noted (D2). */
export const Attempt = z
  .object({
    type: z.literal('attempt'),
    ...base,
    session_id: SessionId.nullable(),
    question_id: QuestionId.nullable(),
    /** Full stem when the question was improvised in-session; otherwise null. */
    question_text: MediumText.nullable(),
    kc_ids: z.array(KcId).min(1).max(2),
    qtype: QType,
    format: QFormat,
    answer_verbatim: MediumText,
    grade: Grade,
    rubric_hits: z.array(z.string().max(10)).max(10),
    evidence_quotes: z.array(z.string().max(500)).max(10),
    /** 1–4; null only when grade is `unanswered` (see DECISIONS.md D-07). */
    confidence: Confidence.nullable(),
    hints_used: z.number().int().min(0).max(4),
    assisted: z.boolean(),
    grader: Actor,
    grader_uncertain: z.boolean(),
    misconception_id: MisconceptionId.nullable(),
    misconception_belief: z.string().max(500).nullable(),
    /** Planner step the question came from (pretest, warmup, carryover, ...). Extension; may be null. */
    step: z.string().max(20).nullable().default(null),
  })
  .refine((a) => a.question_id !== null || a.question_text !== null, {
    message: 'question_text is required when question_id is null (improvised question)',
    path: ['question_text'],
  })
  .refine((a) => a.confidence !== null || a.grade === 'unanswered', {
    message: 'confidence is required unless the answer is "I don\'t know" (unanswered)',
    path: ['confidence'],
  });

export const MisconceptionOpened = z.object({
  type: z.literal('misconception_opened'),
  ...base,
  misconception_id: MisconceptionId,
  kc_ids: z.array(KcId).min(1).max(5),
  belief: z.string().min(3).max(500),
  session_id: SessionId.nullable(),
  attempt_id: EventId.nullable(),
  by: Actor,
});

export const AnkiReview = z.object({
  review_id: z.number().int(),
  card_id: z.number().int(),
  note_id: z.number().int(),
  kc_ids: z.array(KcId),
  subject: SubjectId.nullable(),
  anchor: z.boolean(),
  ease: z.number().int().min(0).max(4),
  revlog_type: z.number().int(),
  ivl: z.number().int(),
  last_ivl: z.number().int(),
  time_ms: z.number().int().min(0),
  ts: IsoTs,
  lapse: z.boolean(),
});
export type AnkiReview = z.infer<typeof AnkiReview>;

export const AnkiFlag = z.object({
  note_id: z.number().int(),
  card_id: z.number().int(),
  kc_ids: z.array(KcId),
  kind: z.enum(['leech', 'check']),
});

export const AnkiReviewsImported = z.object({
  type: z.literal('anki_reviews_imported'),
  ...base,
  since: IsoTs.nullable(),
  reviews: z.array(AnkiReview),
  flags: z.array(AnkiFlag),
});

export const GradeOverridden = z.object({
  type: z.literal('grade_overridden'),
  ...base,
  attempt_id: EventId,
  grade: Grade,
  by: Actor,
  reason: ShortText,
});

const SectionHashes = z.record(z.string(), z.string());

export const KcCreated = z.object({
  type: z.literal('kc_created'),
  ...base,
  kc: KcFields,
  section_hashes: SectionHashes.default({}),
  source_hashes: SectionHashes.default({}),
});

export const KcUpdated = z.object({
  type: z.literal('kc_updated'),
  ...base,
  kc_id: KcId,
  kc: KcFields,
  changed: z.array(z.string().max(80)).max(30),
  section_hashes: SectionHashes.default({}),
  source_hashes: SectionHashes.default({}),
});

export const QuestionAdded = z.object({
  type: z.literal('question_added'),
  ...base,
  question_id: QuestionId,
  question: QuestionInput,
  key_hash: z.string(),
});

export const QuestionUpdated = z.object({
  type: z.literal('question_updated'),
  ...base,
  question_id: QuestionId,
  kc_ids: z.array(KcId).min(1).max(2),
  changed: z.array(z.string().max(40)).max(20),
  key_hash: z.string(),
  misconception_ids: z.array(MisconceptionId).max(8).default([]),
});

export const QuestionReviewed = z.object({
  type: z.literal('question_reviewed'),
  ...base,
  question_id: QuestionId,
  verdict: ReviewVerdict,
  by: Actor,
  notes: z.string().max(2000).default(''),
});

export const VisualRegistered = z.object({
  type: z.literal('visual_registered'),
  ...base,
  visual_id: VisualId,
  kc_ids: z.array(KcId).max(10),
  kind: z.string().max(40),
  title: z.string().max(200),
  format: z.enum(['svg', 'html']),
  has_generator: z.boolean(),
  static_ok: z.boolean(),
  warnings: z.array(z.string().max(300)).max(20).default([]),
});

export const Admission = z.object({
  rederive: z
    .string()
    .min(3, 'admission test 1 (cannot be re-derived in ~30 s) needs a one-line answer')
    .max(300),
  instant: z
    .string()
    .min(3, 'admission test 2 (needed instantly when reasoning) needs a one-line answer')
    .max(300),
  worth: z.string().min(3, 'admission test 3 (worth ~5 min of review) needs a one-line answer').max(300),
});

export const CardProposed = z.object({
  type: z.literal('card_proposed'),
  ...base,
  proposal_id: z.string().regex(/^P-\d{4,}$/),
  session_id: SessionId.nullable(),
  kc_id: KcId,
  subject: SubjectId,
  note_type: z.enum(['basic', 'cloze']),
  front: MediumText,
  back: MediumText,
  extra: MediumText.default(''),
  anchor: z.boolean(),
  admission: Admission,
  link: z.string().max(1000),
});

export const CardFlagged = z.object({
  type: z.literal('card_flagged'),
  ...base,
  note_id: z.number().int().nullable(),
  kc_ids: z.array(KcId).max(10),
  reason: z.enum([
    'tutor_check',
    'explanation_changed',
    'answer_key_changed',
    'source_changed',
    'review_by_passed',
    'leech',
  ]),
  detail: ShortText.default(''),
  proposed: z.enum(['retire', 'rewrite', 'keep', 'check']),
  by: Actor,
});

export const CARD_ACTION_KINDS = [
  'add',
  'rewrite',
  'rewrite_reset',
  'retire',
  'dormant',
  'unsuspend',
  'pause_new',
  'unpause_new',
  'compress',
  'keep',
] as const;
export const CardActionKind = z.enum(CARD_ACTION_KINDS);
export type CardActionKind = z.infer<typeof CardActionKind>;

export const CardActionProposed = z.object({
  type: z.literal('card_action_proposed'),
  ...base,
  action_id: z.string().regex(/^CA-\d{4,}$/),
  kind: CardActionKind,
  subject: SubjectId.nullable(),
  kc_ids: z.array(KcId).max(50),
  note_ids: z.array(z.number().int()).max(2000),
  card_ids: z.array(z.number().int()).max(2000),
  reason: ShortText,
  payload: z.record(z.string(), z.unknown()).default({}),
  by: Actor,
});

export const CardActionApplied = z.object({
  type: z.literal('card_action_applied'),
  ...base,
  action_id: z.string().regex(/^CA-\d{4,}$/),
  approval: z.object({
    learner_quote: z.string().min(1, 'quote the learner’s explicit approval').max(500),
  }),
  result: z.enum(['applied', 'queued', 'aborted']),
  detail: ShortText.default(''),
  /** Note ids created by an `add` action, once known. */
  created_note_ids: z.array(z.number().int()).default([]),
});

export const SubjectCreated = z.object({
  type: z.literal('subject_created'),
  ...base,
  subject: SubjectFields,
});

export const SubjectUpdated = z.object({
  type: z.literal('subject_updated'),
  ...base,
  subject: SubjectFields,
  changed: z.array(z.string().max(40)).max(20),
});

export const SubjectScopeChanged = z.object({
  type: z.literal('subject_scope_changed'),
  ...base,
  subject_id: SubjectId,
  from: Scope,
  to: Scope,
});

/** QB-05: escrow calls are logged with timestamps (event types added; DECISIONS.md D-05). */
export const KeyRequested = z.object({
  type: z.literal('key_requested'),
  ...base,
  session_id: SessionId.nullable(),
  question_id: QuestionId,
  answer_verbatim: z.string().max(4000),
});

export const HintRequested = z.object({
  type: z.literal('hint_requested'),
  ...base,
  session_id: SessionId.nullable(),
  question_id: QuestionId,
  level: z.number().int().min(1).max(4),
});

export const ScaffoldEvent = z.discriminatedUnion('type', [
  SessionStarted,
  SessionReplanned,
  SessionEnded,
  Taught,
  Attempt,
  MisconceptionOpened,
  AnkiReviewsImported,
  GradeOverridden,
  KcCreated,
  KcUpdated,
  QuestionAdded,
  QuestionUpdated,
  QuestionReviewed,
  VisualRegistered,
  CardProposed,
  CardFlagged,
  CardActionProposed,
  CardActionApplied,
  SubjectCreated,
  SubjectUpdated,
  SubjectScopeChanged,
  KeyRequested,
  HintRequested,
]);
export type ScaffoldEvent = z.infer<typeof ScaffoldEvent>;
export type EventOf<T extends ScaffoldEvent['type']> = Extract<ScaffoldEvent, { type: T }>;
export type AttemptEvent = EventOf<'attempt'>;

export const EVENT_TYPES = ScaffoldEvent.options.map((o) => o.shape.type.value);

/** Validates one parsed JSON object as an event (throws ZodError). */
export function parseEvent(obj: unknown): ScaffoldEvent {
  return ScaffoldEvent.parse(obj);
}

export const LongNote = LongText;
