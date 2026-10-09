import { defaultConfig, type Config } from '../../src/core/config.js';
import { deriveState, type DerivedState } from '../../src/core/model/derive.js';
import type { LearnerFacts } from '../../src/core/model/facts.js';
import { rebuild } from '../../src/core/model/reducer.js';
import type { Grade, QType } from '../../src/core/schemas/common.js';
import { parseEvent, type ScaffoldEvent } from '../../src/core/schemas/events.js';
import { emptyPlanFor } from './plans.js';

// Builds validated event logs for tests with explicit timestamps (fake clock).

export const TZ = 'America/New_York';

export class LogBuilder {
  readonly events: ScaffoldEvent[] = [];
  private n = 0;
  t: number;
  constructor(start = '2026-09-01T10:00:00-04:00') {
    this.t = Date.parse(start);
  }
  private id(): string {
    this.n += 1;
    return `EV${String(this.n).padStart(8, '0')}`;
  }
  get ts(): string {
    return new Date(this.t).toISOString();
  }
  at(iso: string): this {
    this.t = Date.parse(iso);
    return this;
  }
  hours(h: number): this {
    this.t += h * 3_600_000;
    return this;
  }
  days(d: number): this {
    this.t += d * 86_400_000;
    return this;
  }
  push(e: Record<string, unknown>): ScaffoldEvent {
    const ev = parseEvent({ id: this.id(), ts: this.ts, ...e });
    this.events.push(ev);
    return ev;
  }
  subject(id: string, extra: Record<string, unknown> = {}): this {
    this.push({
      type: 'subject_created',
      subject: {
        id,
        title: extra.title ?? id,
        aliases: [],
        goals: [],
        scope: 'active',
        anki_minutes: 'auto',
        ...extra,
      },
    });
    return this;
  }
  scope(subject_id: string, from: string, to: string): this {
    this.push({ type: 'subject_scope_changed', subject_id, from, to });
    return this;
  }
  kc(id: string, subject: string, extra: Record<string, unknown> = {}): this {
    this.push({
      type: 'kc_created',
      kc: {
        id,
        title: extra.title ?? id,
        subject,
        kind: 'concept',
        prerequisites: [],
        confusable_with: [],
        requires_visual: false,
        volatility: 'stable',
        review_by: null,
        anki_note_ids: [],
        visuals: [],
        sources: [],
        ...extra,
      },
    });
    return this;
  }
  session(session_id: string, subject: string): this {
    this.push({
      type: 'session_started',
      session_id,
      focus: { subject, why: 'test' },
      minutes: 30,
      carryover: 2,
      plan: emptyPlanFor(subject),
    });
    return this;
  }
  endSession(session_id: string, summary = 'done', open_threads: string[] = []): this {
    this.push({ type: 'session_ended', session_id, summary, open_threads, next_preview: 'next' });
    return this;
  }
  taught(kc: string, session_id: string | null = null): this {
    this.push({ type: 'taught', session_id, kc_ids: [kc] });
    return this;
  }
  attempt(
    kc: string | string[],
    grade: Grade,
    opts: {
      conf?: number | null;
      qtype?: QType;
      session?: string | null;
      assisted?: boolean;
      q?: string | null;
      text?: string;
      mid?: string | null;
      belief?: string | null;
      step?: string | null;
    } = {},
  ): ScaffoldEvent {
    const conf = opts.conf === undefined ? (grade === 'unanswered' ? null : 3) : opts.conf;
    const q = opts.q === undefined ? null : opts.q;
    return this.push({
      type: 'attempt',
      session_id: opts.session ?? null,
      question_id: q,
      question_text: q ? null : (opts.text ?? `improvised question ${this.n + 1}`),
      kc_ids: Array.isArray(kc) ? kc : [kc],
      qtype: opts.qtype ?? 'recall',
      format: 'free',
      answer_verbatim: 'answer',
      grade,
      rubric_hits: [],
      evidence_quotes: [],
      confidence: conf,
      hints_used: 0,
      assisted: opts.assisted ?? false,
      grader: 'test',
      grader_uncertain: false,
      misconception_id: opts.mid ?? null,
      misconception_belief: opts.belief ?? null,
      step: opts.step ?? null,
    });
  }
  facts(): LearnerFacts {
    return rebuild(this.events);
  }
  derive(cfg: Config = defaultConfig(), now?: Date): DerivedState {
    return deriveState(this.facts(), cfg, now ?? new Date(this.t), { timezone: TZ });
  }
}
