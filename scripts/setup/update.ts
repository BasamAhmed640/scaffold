// `npm run update` (or double-click "Update Scaffold.cmd"): rebuilds Scaffold, runs the tests, and brings
// your vault, Codex and Claude Desktop up to date. It only asks you for what it cannot do itself (D-94).
// Run it from a normal terminal, not from inside an AI app (D-88).
//   npm run update                        after any change, and the first time (it asks for your vault)
//   npm run update -- --vault "<path>"    to use or switch to another vault
// Options: --folder <path> (where the Scaffold Tutor folder lives), --skip-tests, --no-wait (don't pause
// for the Claude Desktop steps). If the build or a test fails, it stops before Codex or Claude change.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { callTool } from '../../src/core/api/tools.js';
import { ScaffoldError } from '../../src/core/envelope.js';
import type { DoctorCheck } from '../../src/core/service/ops/maintenance.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { initVault } from '../../src/core/vault/init.js';
import { resolveVault } from '../../src/core/vault/paths.js';
import {
  claudeDataRoots,
  defaultTutorFolder,
  installedExtensions,
  openFile,
  readState,
  serverPath,
  sha256Of,
  SKILL,
  trustCodexFolder,
  writeState,
  writeTutorFolder,
} from './install.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCPB = path.join(repo, 'dist', 'scaffold-mcp.mcpb');
const SKILL_ZIP = path.join(repo, 'dist', 'scaffold-tutor-skill.zip');

export interface UpdateArgs {
  vault?: string;
  folder?: string;
  skipTests: boolean;
  wait: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): UpdateArgs {
  const a: UpdateArgs = { skipTests: false, wait: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--vault' || k === '--folder') {
      const v = argv[++i];
      if (!v) throw new Error(`${k} needs a folder path.`);
      a[k === '--vault' ? 'vault' : 'folder'] = v;
    } else if (k === '--skip-tests') a.skipTests = true;
    else if (k === '--no-wait') a.wait = false;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`Unknown option ${k}. Try: npm run update -- --help`);
  }
  return a;
}

