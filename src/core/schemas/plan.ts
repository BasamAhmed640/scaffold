import { z } from 'zod';
import { KcId, MisconceptionId, QType, QuestionId } from './common.js';

export const STEP_NAMES = ['pretest', 'warmup', 'carryover', 'repair', 'new', 'exit'] as const;
export const StepName = z.enum(STEP_NAMES);
export type StepName = z.infer<typeof StepName>;

export const PlanItem = z.object({
  kc: KcId,
  subject: z.string().max(80),
  why: z.string().max(200),
  /** null: no reviewed bank question; the tutor improvises (QB-04). */
  question_id: QuestionId.nullable(),
  qtype: QType.optional(),
  misconception: MisconceptionId.optional(),
  /** Set when this item reviews a forgotten prerequisite of a new KC (LM-10 step 5). */
  prerequisite_for: KcId.optional(),
});
export type PlanItem = z.infer<typeof PlanItem>;

export const PlanStep = z.object({
  step: StepName,
  minutes: z.number().min(0),
  items: z.array(PlanItem),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const Focus = z.object({
  subject: z.string().max(80),
  why: z.string().max(200),
});
export type Focus = z.infer<typeof Focus>;

export const Plan = z.object({
  status: z.enum(['ok', 'intake_required']),
  focus: Focus,
  minutes_requested: z.number().min(0),
  minutes_planned: z.number().min(0),
  carryover: z.number().int().min(0).max(2),
  steps: z.array(PlanStep),
  trimmed: z.array(z.string()),
  notes: z.array(z.string()),
});
export type Plan = z.infer<typeof Plan>;
