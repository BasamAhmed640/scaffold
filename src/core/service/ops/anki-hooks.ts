import { Warnings } from '../../envelope.js';
import type { Scaffold } from '../scaffold.js';
import { performOrQueue, queueFor, readMirror } from '../anki/context.js';
import { ankiBriefing } from '../anki/ops.js';

// The Anki side of content and session operations: deck creation with a subject (ANK-01, queued
// while Anki is offline, ANK-09), and read access to the mirror for wording checks (QB-01 item 6).

export { ankiBriefing, queueFor };

/** ANK-01: a subject's deck is created with the subject, or queued until Anki answers. */
export async function ensureDeck(sc: Scaffold, deck: string, w: Warnings): Promise<'created' | 'queued'> {
  const r = await performOrQueue(sc, 'createDeck', { deck }, { reason: 'subject created' }, new Warnings()); // its own warning below
  if (r.done) return 'created';
  w.add(`Anki deck "${deck}" queued; it is created on the next \`anki sync\` (ANK-09).`);
  return 'queued';
}

/** Anki card fronts per KC, so tutor questions are not worded like the cards (QB-01 item 6). */
export function ankiTextByKc(sc: Scaffold): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of readMirror(sc)?.cards ?? []) for (const k of c.kc_ids) (out[k] ??= []).push(c.front);
  return out;
}
