import { createEmptyCard, fsrs, Rating, type Card, type FSRS, type Grade as FsrsGrade } from 'ts-fsrs';
import type { AttemptFact } from './facts.js';

// LM-08: concept checks are scheduled with FSRS (ts-fsrs) behind an interface so it can be swapped.
// FSRS was designed for flashcards; applying it to concept checks is a reasonable extrapolation.

export type ConceptRating = 'again' | 'hard' | 'good' | 'easy';

export interface ConceptMemory {
  stability_days: number;
  difficulty: number;
  retrievability: number;
  next_check: Date;
  last_review: Date;
  reviews: number;
}

export interface ConceptScheduler {
  /** Replays rated reviews (sorted by time) and returns the memory state at `now`, or null. */
  replay(reviews: { ts: Date; rating: ConceptRating }[], now: Date): ConceptMemory | null;
}

/**
 * LM-08 rating map: incorrect → Again; correct but assisted, or confidence ≤ 2 → Hard;
 * correct, unassisted, confidence 3 → Good; correct, unassisted, confidence 4 → Easy.
 * Extensions (DECISIONS.md D-08): partial → Hard; unanswered ("I don't know") → Again.
 */
export function ratingFor(a: Pick<AttemptFact, 'grade' | 'assisted' | 'confidence'>): ConceptRating {
  if (a.grade === 'incorrect' || a.grade === 'unanswered') return 'again';
  if (a.grade === 'partial') return 'hard';
  if (a.assisted || (a.confidence ?? 1) <= 2) return 'hard';
  if (a.confidence === 3) return 'good';
  return 'easy';
}

const toFsrs: Record<ConceptRating, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export class FsrsConceptScheduler implements ConceptScheduler {
  private readonly f: FSRS;
  constructor(desiredRetention: number, maximumIntervalDays = 36500) {
    // Deterministic: no fuzz; concept checks are day-scale, so no minute-level learning steps.
    this.f = fsrs({
      request_retention: desiredRetention,
      maximum_interval: maximumIntervalDays,
      enable_fuzz: false,
      enable_short_term: false,
    });
  }

  replay(reviews: { ts: Date; rating: ConceptRating }[], now: Date): ConceptMemory | null {
    if (reviews.length === 0) return null;
    let card: Card = createEmptyCard(reviews[0]!.ts);
    for (const r of reviews) {
      const at = r.ts.getTime() < (card.last_review?.getTime() ?? 0) ? card.last_review! : r.ts;
      card = this.f.next(card, at, toFsrs[r.rating]).card;
    }
    const at = now.getTime() < (card.last_review?.getTime() ?? 0) ? card.last_review! : now;
    const r = this.f.get_retrievability(card, at, false);
    return {
      stability_days: round(card.stability, 2),
      difficulty: round(card.difficulty, 2),
      retrievability: round(r, 3),
      next_check: card.due,
      last_review: card.last_review ?? reviews[reviews.length - 1]!.ts,
      reviews: reviews.length,
    };
  }
}

function round(x: number, d: number): number {
  const p = 10 ** d;
  return Math.round(x * p) / p;
}
