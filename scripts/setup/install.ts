// Helpers behind `npm run update` (scripts/setup/update.ts): the Scaffold Tutor folder that Codex and
// Claude Code open, Codex's trust entry for it, and checks of what Claude Desktop has installed
// (D-91, D-94). Nothing here talks to the network.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const SKILL = 'scaffold-tutor';
export const EXTENSION = 'scaffold';

export const serverPath = (repo: string): string => path.join(repo, 'build', 'mcpb', 'server', 'index.mjs');
export const defaultTutorFolder = (): string => path.join(homedir(), 'Scaffold Tutor');

function listFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${name}` : name;
    if (statSync(path.join(dir, name)).isDirectory()) out.push(...listFiles(path.join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

/** sha256 of a file, or of every file in a folder (relative paths and contents, in sorted order). */
export function sha256Of(p: string): string {
  const h = createHash('sha256');
  if (statSync(p).isDirectory())
    for (const rel of listFiles(p))
      h.update(`${rel}\0`)
        .update(readFileSync(path.join(p, rel)))
        .update('\0');
  else h.update(readFileSync(p));
  return h.digest('hex');
}

function readJson(p: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(readFileSync(p, 'utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// --- The Scaffold Tutor folder (Codex and Claude Code) ---

export interface TutorFolderOptions {
  repo: string;
  vault: string;
  folder: string;
  /** The node executable that runs the server. */
  node: string;
}

// JSON string escapes are all valid TOML basic-string escapes.
const tomlString = (s: string): string => JSON.stringify(s);

export function codexConfig(o: TutorFolderOptions): string {
  return [
    '# Scaffold MCP server for this folder only. Written by `npm run update`; edits are overwritten.',
    '[mcp_servers.scaffold]',
    `command = ${tomlString(o.node)}`,
    `args = [${[serverPath(o.repo), '--vault', o.vault].map(tomlString).join(', ')}]`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 60',
    // Scaffold's own tools only; Codex otherwise stops to ask before every recorded answer (D-79)
    'default_tools_approval_mode = "approve"',
    '',
  ].join('\n');
}

export function mcpJson(o: TutorFolderOptions): string {
  const server = { command: o.node, args: [serverPath(o.repo), '--vault', o.vault] };
  return JSON.stringify({ mcpServers: { scaffold: server } }, null, 2) + '\n';
}

const FOLDER_README = `# Scaffold Tutor

This folder is where Codex (and Claude Code) tutor you with Scaffold. Scaffold's tools are
connected here only, so your other projects are unchanged.

- Codex: open this folder as a project, then say "Start a session" or "Start a session on <subject>".
- Claude Code: run \`claude\` in this folder.

Everything here is rewritten by \`npm run update\` in the Scaffold repo, so don't edit it.
Your progress lives in your Obsidian vault, not here.
`;

/** Writes (or refreshes) the folder: adapters, the skill for both apps, both MCP configs, a git root. */
export function writeTutorFolder(o: TutorFolderOptions): { git: boolean } {
  mkdirSync(o.folder, { recursive: true });
  for (const f of ['AGENTS.md', 'CLAUDE.md']) copyFileSync(path.join(o.repo, f), path.join(o.folder, f));
  for (const dir of ['.agents', '.claude']) {
    const target = path.join(o.folder, dir, 'skills', SKILL);
    rmSync(target, { recursive: true, force: true });
    cpSync(path.join(o.repo, 'skills', SKILL), target, { recursive: true });
  }
  mkdirSync(path.join(o.folder, '.codex'), { recursive: true });
  // writeFileSync writes UTF-8 without a byte-order mark, which TOML and JSON readers expect
  writeFileSync(path.join(o.folder, '.codex', 'config.toml'), codexConfig(o));
  writeFileSync(path.join(o.folder, '.mcp.json'), mcpJson(o));
  writeFileSync(path.join(o.folder, 'README.md'), FOLDER_README);
  // Codex looks for AGENTS.md and .agents/skills from the project (git) root
  if (existsSync(path.join(o.folder, '.git'))) return { git: true };
  const r = spawnSync('git', ['init', '-q'], { cwd: o.folder, timeout: 30_000, stdio: 'ignore' });
  return { git: r.status === 0 };
}

// --- Codex trust ---

export const codexHome = (env: NodeJS.ProcessEnv = process.env): string =>
  env.CODEX_HOME?.trim() || path.join(homedir(), '.codex');

/** Codex's key for a project folder; it stores Windows paths in lower case. `folder` is absolute. */
export const codexProjectKey = (folder: string, platform: NodeJS.Platform = process.platform): string =>
  platform === 'win32' ? folder.toLowerCase() : folder;

/** The lines of the `[projects.<key>]` table in a Codex config.toml, or null when there is none. */
export function projectTable(
  text: string,
  key: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const same = (a: string): boolean =>
    platform === 'win32' ? a.toLowerCase() === key.toLowerCase() : a === key;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\[projects\.(?:'([^']*)'|"((?:[^"\\]|\\.)*)")\]\s*$/.exec(lines[i]!);
    if (!m) continue;
    let k = m[1];
    if (k === undefined)
      try {
        k = JSON.parse(`"${m[2]}"`) as string;
      } catch {
        continue;
      }
    if (!same(k)) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && !/^\s*\[/.test(lines[j]!); j++) body.push(lines[j]!);
    return body.join('\n');
  }
  return null;
}

