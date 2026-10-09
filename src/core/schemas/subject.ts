import { z } from 'zod';
import { Scope, ShortText, SubjectId } from './common.js';

// LM-14: one note per subject, Scaffold/Subjects/<id>.md.

export const AnkiMinutes = z.union([z.literal('auto'), z.number().min(0).max(240)]);
export type AnkiMinutes = z.infer<typeof AnkiMinutes>;

export const SubjectFields = z.object({
  id: SubjectId,
  title: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(80)).max(20).default([]),
  goals: z.array(ShortText).max(20).default([]),
  scope: Scope.default('active'),
  anki_minutes: AnkiMinutes.default('auto'),
  /** Set at creation to Scaffold::<title>; update if the deck is renamed in Anki. */
  anki_deck: z.string().min(1).max(200).optional(),
});
export type SubjectFields = z.infer<typeof SubjectFields>;
export type SubjectInput = z.input<typeof SubjectFields>;

export const DERIVED_SUBJECT_KEYS = ['last_session', 'due'] as const;

/** Characters Anki deck names cannot hold, plus the deck separator. */
export function deckNameFor(title: string): string {
  const clean = title.replace(/::/g, ' ').replace(/["]/g, '').trim();
  return `Scaffold::${clean}`;
}
