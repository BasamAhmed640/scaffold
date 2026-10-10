import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupAll, makeVault } from '../helpers/vault.js';

// V-CLI: the real entry point runs as a process, prints the envelope and sets exit codes.

afterAll(() => cleanupAll());

function scaffold(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', path.resolve('src/cli/index.ts'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
}

describe('scaffold binary', () => {
  it('--version, doctor --json, and exit code 1 on failure', () => {
    const v = makeVault();
    const ver = scaffold(['--version']);
    expect(ver.status).toBe(0);
    expect(ver.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const doc = scaffold(['--json', 'doctor'], { SCAFFOLD_VAULT: v.root });
    expect(doc.status).toBe(0);
    expect(JSON.parse(doc.stdout).ok).toBe(true);
    const bad = scaffold(['--json', 'plan', '--focus', 'nothing'], { SCAFFOLD_VAULT: v.root });
    expect(bad.status).toBe(1);
    expect(JSON.parse(bad.stdout).errors[0].code).toMatch(/no_subjects|unknown_subject/);
    const usage = scaffold(['plan', '--minutes']);
    expect(usage.status).toBe(2);
  });
});
