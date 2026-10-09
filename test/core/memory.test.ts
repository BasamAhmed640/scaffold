import { describe, expect, it } from 'vitest';
import { FsrsConceptScheduler, ratingFor } from '../../src/core/model/memory.js';

// V-CORE: the FSRS rating map matches LM-08.

describe('LM-08 FSRS rating map', () => {
  const table: [string, Parameters<typeof ratingFor>[0], string][] = [
    ['incorrect → Again', { grade: 'incorrect', assisted: false, confidence: 4 }, 'again'],
    ['correct but assisted → Hard', { grade: 'correct', assisted: true, confidence: 4 }, 'hard'],
    ['correct, confidence 1 → Hard', { grade: 'correct', assisted: false, confidence: 1 }, 'hard'],
    ['correct, confidence 2 → Hard', { grade: 'correct', assisted: false, confidence: 2 }, 'hard'],
    [
      'correct, unassisted, confidence 3 → Good',
      { grade: 'correct', assisted: false, confidence: 3 },
      'good',
    ],
    [
      'correct, unassisted, confidence 4 → Easy',
      { grade: 'correct', assisted: false, confidence: 4 },
      'easy',
    ],
    ['partial → Hard (D-08)', { grade: 'partial', assisted: false, confidence: 3 }, 'hard'],
    ['unanswered → Again (D-08)', { grade: 'unanswered', assisted: false, confidence: null }, 'again'],
  ];
  for (const [name, input, expected] of table) {
    it(name, () => expect(ratingFor(input)).toBe(expected));
  }

  it('schedules with desired retention 0.85 and decays retrievability over time', () => {
    const s = new FsrsConceptScheduler(0.85);
    const t0 = new Date('2026-10-01T10:00:00Z');
    const m = s.replay([{ ts: t0, rating: 'good' }], t0)!;
    expect(m.retrievability).toBe(1);
    const due = m.next_check;
    const atDue = s.replay([{ ts: t0, rating: 'good' }], due)!;
    expect(atDue.retrievability).toBeGreaterThan(0.84);
    expect(atDue.retrievability).toBeLessThan(0.87);
    const later = s.replay([{ ts: t0, rating: 'good' }], new Date(due.getTime() + 30 * 86_400_000))!;
    expect(later.retrievability).toBeLessThan(0.7);
  });

  it('is deterministic (no fuzz)', () => {
    const s = new FsrsConceptScheduler(0.85);
    const reviews = [
      { ts: new Date('2026-10-01T10:00:00Z'), rating: 'good' as const },
      { ts: new Date('2026-10-04T10:00:00Z'), rating: 'easy' as const },
    ];
    const now = new Date('2026-10-20T10:00:00Z');
    expect(s.replay(reviews, now)).toEqual(s.replay(reviews, now));
  });
});
