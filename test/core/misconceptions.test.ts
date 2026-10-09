import { describe, expect, it } from 'vitest';
import { LogBuilder } from '../helpers/builder.js';

// V-CORE: LM-05 misconception flag, open and resolve.

const K = 'kc-si-gamma';
const M = 'M-0001';
const BELIEF = 'A 50 Ω line never reflects, whatever terminates it';

function base(): LogBuilder {
  return new LogBuilder().subject('si-pi').kc(K, 'si-pi');
}

function stateOf(b: LogBuilder): string | undefined {
  return b.derive().misconceptions.find((m) => m.id === M)?.state;
}

describe('LM-05 misconceptions', () => {
  it('opens on a confident (≥3) incorrect answer with a stated belief', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 3, mid: M, belief: BELIEF });
    expect(stateOf(b)).toBe('open');
    expect(b.derive().kcs[K]!.misconception_active).toBe(true);
  });

  it('does not open on a single low-confidence error (candidate only)', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 2, mid: M, belief: BELIEF });
    expect(stateOf(b)).toBe('candidate');
    expect(b.derive().kcs[K]!.misconception_active).toBe(false);
  });

  it('opens when the same misconception_id appears twice at any confidence', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 1, mid: M, belief: BELIEF });
    b.hours(1).attempt(K, 'incorrect', { conf: 2, mid: M });
    expect(stateOf(b)).toBe('open');
  });

  it('LM-07: "I don\'t know" never opens a misconception', () => {
    const b = base();
    b.attempt(K, 'unanswered', { conf: null });
    b.attempt(K, 'unanswered', { conf: null });
    expect(b.derive().misconceptions).toHaveLength(0);
  });

  it('resolves after correct unassisted answers to 2 targeting questions in 2 sessions ≥ 20 h apart', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', {
      conf: 3,
      mid: M,
      text: 'retest variant A',
      session: 'S-2026-09-01-1',
    });
    expect(stateOf(b)).toBe('open');
    b.hours(22).attempt(K, 'correct', {
      conf: 3,
      mid: M,
      text: 'delayed probe B',
      session: 'S-2026-09-02-1',
    });
    expect(stateOf(b)).toBe('resolved');
    expect(b.derive().kcs[K]!.misconception_active).toBe(false);
  });

  it('does not resolve when both correct answers come from one session', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 3, mid: M, text: 'A', session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 3, mid: M, text: 'B', session: 'S-2026-09-01-1' });
    expect(stateOf(b)).toBe('open');
  });

  it('does not resolve when the sessions are less than 20 h apart', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 3, mid: M, text: 'A', session: 'S-2026-09-01-1' });
    b.hours(10).attempt(K, 'correct', { conf: 3, mid: M, text: 'B', session: 'S-2026-09-01-2' });
    expect(stateOf(b)).toBe('open');
  });

  it('does not resolve with the same question twice', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 3, mid: M, text: 'same', session: 'S-2026-09-01-1' });
    b.hours(30).attempt(K, 'correct', { conf: 3, mid: M, text: 'same', session: 'S-2026-09-02-1' });
    expect(stateOf(b)).toBe('open');
  });

  it('guesses and assisted answers do not resolve it', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 1, mid: M, text: 'A', session: 'S-2026-09-01-1' });
    b.hours(30).attempt(K, 'correct', {
      conf: 3,
      mid: M,
      text: 'B',
      session: 'S-2026-09-02-1',
      assisted: true,
    });
    expect(stateOf(b)).toBe('open');
  });

  it('reopens when the belief shows up again after resolution', () => {
    const b = base();
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 3, mid: M, text: 'A', session: 'S-2026-09-01-1' });
    b.hours(22).attempt(K, 'correct', { conf: 3, mid: M, text: 'B', session: 'S-2026-09-02-1' });
    expect(stateOf(b)).toBe('resolved');
    b.days(5).attempt(K, 'incorrect', { conf: 2, mid: M, session: 'S-2026-09-07-1' });
    expect(stateOf(b)).toBe('open');
  });

  it('opens through an explicit misconception_opened event', () => {
    const b = base();
    b.push({
      type: 'misconception_opened',
      misconception_id: M,
      kc_ids: [K],
      belief: BELIEF,
      session_id: null,
      attempt_id: null,
      by: 'claude-desktop',
    });
    expect(stateOf(b)).toBe('open');
  });

  it('bank questions that target the misconception count toward resolution', () => {
    const b = base();
    for (const [qid, stem] of [
      ['Q-0001', 'A 50 Ω line ends in an open. What does the source see at t = 3 TD?'],
      ['Q-0002', 'Which termination gives Γ = 0 on a 50 Ω line, and why?'],
    ] as const) {
      b.push({
        type: 'question_added',
        question_id: qid,
        key_hash: 'x',
        question: {
          kc_ids: [K],
          qtype: 'predict',
          format: 'free',
          difficulty: 2,
          stem,
          answer_key: 'k',
          rubric: [{ id: 'R1', proposition: 'something true' }],
          hints: ['a', 'b', 'c', 'd'],
          misconception_targets: [{ option_or_belief: BELIEF, misconception_id: M }],
          created_by: 'codex',
        },
      });
    }
    b.attempt(K, 'incorrect', { conf: 4, mid: M, belief: BELIEF, session: 'S-2026-09-01-1' });
    b.hours(1).attempt(K, 'correct', { conf: 3, q: 'Q-0001', session: 'S-2026-09-01-1' });
    b.hours(22).attempt(K, 'correct', { conf: 3, q: 'Q-0002', session: 'S-2026-09-02-1' });
    expect(stateOf(b)).toBe('resolved');
  });
});