export interface TrustResult {
  /** added: entry written; present: already trusted; not_trusted: the owner chose otherwise (left alone). */
  status: 'added' | 'present' | 'not_trusted' | 'no_codex';
  config: string;
  backup?: string;
}

/** Marks the folder trusted in Codex's config (Codex reads a project's .codex/ only when trusted). */
export function trustCodexFolder(
  folder: string,
  opts: { home?: string; platform?: NodeJS.Platform; now?: Date } = {},
): TrustResult {
  const home = opts.home ?? codexHome();
  const config = path.join(home, 'config.toml');
  if (!existsSync(home)) return { status: 'no_codex', config };
  const platform = opts.platform ?? process.platform;
  const key = codexProjectKey(folder, platform);
  const text = existsSync(config) ? readFileSync(config, 'utf8') : '';
  const table = projectTable(text, key, platform);
  if (table !== null)
    return { status: /^\s*trust_level\s*=\s*"trusted"\s*$/m.test(table) ? 'present' : 'not_trusted', config };
  let backup: string | undefined;
  if (text) {
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').slice(0, 15);
    backup = `${config}.bak-scaffold-${stamp}`;
    copyFileSync(config, backup);
  }
  const header = key.includes("'") ? `[projects.${JSON.stringify(key)}]` : `[projects.'${key}']`;
  const sep = text === '' || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(config, `${text}${sep}${header}\ntrust_level = "trusted"\n`);
  return backup ? { status: 'added', config, backup } : { status: 'added', config };
}

// --- Claude Desktop ---

/** Claude Desktop's data folders. The Microsoft Store app keeps a private copy of AppData (D-88). */
export function claudeDataRoots(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const roots: string[] = [];
  if (platform === 'win32') {
    roots.push(path.join(env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'Claude'));
    const packages = path.join(env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'Packages');
    if (existsSync(packages))
      for (const d of readdirSync(packages))
        if (/^Claude_/i.test(d)) roots.push(path.join(packages, d, 'LocalCache', 'Roaming', 'Claude'));
  } else if (platform === 'darwin')
    roots.push(path.join(homedir(), 'Library', 'Application Support', 'Claude'));
  else roots.push(path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'Claude'));
  return roots.filter((r) => existsSync(r));
}

export interface InstalledExtension {
  dir: string;
  server_sha256: string | null;
  /** From Claude's per-extension settings, when it records them. */
  vault: string | null;
  enabled: boolean | null;
}

/** Every installed copy of the Scaffold extension under the given Claude data folders. */
export function installedExtensions(roots: string[], name = EXTENSION): InstalledExtension[] {
  const out: InstalledExtension[] = [];
  for (const root of roots) {
    const exts = path.join(root, 'Claude Extensions');
    if (!existsSync(exts)) continue;
    for (const id of readdirSync(exts)) {
      const dir = path.join(exts, id);
      if (readJson(path.join(dir, 'manifest.json'))?.name !== name) continue;
      const server = path.join(dir, 'server', 'index.mjs');
      const settings = readJson(path.join(root, 'Claude Extensions Settings', `${id}.json`));
      const userConfig = settings?.userConfig as { vault?: unknown } | undefined;
      out.push({
        dir,
        server_sha256: existsSync(server) ? sha256Of(server) : null,
        vault: typeof userConfig?.vault === 'string' ? userConfig.vault : null,
        enabled: typeof settings?.isEnabled === 'boolean' ? settings.isEnabled : null,
      });
    }
  }
  return out;
}

// --- What the owner has done by hand (the skill upload cannot be checked from here) ---

export interface InstallState {
  skill_sha256?: string;
  skill_uploaded_at?: string;
}

export const statePath = (repo: string): string => path.join(repo, 'local', 'install-state.json');

export const readState = (repo: string): InstallState =>
  (readJson(statePath(repo)) as InstallState | null) ?? {};

export function writeState(repo: string, state: InstallState): void {
  mkdirSync(path.dirname(statePath(repo)), { recursive: true });
  writeFileSync(statePath(repo), JSON.stringify(state, null, 2) + '\n');
}

/** Opens a file with its app, or shows it selected in the file manager. SCAFFOLD_NO_OPEN=1 only prints. */
export function openFile(p: string, opts: { reveal?: boolean; env?: NodeJS.ProcessEnv } = {}): boolean {
  if ((opts.env ?? process.env).SCAFFOLD_NO_OPEN === '1') return false;
  const [cmd, args, verbatim]: [string, string[], boolean] =
    process.platform === 'win32'
      ? ['explorer.exe', [opts.reveal ? `/select,"${p}"` : `"${p}"`], true]
      : process.platform === 'darwin'
        ? ['open', opts.reveal ? ['-R', p] : [p], false]
        : ['xdg-open', [opts.reveal ? path.dirname(p) : p], false];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: verbatim });
  child.on('error', () => undefined);
  child.unref();
  return true;
}
