import type { AnkiClient } from '../../anki/client.js';
import { CARD_CSS, NOTE_TYPES, ROOT_DECK } from '../../anki/notes.js';
import type { Scaffold } from '../scaffold.js';

// ANK-01 structure: the Scaffold note types, the root deck and one subdeck per subject. Needed
// before any addNotes, whether an approval adds a card directly or a queued add is replayed (found
// by the live smoke test on a fresh profile: "model was not found: Scaffold Basic", D-85).

export interface StructureCreated {
  decks: string[];
  note_types: string[];
  /** Every Scaffold deck that exists after this step (created now or before). */
  decks_present: string[];
}

export async function ensureStructure(sc: Scaffold, client: AnkiClient): Promise<StructureCreated> {
  const created: StructureCreated = { decks: [], note_types: [], decks_present: [] };
  const models = await client.invoke<string[]>('modelNames');
  for (const t of Object.values(NOTE_TYPES)) {
    if (models.includes(t.modelName)) continue;
    await client.invoke('createModel', {
      modelName: t.modelName,
      inOrderFields: [...t.inOrderFields],
      css: CARD_CSS,
      isCloze: t.isCloze,
      cardTemplates: t.cardTemplates.map((c) => ({ ...c })),
    });
    created.note_types.push(t.modelName);
  }
  const decks = new Set(await client.invoke<string[]>('deckNames'));
  for (const deck of [ROOT_DECK, ...sc.subjects().map((s) => s.anki_deck ?? `${ROOT_DECK}::${s.title}`)]) {
    if (decks.has(deck)) continue;
    await client.invoke('createDeck', { deck });
    decks.add(deck);
    created.decks.push(deck);
  }
  created.decks_present = [...decks];
  return created;
}
