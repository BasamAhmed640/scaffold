import path from 'node:path';
import type { Warnings } from '../../envelope.js';
import { OpQueue } from '../../anki/queue.js';
import type { Scaffold } from '../scaffold.js';

// Anki side effects of content operations. With no reachable AnkiConnect the operation is queued
// (ANK-09) and replayed by the next `anki sync`.

export interface AnkiCaller {
  call(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

export function queueFor(sc: Scaffold): OpQueue {
  return new OpQueue(path.join(sc.vault.sys, 'queue'));
}

/** ANK-01: a subject's deck is created with the subject (queued until Anki answers). */
export function ensureDeck(sc: Scaffold, deck: string, w: Warnings): 'queued' {
  const q = queueFor(sc);
  q.enqueue({
    op_id: sc.vault.ids.eventId(sc.now()),
    created: sc.vault.nowIso(),
    action: 'createDeck',
    params: { deck },
    context: { reason: 'subject created' },
  });
  w.add(`Anki deck "${deck}" queued; it is created on the next \`anki sync\` (ANK-09).`);
  return 'queued';
}
