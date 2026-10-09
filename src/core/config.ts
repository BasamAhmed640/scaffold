import { z } from 'zod';
import { DEEP_QTYPES, QType } from './schemas/common.js';

// Thresholds live in config.json (LM-05). Every value here is a DEFAULT recorded in DECISIONS.md.

export const ConfigSchema = z.object({
  schema_version: z.number().int().default(1),
  /** IANA time zone used for session ids and local timestamps; null = system zone. */
  timezone: z.string().nullable().default(null),
  thresholds: z
    .object({
      mastery_window_days: z.number().default(60),
      mastery_min_correct: z.number().int().default(3),
      mastery_min_confidence: z.number().int().min(1).max(4).default(3),
      mastery_min_qtypes: z.number().int().default(2),
      mastery_deep_qtypes: z.array(QType).default([...DEEP_QTYPES]),
      mastery_min_sessions: z.number().int().default(2),
      session_gap_hours: z.number().default(20),
      forgotten_after_days: z.number().default(3),
      forgotten_retrievability: z.number().default(0.7),
      misconception_open_confidence: z.number().int().default(3),
      misconception_resolve_questions: z.number().int().default(2),
      misconception_resolve_sessions: z.number().int().default(2),
    })
    .prefault({}),
  fsrs: z
    .object({
      desired_retention: z.number().min(0.5).max(0.99).default(0.85),
      maximum_interval_days: z.number().int().default(36500),
    })
    .prefault({}),
  planner: z
    .object({
      session_minutes: z.number().default(30),
      carryover: z.number().int().min(0).max(2).default(2),
      pretest_max: z.number().int().default(8),
      pretest_min_after_trim: z.number().int().default(3),
      warmup_max: z.number().int().default(5),
      warmup_min_after_trim: z.number().int().default(2),
      new_max: z.number().int().default(2),
      backlog_blocks_new: z.number().int().default(8),
      exit_items: z.number().int().min(2).max(3).default(3),
      minutes_pretest_item: z.number().default(1),
      minutes_warmup_item: z.number().default(1),
      minutes_carryover_item: z.number().default(1),
      minutes_prerequisite_item: z.number().default(1),
      minutes_repair: z.number().default(5),
      minutes_new_kc: z.number().default(6.5),
      minutes_exit: z.number().default(5),
      open_session_resume_hours: z.number().default(12),
    })
    .prefault({}),
  briefing: z
    .object({
      max_tokens: z.number().int().default(600),
      backlog_warn: z.number().int().default(8),
      stale_subject_days: z.number().int().default(14),
      other_subjects_max: z.number().int().default(3),
    })
    .prefault({}),
  prefs: z
    .object({
      session_minutes: z.number().default(30),
      analogies: z.enum(['off', 'sparing', 'on']).default('sparing'),
      level: z.string().default('start below assumed level'),
    })
    .prefault({}),
  anki: z
    .object({
      url: z.string().default('http://127.0.0.1:8765'),
      timeout_ms: z.number().int().default(2000),
      api_version: z.number().int().default(6),
      minutes_per_day: z.number().default(15),
      new_cards_per_day_total: z.number().int().default(4),
      max_reviews_per_day: z.number().int().default(9999),
      default_seconds_per_review: z.number().default(8),
      card_lifetime_minutes: z.number().default(5),
      max_cards_per_kc: z.number().int().default(3),
      intake_warn_fraction: z.number().default(0.8),
      overbudget_dormancy_days: z.number().int().default(14),
      mature_interval_days: z.number().int().default(90),
      volatile_review_months: z.number().int().default(6),
      learning_reviews_per_day: z.number().default(2),
    })
    .prefault({}),
  visuals: z
    .object({
      max_bytes: z.number().int().default(600_000),
      min_font_px: z.number().default(11),
    })
    .prefault({}),
});
export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw ?? {});
}
