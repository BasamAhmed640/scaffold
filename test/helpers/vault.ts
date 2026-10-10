import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SeqIds } from '../../src/core/ids.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { FakeClock } from '../../src/core/time.js';
import { initVault } from '../../src/core/vault/init.js';
import type { AtomicHooks } from '../../src/core/vault/atomic.js';
import type { ScaffoldEvent } from '../../src/core/schemas/events.js';
import { TZ } from './builder.js';

export interface TestVault {
  root: string;
  sc: Scaffold;
  clock: FakeClock;
  userConfig: string;
  cleanup(): void;
}

const made: string[] = [];

export function tempDir(name = 'scaffold-test-'): string {
  const d = mkdtempSync(path.join(tmpdir(), name));
  made.push(d);
  return d;
}

export function makeVault(
  opts: { name?: string; start?: string; hooks?: AtomicHooks; obsidian?: boolean } = {},
): TestVault {
  const base = tempDir();
  const root = path.join(base, opts.name ?? 'Vault');
  const userConfig = path.join(base, 'user-config.json');
  if (opts.obsidian) {
    // a fake Obsidian vault marker folder
    mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  }
  initVault(root, { userConfig });
  const clock = new FakeClock(opts.start ?? '2026-10-09T18:00:00-04:00');
  const hooks: AtomicHooks = opts.hooks ?? {};
  const sc = Scaffold.open(root, { clock, ids: new SeqIds(), timezone: TZ, hooks });
  return { root, sc, clock, userConfig, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** Writes a prepared event log into a fresh vault and returns a Scaffold over it. */
export function vaultFromEvents(
  events: ScaffoldEvent[],
  now: string,
  opts: { name?: string } = {},
): TestVault {
  const v = makeVault({ ...(opts.name ? { name: opts.name } : {}), start: now });
  writeFileSync(
    path.join(v.root, 'Scaffold', '_system', 'events.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  const sc = Scaffold.open(v.root, { clock: v.clock, ids: new SeqIds(), timezone: TZ });
  return { ...v, sc };
}

export function cleanupAll(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}
