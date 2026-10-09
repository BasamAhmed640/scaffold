import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { LogBuilder } from '../helpers/builder.js';

// V-CORE: table-driven tests for every LM-05 transition.

const K = 'kc-si-gamma';

function base(): LogBuilder {
  return new LogBuilder().subject('si-pi').kc(K, 'si-pi');
}

/** Three strong attempts in two sessions ≥ 20 h apart, with a deep question type. */
function mastered(b: LogBuilder): LogBuilder {
  b.session('S-2026-09-01-1', 'si-pi');
  b.attempt(K, 'correct', { conf: 3, qtype: 'recall', session: 'S-2026-09-01-1' });
  b.hours(1).attempt(K, 'correct', { conf: 4, qtype: 'explain', session: 'S-2026-09-01-1' });
  b.hours(23).session('S-2026-09-02-1', 'si-pi');
  b.attempt(K, 'correct', { conf: 3, qtype: 'predict', session: 'S-2026-09-02-1' });
  return b;
}

describe('LM-05 status rules', () => {
  const cases: { name: string; build: (b: LogBuilder) => void; expected: string; days?: number }[] = [
    { name: 'no events → unseen', build: () => {}, expected: 'unseen' },
    { name: 'taught only → introduced', build: (b) => b.taught(K), expected: 'introduced' },
    {
      name: 'incorrect pretest answer leaves the KC unseen',
      build: (b) => b.attempt(K, 'incorrect', { conf: 2, step: 'pretest' }),
      expected: 'unseen',
    },
    {
      name: 'LM-06 guessed correct answer (confidence 1) is not evidence',
      build: (b) => b.attempt(K, 'correct', { conf: 1 }),
      expected: 'unseen',
    },
    {
      name: 'LM-07 "I don\'t know" is unanswered and leaves the KC unseen',
      build: (b) => b.attempt(K, 'unanswered', { conf: null }),
      expected: 'unseen',
    },
    {
      name: 'assisted correct answer is not evidence (introduced after teaching)',
      build: (b) => {
        b.taught(K);
        b.attempt(K, 'correct', { conf: 4, assisted: true });
      },
      expected: 'introduced',
    },
    {
      name: 'one unassisted correct → fragile',
      build: (b) => b.attempt(K, 'correct', { conf: 3 }),
      expected: 'fragile',
    },
    {
      name: 'correct pretest answer (confidence 2) → fragile',
      build: (b) => b.attempt(K, 'correct', { conf: 2, step: 'pretest' }),
      expected: 'fragile',
    },
    { name: 'mastery conditions met → solid', build: (b) => mastered(b), expected: 'solid' },
    {
      name: 'two sessions less than 20 h apart do not count',
      build: (b) => {
        b.session('S-2026-09-01-1', 'si-pi');
        b.attempt(K, 'correct', { conf: 3, qtype: 'recall', session: 'S-2026-09-01-1' });
        b.hours(1).attempt(K, 'correct', { conf: 3, qtype: 'explain', session: 'S-2026-09-01-1' });
        b.hours(18).session('S-2026-09-02-1', 'si-pi');
        b.attempt(K, 'correct', { conf: 3, qtype: 'predict', session: 'S-2026-09-02-1' });
      },
      expected: 'fragile',
    },
    {
      name: 'no deep question type → fragile',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 3, qtype: 'recall', session: 'S-2026-09-01-1' });
        b.attempt(K, 'correct', { conf: 3, qtype: 'discriminate', session: 'S-2026-09-01-1' });
        b.hours(25).attempt(K, 'correct', { conf: 3, qtype: 'recall', session: 'S-2026-09-02-1' });
      },
      expected: 'fragile',
    },
    {
      name: 'confidence 2 answers are not mastery evidence',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 2, qtype: 'recall', session: 'S-2026-09-01-1' });
        b.attempt(K, 'correct', { conf: 2, qtype: 'explain', session: 'S-2026-09-01-1' });
        b.hours(25).attempt(K, 'correct', { conf: 2, qtype: 'predict', session: 'S-2026-09-02-1' });
      },
      expected: 'fragile',
    },
    {
      name: 'latest attempt incorrect (within 3 days) → fragile, not solid',
      build: (b) => {
        mastered(b);
        b.hours(2).attempt(K, 'incorrect', { conf: 2, session: 'S-2026-09-02-1' });
      },
      expected: 'fragile',
    },
    {
      name: 'active misconception blocks solid',
      build: (b) => {
        mastered(b);
        b.push({
          type: 'misconception_opened',
          misconception_id: 'M-0001',
          kc_ids: [K],
          belief: 'A 50 Ω line never reflects',
          session_id: null,
          attempt_id: null,
          by: 'test',
        });
        b.hours(1).attempt(K, 'correct', { conf: 3, qtype: 'recall' });
      },
      expected: 'fragile',
    },
    {
      name: 'incorrect unassisted attempt ≥ 3 days after the last success → forgotten',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 3 });
        b.days(3).attempt(K, 'incorrect', { conf: 3 });
      },
      expected: 'forgotten',
    },
    {
      name: '"I don\'t know" ≥ 3 days after the last success → forgotten',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 3 });
        b.days(4).attempt(K, 'unanswered', { conf: null });
      },
      expected: 'forgotten',
    },
    {
      name: 'incorrect attempt 2 days after success → fragile, not forgotten',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 3 });
        b.days(2).attempt(K, 'incorrect', { conf: 3 });
      },
      expected: 'fragile',
    },
    {
      name: 'anchor Anki card lapse after the last success → forgotten',
      build: (b) => {
        mastered(b);
        b.days(1).push({
          type: 'anki_reviews_imported',
          since: null,
          reviews: [
            {
              review_id: 1,
              card_id: 11,
              note_id: 111,
              kc_ids: [K],
              subject: 'si-pi',
              anchor: true,
              ease: 1,
              revlog_type: 1,
              ivl: 1,
              last_ivl: 10,
              time_ms: 8000,
              ts: b.ts,
              lapse: true,
            },
          ],
          flags: [],
        });
      },
      expected: 'forgotten',
    },
    {
      name: 'a non-anchor card lapse only marks needs_check',
      build: (b) => {
        mastered(b);
        b.days(1).push({
          type: 'anki_reviews_imported',
          since: null,
          reviews: [
            {
              review_id: 1,
              card_id: 12,
              note_id: 112,
              kc_ids: [K],
              subject: 'si-pi',
              anchor: false,
              ease: 1,
              revlog_type: 1,
              ivl: 1,
              last_ivl: 10,
              time_ms: 8000,
              ts: b.ts,
              lapse: true,
            },
          ],
          flags: [],
        });
      },
      expected: 'solid',
    },
    {
      name: 'retrievability below 0.70 (fake clock +60 days) → forgotten',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 3 });
        b.days(60);
      },
      expected: 'forgotten',
    },
    {
      name: 'a correct answer after forgetting → fragile again',
      build: (b) => {
        b.attempt(K, 'correct', { conf: 3 });
        b.days(4).attempt(K, 'incorrect', { conf: 3 });
        b.hours(1).attempt(K, 'correct', { conf: 3 });
      },
      expected: 'fragile',
    },
    {
      name: 'attempts older than the 60-day window do not count toward mastery',
      build: (b) => {
        mastered(b);
        // keep memory fresh with recent (assisted) reviews so R stays high
        for (let i = 0; i < 6; i++)
          b.days(10).attempt(K, 'correct', { conf: 3, qtype: 'recall', assisted: true });
      },
      expected: 'fragile',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const b = base();
      c.build(b);
      const d = b.derive(defaultConfig());
      expect(d.kcs[K]!.status).toBe(c.expected);
    });
  }

  it('needs_check from a non-anchor lapse is cleared by the next attempt (LM-09)', () => {
    const b = base();
    mastered(b);
    b.days(1).push({
      type: 'anki_reviews_imported',
      since: null,
      reviews: [
        {
          review_id: 1,
          card_id: 12,
          note_id: 112,
          kc_ids: [K],
          subject: 'si-pi',
          anchor: false,
          ease: 1,
          revlog_type: 1,
          ivl: 1,
          last_ivl: 10,
          time_ms: 8000,
          ts: b.ts,
          lapse: true,
        },
      ],
      flags: [],
    });
    expect(b.derive().kcs[K]!.needs_check).toBe(true);
    b.hours(1).attempt(K, 'correct', { conf: 3 });
    expect(b.derive().kcs[K]!.needs_check).toBe(false);
  });

  it('reopening a subject marks its KCs needs_check (ANK-07)', () => {
    const b = base();
    b.attempt(K, 'correct', { conf: 3 });
    b.scope('si-pi', 'active', 'paused');
    b.days(1).scope('si-pi', 'paused', 'active');
    const d = b.derive();
    expect(d.kcs[K]!.needs_check).toBe(true);
    expect(d.kcs[K]!.needs_check_reason).toBe('subject reopened');
  });

  it('mastery summary counts conditions', () => {
    const b = base();
    b.attempt(K, 'correct', { conf: 3, qtype: 'recall' });
    expect(b.derive().kcs[K]!.mastery.summary).toBe('0 of 3 conditions met');
    const b2 = base();
    mastered(b2);
    expect(b2.derive().kcs[K]!.mastery.summary).toBe('3 of 3 conditions met');
  });

  it('thresholds are configurable', () => {
    const cfg = defaultConfig();
    cfg.thresholds.mastery_min_correct = 1;
    cfg.thresholds.mastery_min_qtypes = 1;
    cfg.thresholds.mastery_min_sessions = 1;
    cfg.thresholds.mastery_deep_qtypes = ['recall'];
    const b = base();
    b.attempt(K, 'correct', { conf: 3, qtype: 'recall' });
    expect(b.derive(cfg).kcs[K]!.status).toBe('solid');
  });
});
