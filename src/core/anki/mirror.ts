import { z } from 'zod';

// Scaffold/_system/anki-mirror.json: the cards Scaffold knows, as of the last sync. After a card is
// created, Anki is the source of truth for its text (ANK-08); the mirror is a read-only copy used by
// the planner (wording checks), budgets, proposals and doctor.

export const MIRROR_REL = 'Scaffold/_system/anki-mirror.json';

export const MirrorCard = z.object({
  card_id: z.number().int(),
  note_id: z.number().int(),
  /** Current deck (a filtered deck while the card sits in a custom stack). */
  deck: z.string(),
  /** Home deck: the original deck of a card in a filtered deck, else `deck`. */
  home_deck: z.string(),
  subject: z.string().nullable(),
  kc_ids: z.array(z.string()),
  anchor: z.boolean(),
  tags: z.array(z.string()),
  model: z.string().default(''),
  fields: z.record(z.string(), z.string()).default({}),
  /** Plain-text front and back (first and second field). */
  front: z.string(),
  back: z.string(),
  /** Days; negative values are learning steps in seconds (Anki's convention). */
  interval: z.number(),
  queue: z.number().int(),
  type: z.number().int(),
  lapses: z.number().int(),
  reps: z.number().int(),
  suspended: z.boolean(),
  due: z.number(),
  /** Note modification time (s), to detect edits made in Anki. */
  note_mod: z.number().default(0),
});
export type MirrorCard = z.infer<typeof MirrorCard>;

export const AnkiMirror = z.object({
  synced_at: z.string(),
  api_version: z.number().nullable(),
  cards: z.array(MirrorCard),
  /** Mean answer time over the last 30 days of reviews (s), or null without data. */
  avg_seconds_per_review: z.number().nullable(),
  /** null: AnkiConnect cannot tell (see doctor). */
  fsrs_enabled: z.boolean().nullable(),
  decks: z.array(z.string()),
});
export type AnkiMirror = z.infer<typeof AnkiMirror>;

export function parseMirror(text: string | null): AnkiMirror | null {
  if (!text) return null;
  try {
    return AnkiMirror.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export const isActive = (c: MirrorCard): boolean => !c.suspended;
export const isMature = (c: MirrorCard, days: number): boolean => c.interval >= days;

/** Notes (with their cards) in the mirror, keyed by note id. */
export function notesOf(m: AnkiMirror | null): Map<number, MirrorCard[]> {
  const out = new Map<number, MirrorCard[]>();
  for (const c of m?.cards ?? []) {
    const list = out.get(c.note_id) ?? [];
    list.push(c);
    out.set(c.note_id, list);
  }
  return out;
}
