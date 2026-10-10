import { runCli } from '../../src/cli/run.js';
import { tempDir } from './vault.js';

export interface CliResult {
  code: number;
  out: string;
  err: string;
  json: {
    ok: boolean;
    data: unknown;
    warnings: string[];
    errors: { code: string; message: string; next_step?: string }[];
  } | null;
}

export async function cli(
  vault: string,
  args: string[],
  opts: { now?: string; json?: boolean } = {},
): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  // A fresh user-config folder per call, so tests never read or write the owner's real
  // %APPDATA%\scaffold\config.json (ARC-12; D-95).
  const config = tempDir('scaffold-cfg-');
  const env = {
    ...process.env,
    APPDATA: config,
    XDG_CONFIG_HOME: config,
    SCAFFOLD_VAULT: vault,
    SCAFFOLD_NOW: opts.now ?? '2026-10-09T18:00:00-04:00',
    SCAFFOLD_TZ: 'America/New_York',
  };
  const argv = opts.json === false ? args : ['--json', ...args];
  const code = await runCli(argv, { stdout: (s) => out.push(s), stderr: (s) => err.push(s), env });
  const text = out.join('\n');
  let json = null;
  if (opts.json !== false) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { code, out: text, err: err.join('\n'), json };
}

/** Replaces machine-specific paths so golden files are stable. */
export function normalize(value: unknown, vault: string): unknown {
  const variants = [vault, vault.replace(/\\/g, '/'), vault.replace(/\\/g, '\\\\')];
  let s = JSON.stringify(value);
  for (const v of variants) s = s.split(JSON.stringify(v).slice(1, -1)).join('<VAULT>');
  return JSON.parse(s);
}
