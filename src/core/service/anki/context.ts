import path from 'node:path';
import { AnkiConnectClient, AnkiOffline, type AnkiClient } from '../../anki/client.js';
import { computeLoad, type LoadReport } from '../../anki/load.js';
import { MIRROR_REL, parseMirror, type AnkiMirror } from '../../anki/mirror.js';
import { protectedSet, type ProtectedSet } from '../../anki/protected.js';
import { OpQueue } from '../../anki/queue.js';
import type { Warnings } from '../../envelope.js';
import type { Scaffold } from '../scaffold.js';

// Shared plumbing for the Anki layer: which client to use, perform-or-queue (ANK-09), the mirror,
// load and protected set for the current state, and id allocation for proposals and actions.

/**
 * The AnkiConnect client: injected (tests), else `SCAFFOLD_ANKI_URL` (tests point it at a closed
 * port so they never touch a real collection), else `anki.url` from the vault config.
 */
export function clientFor(sc: Scaffold): AnkiClient {
  if (sc.deps.anki) return sc.deps.anki;
  const cfg = sc.cfg().anki;
  return new AnkiConnectClient(process.env.SCAFFOLD_ANKI_URL ?? cfg.url, cfg.timeout_ms, cfg.api_version);
}

export function queueFor(sc: Scaffold): OpQueue {
  return new OpQueue(path.join(sc.vault.sys, 'queue'));
}

export type Performed<T> = { done: true; result: T } | { done: false; queued_file: string };

/** Runs one AnkiConnect action now, or queues it when Anki does not answer (ANK-09). */
export async function performOrQueue<T = unknown>(
  sc: Scaffold,
  action: string,
  params: Record<string, unknown>,
  context: Record<string, unknown>,
  w: Warnings,
): Promise<Performed<T>> {
  try {
    return { done: true, result: await clientFor(sc).invoke<T>(action, params) };
  } catch (e) {
    if (!(e instanceof AnkiOffline)) throw e;
    const file = queueFor(sc).enqueue({
      op_id: sc.vault.ids.eventId(sc.now()),
      created: sc.vault.nowIso(),
      action,
      params,
      context,
    });
    w.add(`Anki is not answering; ${action} is queued and runs on the next \`anki sync\` (ANK-09).`);
    return { done: false, queued_file: file };
  }
}

export function readMirror(sc: Scaffold): AnkiMirror | null {
  return parseMirror(sc.vault.readText(MIRROR_REL));
}

export function writeMirror(sc: Scaffold, m: AnkiMirror): void {
  sc.vault.writeText(MIRROR_REL, `${JSON.stringify(m, null, 2)}\n`);
}

export function loadFor(sc: Scaffold, mirror = readMirror(sc)): LoadReport {
  return computeLoad(sc.subjects(), mirror, sc.facts(), sc.cfg(), sc.now());
}

export function protectFor(sc: Scaffold): ProtectedSet {
  return protectedSet(sc.derived(), sc.subjects());
}

/** `n` consecutive ids (P-0004, P-0005, …) for one batch. */
export function allocIds(sc: Scaffold, prefix: 'P' | 'CA', n: number): string[] {
  const first = sc.nextId(prefix);
  const num = Number(first.slice(prefix.length + 1));
  const width = first.length - prefix.length - 1;
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(num + i).padStart(width, '0')}`);
}