/** A pasted path, without the quotes that "Copy as path" adds. */
export const cleanPath = (s: string): string => path.resolve(s.trim().replace(/^(["'])(.*)\1$/, '$2'));

const HELP = `npm run update [-- options]

Rebuilds Scaffold, runs the tests, and brings your vault, Codex and Claude Desktop up to date.
  --vault <path>    your Obsidian vault (asked the first time, then remembered)
  --folder <path>   the Scaffold Tutor folder (default: "Scaffold Tutor" in your user folder)
  --skip-tests      skip the tests (faster; not after code changes)
  --no-wait         don't pause for the Claude Desktop steps`;

const say = (s = ''): void => void process.stdout.write(s + '\n');
const ok = (s: string): void => say(`  ✓ ${s}`);
const warn = (s: string): void => say(`  ! ${s}`);
const bad = (s: string): void => say(`  ✗ ${s}`);
const more = (s: string): void => say(`      ${s}`);
let todo = 0;
const yours = (s: string): void => {
  todo++;
  say(`  → ${s}`);
};
const TOTAL = 5;
let stepNo = 0;
const step = (title: string): void => say(`\n[${++stepNo}/${TOTAL}] ${title}`);

function node(args: string[], minutes: number): { ok: boolean; out: string; timedOut: boolean } {
  const r = spawnSync(process.execPath, args, {
    cwd: repo,
    encoding: 'utf8',
    timeout: minutes * 60_000, // ARC-10: never hang
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  // eslint-disable-next-line no-control-regex
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return { ok: r.status === 0 && !r.error, out, timedOut };
}

function stop(message: string, output?: string): never {
  if (output) for (const line of output.trim().split('\n').slice(-25)) more(line);
  bad(message);
  say('\nStopped. Codex and Claude Desktop still use the previous version.');
  process.exit(1);
}

/** Asks on the terminal; null when nobody can answer (no terminal, or --no-wait). */
async function ask(args: UpdateArgs, question: string): Promise<string | null> {
  if (!args.wait || !process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`  ${question} `)).trim();
  } finally {
    rl.close();
  }
}

/** Waits for Enter; false when the owner typed "later" or nobody can answer. */
async function confirmed(args: UpdateArgs, what: string): Promise<boolean> {
  const a = await ask(args, `Press Enter ${what}, or type "later":`);
  return a !== null && !/^l(ater)?$/i.test(a);
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  let args: UpdateArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    say((e as Error).message);
    process.exit(2);
  }
  if (args.help) return say(HELP);
  say('Scaffold update');

  // 1. Build and test. Nothing that Codex or Claude runs changes until the tests pass.
  step('Build and test');
  const TSC = path.join('node_modules', 'typescript', 'bin', 'tsc');
  const TSX = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');
  let r = node([TSC, '-p', 'tsconfig.build.json'], 5);
  if (!r.ok) stop('The TypeScript build failed.', r.out);
  r = node([TSX, path.join('scripts', 'build-adapters.ts')], 5);
  if (!r.ok) stop('Generating the skill and adapters from protocol/ failed.', r.out);
  ok('Built; skill and adapters regenerated from protocol/.');
  if (args.skipTests) warn('Tests skipped (--skip-tests).');
  else {
    r = node([path.join('node_modules', 'vitest', 'vitest.mjs'), 'run'], 15);
    const summary = /Tests\s+([^\n]+)/.exec(r.out)?.[1]?.trim();
    if (!r.ok) {
      const failures = r.out.split('\n').filter((l) => /FAIL|×|AssertionError|Error:/.test(l));
      stop(
        r.timedOut ? 'The tests timed out.' : `Tests failed${summary ? ` (${summary})` : ''}.`,
        failures.join('\n') || r.out,
      );
    }
    ok(`Tests: ${summary ?? 'passed'}.`);
  }
  r = node([TSX, path.join('scripts', 'build-mcpb.ts')], 5);
  if (!r.ok) stop('Bundling the Claude Desktop extension failed.', r.out);
  ok('Extension bundled.');

  // 2. Vault
  step('Vault');
  let vault: string;
  try {
    vault = args.vault ? cleanPath(args.vault) : resolveVault().vault;
  } catch (e) {
    if (!(e instanceof ScaffoldError) || e.code !== 'vault_not_configured') throw e;
    const answer = await ask(args, 'Where is your Obsidian vault? Paste its folder path:');
    if (!answer) stop('No vault yet. Run: npm run update -- --vault "C:\\path\\to\\your vault"');
    vault = cleanPath(answer);
    args.vault = vault;
  }
  if (!existsSync(vault)) stop(`Folder not found: ${vault}`);
  if (!existsSync(path.join(vault, '.obsidian')))
    warn('This folder has no .obsidian folder, so it may not be an Obsidian vault. Continuing.');
  const init = initVault(vault, { setDefault: !!args.vault });
  ok(`${vault}${init.created.length ? ` (added ${init.created.length} Scaffold file(s))` : ''}`);
  const doctor = await callTool(Scaffold.open(vault), 'doctor', {});
  const checks = (doctor.data as { checks?: DoctorCheck[] } | null)?.checks ?? [];
  for (const c of checks.filter((x) => !x.ok)) {
    (c.warn ? warn : bad)(c.message);
    if (c.next_step) more(c.next_step);
  }
  if (doctor.ok && checks.every((c) => c.ok)) ok('Health check passed.');

  // 3. Codex (and Claude Code): the Scaffold Tutor folder
  step('Codex');
  const folder = cleanPath(args.folder ?? defaultTutorFolder());
  const { git } = writeTutorFolder({ repo, vault, folder, node: process.execPath });
  ok(`Scaffold Tutor folder refreshed: ${folder}`);
  if (!git) warn('Git is missing, so Codex may not find the skill there. Install Git, then run this again.');
  const trust = trustCodexFolder(folder);
  if (trust.status === 'added')
    ok(`Codex now trusts that folder${trust.backup ? ` (your old Codex settings: ${trust.backup})` : ''}.`);
  else if (trust.status === 'present') ok('Codex trusts that folder.');
  else if (trust.status === 'not_trusted') {
    warn('Codex has that folder marked as not trusted, so it ignores Scaffold there.');
    more(`Trust it when Codex asks, or remove its [projects] entry from ${trust.config}.`);
  } else warn('Codex is not installed. The folder still works with Claude Code (run `claude` in it).');

  // 4. Claude Desktop extension: the installed copy must match this build
  step('Claude Desktop extension');
  const roots = claudeDataRoots();
  if (!roots.length) warn(`Claude Desktop not found. Once it is installed, double-click ${MCPB}.`);
  else {
    const want = sha256Of(serverPath(repo));
    const current = () => installedExtensions(roots).find((e) => e.server_sha256 === want);
    let ext = current();
    if (ext) ok('Installed and up to date.');
    else {
      const update = installedExtensions(roots).length > 0;
      openFile(MCPB);
      yours(
        update
          ? 'A new version is ready. Claude Desktop is showing it: click Install (or Update).'
          : 'Claude Desktop is showing the installer: click Install, and choose your vault folder when asked.',
      );
      more(`If nothing opened, double-click ${MCPB}`);
      if (await confirmed(args, 'once you have clicked Install')) {
        // Claude may take a moment to unpack it; look twice at most (REL-04)
        ext = current();
        if (!ext) {
          await pause(3000);
          ext = current();
        }
        if (ext) {
          todo--;
          ok('Installed.');
        } else warn('Not detected yet. If you did install it, restart Claude Desktop and run this again.');
      }
    }
    if (ext?.vault && path.resolve(ext.vault) !== path.resolve(vault)) {
      warn(`The extension uses another vault: ${ext.vault}`);
      more('Change it in Claude Desktop: Settings → Extensions → Scaffold tutor → Configure.');
    }
    if (ext?.enabled === false)
      more('It is switched off now. Turn it on in Settings → Extensions when you study.');
  }

  // 5. Claude Desktop skill: an upload Scaffold cannot see, so it remembers what you confirmed
  step('Claude Desktop skill');
  const skillSha = sha256Of(path.join(repo, 'skills', SKILL));
  const state = readState(repo);
  if (state.skill_sha256 === skillSha) ok('Up to date.');
  else {
    openFile(SKILL_ZIP, { reveal: true });
    yours(state.skill_sha256 ? 'The skill changed. Upload the new one:' : 'Upload the skill (once):');
    more(
      state.skill_sha256
        ? 'Claude Desktop → Settings → Capabilities → Skills → Upload skill (replace the old one).'
        : 'Claude Desktop → Settings → Capabilities: turn on code execution, then Skills → Upload skill.',
    );
    more(`File: ${SKILL_ZIP} (shown in your file manager)`);
    if (await confirmed(args, 'once it is uploaded')) {
      writeState(repo, { ...state, skill_sha256: skillSha, skill_uploaded_at: new Date().toISOString() });
      todo--;
      ok('Noted.');
    } else more("I'll remind you next time.");
  }

  say(todo ? `\nAlmost done: ${todo} step(s) above (→) still need you.` : '\nAll set.');
  say('  Claude Desktop: Settings → Extensions → Scaffold tutor is your on/off switch.');
  say('                  With it on, say "Start a session on <subject>".');
  say('  Codex:          open the "Scaffold Tutor" folder as a project, then say "Start a session".');
  say('  Health check:   npm run doctor');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/setup/update.ts'))
  main().catch((e: unknown) => stop(e instanceof Error ? e.message : String(e)));
