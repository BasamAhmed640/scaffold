import { z } from 'zod';

// D3.5 question types.
export const QTYPES = [
  'recall',
  'explain',
  'predict',
  'apply',
  'discriminate',
  'diagnose',
  'transfer',
  'teach-back',
  'visual',
] as const;
export const QType = z.enum(QTYPES);
export type QType = z.infer<typeof QType>;

/** LM-05: mastery needs at least one of these question types. */
export const DEEP_QTYPES: readonly QType[] = ['explain', 'predict', 'apply', 'transfer', 'teach-back'];

export const QFormat = z.enum(['free', 'mc', 'numeric', 'visual']);
export type QFormat = z.infer<typeof QFormat>;

/** LM-07: "I don't know" is `unanswered`, never a wrong guess. */
export const Grade = z.enum(['correct', 'partial', 'incorrect', 'unanswered']);
export type Grade = z.infer<typeof Grade>;

export const Status = z.enum(['unseen', 'introduced', 'fragile', 'solid', 'forgotten']);
export type Status = z.infer<typeof Status>;

export const KcKind = z.enum(['fact', 'concept', 'principle', 'procedure']);
export const Volatility = z.enum(['stable', 'evolving', 'volatile']);
export const Scope = z.enum(['active', 'paused', 'closed']);
export type Scope = z.infer<typeof Scope>;

/** Confidence 1 guess, 2 unsure, 3 fairly sure, 4 certain (TP-04). */
export const Confidence = z.number().int().min(1).max(4);

export const IsoTs = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)) && /T\d\d:\d\d/.test(s), 'must be an ISO 8601 timestamp');
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/** Stable slug for KCs and subjects. */
export const Slug = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'must be a lowercase slug (a-z, 0-9, -)');

export const KcId = Slug.refine((s) => s.startsWith('kc-'), 'KC ids start with "kc-"');
export const SubjectId = Slug;
export const QuestionId = z.string().regex(/^Q-\d{4,}$/, 'must look like Q-0001');
export const VisualId = z.string().regex(/^V-\d{4,}$/, 'must look like V-0001');
export const MisconceptionId = z.string().regex(/^M-\d{4,}$/, 'must look like M-0001');
export const SessionId = z.string().regex(/^S-\d{4}-\d{2}-\d{2}-\d+$/, 'must look like S-2026-10-05-1');

/** Front-end that produced a grade, question or review. */
export const Actor = z.string().min(2).max(40);

export const ShortText = z.string().max(500);
export const MediumText = z.string().max(4000);
export const LongText = z.string().max(20_000);

/** Provider family for cross-model review (QB-04). */
export function providerFamily(actor: string): 'claude' | 'openai' | 'other' {
  const a = actor.toLowerCase();
  if (a.includes('claude') || a.includes('anthropic')) return 'claude';
  if (a.includes('codex') || a.includes('chatgpt') || a.includes('gpt') || a.includes('openai'))
    return 'openai';
  return 'other';
}
