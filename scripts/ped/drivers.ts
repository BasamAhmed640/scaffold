import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCall } from './types.js';

// Headless front-end drivers for V-PED. Claude runs through Claude Code (`claude -p`, Anthropic's own
// app, ARC-02); ChatGPT runs through `codex exec` with the ChatGPT login (ARC-01). No API keys. Each
// learner message is one invocation that resumes the previous session, with the Scaffold MCP server
// attached and the skill and adapter (CLAUDE.md / AGENTS.md) in the working directory.

export interface TurnResult {
  text: string;
  tools: ToolCall[];
  session: string | null;
  error?: string;
}

export interface Provider {
  readonly name: 'claude' | 'codex' | 'stub';
  turn(message: string): Promise<TurnResult>;
}

const PREFIX = /^mcp__scaffold__/;

// The CLIs print untyped JSON lines; these narrow without `any`.
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

function jsonLines(out: string): Obj[] {
  const rows: Obj[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      rows.push(obj(JSON.parse(line)));
    } catch {
      // not a JSON line (progress output); skip
    }
  }
  return rows;
}

/** Normalizes Claude Code `--output-format stream-json --verbose` output (one JSON object per line). */
export function parseClaudeStream(out: string): TurnResult {
  const texts: string[] = [];
  const tools: ToolCall[] = [];
  const byId = new Map<string, ToolCall>();
  let session: string | null = null;
  let error: string | undefined;
  let result: string | null = null;
  for (const m of jsonLines(out)) {
    session = str(m.session_id) ?? session;
    if (m.type === 'system' && m.subtype === 'init') {
      const s = list(m.mcp_servers).find((x) => x.name === 'scaffold');
      if (s && s.status !== 'connected') error = `scaffold MCP server ${String(s.status)}`;
    }
    const content = list(obj(m.message).content);
    if (m.type === 'assistant')
      for (const c of content) {
        const text = str(c.text)?.trim();
        if (c.type === 'text' && text) texts.push(text);
        const name = str(c.name);
        if (c.type === 'tool_use' && name && PREFIX.test(name)) {
          const call: ToolCall = { name: name.replace(PREFIX, ''), input: obj(c.input) };
          tools.push(call);
          const id = str(c.id);
          if (id) byId.set(id, call);
        }
      }
    if (m.type === 'user')
      for (const c of content) {
        const call = c.type === 'tool_result' ? byId.get(str(c.tool_use_id) ?? '') : undefined;
        if (call) call.ok = !c.is_error && !/"ok":\s*false/.test(JSON.stringify(c.content ?? ''));
      }
    if (m.type === 'result') {
      result = str(m.result) ?? result;
      const subtype = str(m.subtype) ?? 'error';
      if (m.is_error || subtype.startsWith('error'))
        error = `claude: ${subtype} ${(str(m.result) ?? '').slice(0, 200)}`.trim();
    }
  }
  const text = texts.length ? texts.join('\n\n') : (result ?? '');
  return { text, tools, session, ...(error ? { error } : {}) };
}

/** Normalizes `codex exec --json` output (thread/turn/item events, one JSON object per line). */
export function parseCodexJson(out: string): TurnResult {
  const texts: string[] = [];
  const tools: ToolCall[] = [];
  let session: string | null = null;
  let error: string | undefined;
  for (const m of jsonLines(out)) {
    if (m.type === 'thread.started') session = str(m.thread_id) ?? session;
    if (m.type === 'session.created') session = str(m.session_id) ?? session;
    if (m.type === 'turn.failed' || m.type === 'error')
      error = `codex: ${str(obj(m.error).message) ?? str(m.message) ?? String(m.type)}`;
    if (m.type !== 'item.completed') continue;
    const item = obj(m.item);
    const kind = str(item.type) ?? str(item.item_type);
    const text = str(item.text)?.trim();
    if ((kind === 'agent_message' || kind === 'assistant_message') && text) texts.push(text);
    if (kind === 'mcp_tool_call' && (str(item.server) ?? 'scaffold') === 'scaffold') {
      let input: unknown = item.arguments ?? item.args ?? item.input ?? {};
      if (typeof input === 'string') {
        try {
          input = JSON.parse(input);
        } catch {
          input = {};
        }
      }
      const failed =
        item.status === 'failed' || !!item.error || /"ok":\s*false/.test(JSON.stringify(item.result ?? ''));
      const name = (str(item.tool) ?? str(item.name) ?? '').replace(PREFIX, '');
      tools.push({ name, input: obj(input), ok: !failed });
    }
  }
  return { text: texts.join('\n\n'), tools, session, ...(error ? { error } : {}) };
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs a command with the message on stdin and a hard timeout (ARC-10: never hang). */
export function exec(
  cmd: string,
  args: string[],
  opts: { cwd: string; input: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(opts.input, 'utf8');
  });
}

