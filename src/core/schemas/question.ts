import { z } from 'zod';
import {
  Actor,
  IsoDate,
  KcId,
  MediumText,
  MisconceptionId,
  QFormat,
  QType,
  QuestionId,
  ShortText,
  VisualId,
} from './common.js';

// QB-02: Scaffold/Questions/Q-0001.md frontmatter.

export const RubricItem = z.object({
  id: z.string().min(1).max(10),
  proposition: z.string().min(3).max(500),
});

export const NumericKey = z.object({
  value: z.number(),
  unit: z.string().max(30),
  /** Absolute tolerance in `unit`, or a relative one like "2%". */
  tolerance: z.union([z.number().min(0), z.string().regex(/^\d+(\.\d+)?%$/)]),
});
export type NumericKey = z.infer<typeof NumericKey>;

export const MisconceptionTarget = z.object({
  option_or_belief: z.string().min(1).max(500),
  misconception_id: MisconceptionId.nullable(),
});

export const ReviewVerdict = z.enum(['ok', 'fix', 'reject']);
export type ReviewVerdict = z.infer<typeof ReviewVerdict>;

export const QuestionReview = z.object({
  by: Actor.nullable(),
  verdict: z.enum(['pending', 'ok', 'fix', 'reject']),
  notes: z.string().max(2000).default(''),
});

export const QuestionStats = z.object({
  attempts: z.number().int().min(0),
  correct_rate: z.number().min(0).max(1).nullable(),
  last_used: IsoDate.nullable(),
});

/** Fields an author supplies (add_question). */
export const QuestionInput = z.object({
  kc_ids: z.array(KcId).min(1).max(2),
  qtype: QType,
  format: QFormat,
  difficulty: z.number().int().min(1).max(5),
  stem: MediumText.pipe(z.string().min(5)),
  /** Options for `mc` questions (extension of QB-02; see DECISIONS.md). */
  options: z.array(z.string().min(1).max(300)).max(6).optional(),
  /** Text answer; for mc the correct option text or letter; for numeric see `numeric`. */
  answer_key: MediumText,
  numeric: NumericKey.optional(),
  rubric: z.array(RubricItem),
  hints: z.array(z.string().max(2000)),
  misconception_targets: z.array(MisconceptionTarget).max(8).default([]),
  visual_id: VisualId.optional(),
  source_ref: ShortText.optional(),
  variant_of: QuestionId.optional(),
  created_by: Actor,
});
export type QuestionInput = z.input<typeof QuestionInput>;
export type QuestionInputParsed = z.infer<typeof QuestionInput>;

export const Question = QuestionInput.extend({
  id: QuestionId,
  review: QuestionReview,
  stats: QuestionStats,
});
export type Question = z.infer<typeof Question>;

/** What next_questions may reveal (QB-05): no key, rubric, hints or misconception map. */
export interface QuestionStem {
  id: string;
  kc_ids: string[];
  qtype: string;
  format: string;
  difficulty: number;
  stem: string;
  options?: string[];
  visual_id?: string;
  unit_expected?: string;
}

export function toStem(q: Question): QuestionStem {
  const s: QuestionStem = {
    id: q.id,
    kc_ids: q.kc_ids,
    qtype: q.qtype,
    format: q.format,
    difficulty: q.difficulty,
    stem: q.stem,
  };
  if (q.options) s.options = q.options;
  if (q.visual_id) s.visual_id = q.visual_id;
  if (q.format === 'numeric' && q.numeric?.unit) s.unit_expected = q.numeric.unit;
  return s;
}
