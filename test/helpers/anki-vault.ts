import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { Warnings } from '../../src/core/envelope.js';
import { SeqIds } from '../../src/core/ids.js';
import { callTool } from '../../src/core/api/tools.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { syncFromVault } from '../../src/core/service/sync.js';
import type { ScaffoldEvent } from '../../src/core/schemas/events.js';
import { LogBuilder, TZ } from './builder.js';
import { MockAnki } from './anki-mock.js';
import { makeVault, type TestVault } from './vault.js';

// A vault for V-ANKI tests: SI/PI (5 KCs) and music theory (2 KCs), an open SI/PI session in which
// Γ and Z0 were retrieved correctly, notes restored, and a mock AnkiConnect injected.

export const NOW = '2026-10-09T18:00:00-04:00';
export const SESSION = 'S-2026-10-09-1';

export function ankiLog(extra?: (b: LogBuilder) => void): ScaffoldEvent[] {
  const b = new LogBuilder('2026-09-01T09:00:00-04:00');
  b.subject('si-pi', { title: 'SI/PI', aliases: ['signal integrity'] });
  b.subject('music-theory', { title: 'Music theory', aliases: ['music'] });
  b.kc('kc-si-z0', 'si-pi', { title: 'Characteristic impedance' });
  b.kc('kc-si-gamma', 'si-pi', { title: 'Reflection coefficient', prerequisites: ['kc-si-z0'] });
  b.kc('kc-si-open-short', 'si-pi', { title: 'Open and short terminations', prerequisites: ['kc-si-gamma'] });
  b.kc('kc-si-td', 'si-pi', { title: 'Propagation delay' });
  b.kc('kc-si-skin', 'si-pi', { title: 'Skin effect', volatility: 'volatile', review_by: '2026-10-01' });
  b.kc('kc-mt-intervals', 'music-theory', { title: 'Intervals' });
  b.kc('kc-mt-scale', 'music-theory', { title: 'Major scale', prerequisites: ['kc-mt-intervals'] });
  b.at('2026-09-20T19:00:00-04:00').session('S-2026-09-20-1', 'si-pi');
  for (const k of ['kc-si-z0', 'kc-si-gamma', 'kc-si-td']) {
    b.taught(k, 'S-2026-09-20-1');
    b.attempt(k, 'correct', { conf: 3, session: 'S-2026-09-20-1' });
  }
  b.endSession('S-2026-09-20-1');
  b.at('2026-09-22T19:00:00-04:00').session('S-2026-09-22-1', 'music-theory');
  b.taught('kc-mt-intervals', 'S-2026-09-22-1');
  b.attempt('kc-mt-intervals', 'correct', { conf: 3, session: 'S-2026-09-22-1' });
  b.endSession('S-2026-09-22-1');
  b.at('2026-10-09T17:30:00-04:00').session(SESSION, 'si-pi');
  b.attempt('kc-si-gamma', 'correct', { conf: 3, session: SESSION });
  b.attempt('kc-si-z0', 'correct', { conf: 4, session: SESSION });
  b.attempt('kc-si-td', 'correct', { conf: 1, session: SESSION }); // a guess: not a retrieval
  extra?.(b);
  b.at(NOW);
  return b.events;
}

export interface AnkiVault extends TestVault {
  mock: MockAnki;
  /** A Scaffold over the vault with the mock injected (reopen after editing files). */
  open(): Scaffold;
  call(
    tool: string,
    input?: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary tool output
  ): Promise<{ ok: boolean; data: any; warnings: string[]; errors: { code: string; message: string }[] }>;
}

export async function ankiVault(
  opts: { events?: ScaffoldEvent[]; online?: boolean; structure?: boolean } = {},
): Promise<AnkiVault> {
  const v = makeVault({ start: NOW });
  writeFileSync(
    path.join(v.root, 'Scaffold', '_system', 'events.jsonl'),
    (opts.events ?? ankiLog()).map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  const mock = await new MockAnki().start();
  // One id source for every reopen: with a frozen fake clock, a fresh SeqIds would repeat ids and
  // the log would (rightly) drop the repeats as duplicates (LM-04).
  const ids = new SeqIds();
  const open = (): Scaffold =>
    Scaffold.open(v.root, { clock: v.clock, ids, timezone: TZ }, { anki: mock.client() });
  const sc = open();
  const w = new Warnings();
  rebuildVault(sc, { restoreMissing: true }, w);
  syncFromVault(sc, w);
  if (opts.structure !== false) {
    mock.decks.add('Scaffold');
    mock.decks.add('Scaffold::SI/PI');
    mock.decks.add('Scaffold::Music theory');
    mock.models.set('Scaffold Basic', {
      fields: ['Front', 'Back', 'KC_ID', 'Link', 'Extra'],
      isCloze: false,
    });
    mock.models.set('Scaffold Cloze', {
      fields: ['Text', 'Back Extra', 'KC_ID', 'Link', 'Extra'],
      isCloze: true,
    });
  }
  if (opts.online === false) await mock.stop();
  const tv: AnkiVault = {
    ...v,
    sc,
    mock,
    open,
    call: async (tool, input = {}) => (await callTool(open(), tool, input)) as never,
    cleanup: () => {
      void mock.stop();
      v.cleanup();
    },
  };
  return tv;
}

/** Seeds a Scaffold card in the mock, with the usual tags. */
export function seedCard(
  mock: MockAnki,
  o: {
    kc: string;
    subject?: string;
    anchor?: boolean;
    front?: string;
    back?: string;
    card?: Parameters<MockAnki['seed']>[0]['card'];
    tags?: string[];
  },
): { note: number; card: number } {
  const subject = o.subject ?? (o.kc.startsWith('kc-mt-') ? 'music-theory' : 'si-pi');
  const deck = subject === 'si-pi' ? 'Scaffold::SI/PI' : 'Scaffold::Music theory';
  return mock.seed({
    deck,
    fields: {
      Front: o.front ?? `Front for ${o.kc} ${Math.random().toString(36).slice(2, 7)}`,
      Back: o.back ?? 'Back',
      KC_ID: o.kc,
      Link: '',
      Extra: '',
    },
    tags: ['scaffold', `subj::${subject}`, `kc::${o.kc}`, ...(o.anchor ? ['anchor'] : []), ...(o.tags ?? [])],
    ...(o.card ? { card: o.card } : {}),
  });
}

export const ADMISSION = {
  rederive: 'not quickly from Z0 alone',
  instant: 'needed in every reflection problem',
  worth: 'yes, used weekly',
};
