import { z } from 'zod';
import { IsoDate, KcId, KcKind, ShortText, Status, SubjectId, VisualId, Volatility } from './common.js';

// LM-01: concept-note field names are fixed.

/** Learner-owned frontmatter of a concept note (input to upsert_concept). */
export const KcFields = z.object({
  id: KcId,
  title: z.string().min(1).max(200),
  subject: SubjectId,
  kind: KcKind.default('concept'),
  prerequisites: z.array(KcId).max(30).default([]),
  confusable_with: z.array(KcId).max(10).default([]),
  requires_visual: z.boolean().default(false),
  volatility: Volatility.default('stable'),
  review_by: IsoDate.nullable().default(null),
  anki_note_ids: z.array(z.number().int().positive()).max(50).default([]),
  visuals: z.array(VisualId).max(50).default([]),
  sources: z.array(ShortText).max(30).default([]),
});
export type KcFields = z.infer<typeof KcFields>;

/** LM-02: derived keys, written only by scaffold-core. */
export const DERIVED_KC_KEYS = [
  'status',
  'misconception_active',
  'mastery',
  'memory',
  'last_assessed',
  'needs_check',
] as const;

export const KcMemory = z.object({
  stability_days: z.number(),
  difficulty: z.number(),
  retrievability: z.number(),
  next_check: IsoDate.nullable(),
});
export type KcMemory = z.infer<typeof KcMemory>;

export const KcDerived = z.object({
  status: Status,
  misconception_active: z.boolean(),
  mastery: z.string(),
  memory: KcMemory.nullable(),
  last_assessed: IsoDate.nullable(),
  needs_check: z.boolean(),
});
export type KcDerived = z.infer<typeof KcDerived>;

/** Body sections that belong to a concept note template. */
export const KC_SECTIONS = [
  'In my words',
  'Explanation',
  'Worked example',
  'Misconceptions seen',
  'Visuals',
  'Questions',
] as const;

/** Sections whose change marks linked Anki cards stale (ANK-05). */
export const STALENESS_SECTIONS = ['Explanation', 'Worked example'] as const;
