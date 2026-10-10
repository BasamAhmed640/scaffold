import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Warnings } from '../../envelope.js';
import { OpQueue } from '../../anki/queue.js';
import type { AnkiBriefing } from '../../planner/briefing.js';
import type { Scaffold } from '../scaffold.js';

// Anki side effects of content operations, and read access to the Anki mirror for the planner and
// briefing. With no reachable AnkiConnect, operations are queued (ANK-09) and replayed by `anki sync`.

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

export interface MirrorCard {
  card_id: number;
  note_id: number;
  deck: string;
  home_deck: string;
  subject: string | null;
  kc_ids: string[];
  anchor: boolean;
  tags: string[];
  front: string;
  back: string;
  interval: number;
  queue: number;
  type: number;
  lapses: number;
  reps: number;
  suspended: boolean;
  due: number;
}

export interface AnkiMirror {
  synced_at: string;
  api_version: number | null;
  cards: MirrorCard[];
  avg_seconds_per_review: number | null;
  fsrs_enabled: boolean | null;
  decks: string[];
}

export function mirrorPath(sc: Scaffold): string {
  return path.join(sc.vault.sys, 'anki-mirror.json');
}

export function readMirror(sc: Scaffold): AnkiMirror | null {
  const p = mirrorPath(sc);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as AnkiMirror;
  } catch {
    return null;
  }
}

/** Anki card text per KC, so tutor questions are not worded like the cards (QB-01 item 6). */
export function ankiTextByKc(sc: Scaffold): Record<string, string[]> {
  const m = readMirror(sc);
  const out: Record<string, string[]> = {};
  if (!m) return out;
  for (const c of m.cards) for (const k of c.kc_ids) (out[k] ??= []).push(c.front);
  return out;
}

/** Briefing block for Anki; the load computations live in the Anki layer (M6). */
export function ankiBriefing(sc: Scaffold, focus: string, w: Warnings): AnkiBriefing | null {
  const pending = queueFor(sc).count();
  if (pending > 0) w.add(`Anki operations queued: ${pending} (they are applied on the next \`anki sync\`).`);
  const hook = (
    sc.deps as { ankiBriefing?: (sc: Scaffold, focus: string, w: Warnings) => AnkiBriefing | null }
  ).ankiBriefing;
  return hook ? hook(sc, focus, w) : null;
}