/** Finds an executable: an explicit env override, PATH, then the known Windows install locations. */
export function findExecutable(name: 'claude' | 'codex'): string | null {
  const env = process.env[name === 'claude' ? 'SCAFFOLD_CLAUDE' : 'SCAFFOLD_CODEX'];
  if (env && existsSync(env)) return env;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  const hit = which.status === 0 ? which.stdout.split(/\r?\n/).find((l) => l.trim()) : undefined;
  if (hit && existsSync(hit.trim())) return hit.trim();
  if (process.platform !== 'win32') return null;
  const roots =
    name === 'claude'
      ? [path.join(process.env.APPDATA ?? '', 'Claude', 'claude-code')]
      : [path.join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin')];
  const exe = `${name}.exe`;
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === exe) found.push(p);
      else if (e.isDirectory()) walk(p, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return found.sort().at(-1) ?? null;
}

export interface Workdir {
  dir: string;
  vault: string;
  server: { command: string; args: string[] };
}

/** Prepares a working directory with the skill and adapter files for `provider`. */
export function prepareWorkdir(
  dir: string,
  vault: string,
  provider: 'claude' | 'codex',
  repo = path.resolve('.'),
): Workdir {
  mkdirSync(dir, { recursive: true });
  const serverJs = path.join(repo, 'dist', 'mcp', 'index.js');
  if (!existsSync(serverJs)) throw new Error('dist/mcp/index.js is missing: run `npm run build` first.');
  const server = { command: process.execPath, args: [serverJs, '--vault', vault] };
  const skill = path.join(repo, 'skills', 'scaffold-tutor');
  if (provider === 'claude') {
    cpSync(skill, path.join(dir, '.claude', 'skills', 'scaffold-tutor'), { recursive: true });
    cpSync(path.join(repo, 'CLAUDE.md'), path.join(dir, 'CLAUDE.md'));
    writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { scaffold: server } }, null, 2));
  } else {
    cpSync(skill, path.join(dir, '.agents', 'skills', 'scaffold-tutor'), { recursive: true });
    cpSync(path.join(repo, 'AGENTS.md'), path.join(dir, 'AGENTS.md'));
    // Codex looks for AGENTS.md and .agents/skills from the project (git) root.
    if (!existsSync(path.join(dir, '.git'))) spawnSync('git', ['init', '-q'], { cwd: dir });
  }
  return { dir, vault, server };
}

export const TURN_TIMEOUT_MS = 8 * 60_000;

export class ClaudeProvider implements Provider {
  readonly name = 'claude' as const;
  private readonly session = randomUUID();
  private started = false;
  constructor(
    private readonly exe: string,
    private readonly wd: Workdir,
    private readonly extra: string[] = [],
  ) {}

  args(): string[] {
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      path.join(this.wd.dir, 'mcp.json'),
      '--strict-mcp-config',
      // Only this directory's CLAUDE.md and skill: no user hooks, plugins or other MCP servers.
      '--setting-sources',
      'project',
      '--allowedTools',
      'mcp__scaffold__*',
      'Skill',
      'Read',
      'Glob',
      'Grep',
      '--disallowedTools',
      'Bash',
      'Edit',
      'Write',
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
      'Task',
      ...(this.started ? ['--resume', this.session] : ['--session-id', this.session]),
      ...this.extra,
    ];
  }

  async turn(message: string): Promise<TurnResult> {
    const r = await exec(this.exe, this.args(), {
      cwd: this.wd.dir,
      input: message,
      timeoutMs: TURN_TIMEOUT_MS,
    });
    this.started = true;
    const parsed = parseClaudeStream(r.stdout);
    if (r.timedOut)
      return { ...parsed, error: `claude: turn timed out after ${TURN_TIMEOUT_MS / 60_000} min` };
    if (r.code !== 0 && !parsed.error)
      return { ...parsed, error: `claude exited ${r.code}: ${r.stderr.slice(0, 300)}` };
    return parsed;
  }
}

/** A TOML value for `codex -c key=value` (JSON strings and arrays are valid TOML). */
const toml = (v: unknown): string => JSON.stringify(v);

export class CodexProvider implements Provider {
  readonly name = 'codex' as const;
  private session: string | null = null;
  constructor(
    private readonly exe: string,
    private readonly wd: Workdir,
    private readonly extra: string[] = [],
  ) {}

  config(): string[] {
    const kv = {
      'mcp_servers.scaffold.command': toml(this.wd.server.command),
      'mcp_servers.scaffold.args': toml(this.wd.server.args),
      'mcp_servers.scaffold.startup_timeout_sec': '30',
      'mcp_servers.scaffold.tool_timeout_sec': '60',
      sandbox_mode: toml('read-only'),
      approval_policy: toml('never'),
    };
    return Object.entries(kv).flatMap(([k, v]) => ['-c', `${k}=${v}`]);
  }

  args(): string[] {
    const common = [
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      ...this.config(),
      ...this.extra,
    ];
    return this.session
      ? ['exec', 'resume', ...common, this.session, '-']
      : ['exec', ...common, '-C', this.wd.dir, '-'];
  }

  async turn(message: string): Promise<TurnResult> {
    const r = await exec(this.exe, this.args(), {
      cwd: this.wd.dir,
      input: message,
      timeoutMs: TURN_TIMEOUT_MS,
    });
    const parsed = parseCodexJson(r.stdout);
    this.session ??= parsed.session;
    if (r.timedOut)
      return { ...parsed, error: `codex: turn timed out after ${TURN_TIMEOUT_MS / 60_000} min` };
    if (r.code !== 0 && !parsed.error)
      return { ...parsed, error: `codex exited ${r.code}: ${r.stderr.slice(0, 300)}` };
    if (!this.session) return { ...parsed, error: 'codex: no thread id in the output, cannot resume' };
    return parsed;
  }
}

/** Default parent for working directories: outside the repo, so nothing run-specific is committed (C7). */
export function defaultWorkRoot(runId: string): string {
  return path.join(os.tmpdir(), 'scaffold-ped', runId);
}
