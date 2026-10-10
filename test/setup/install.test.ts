import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  installedExtensions,
  projectTable,
  readState,
  serverPath,
  sha256Of,
  trustCodexFolder,
  writeState,
  writeTutorFolder,
} from '../../scripts/setup/install.js';
import { cleanPath, parseArgs } from '../../scripts/setup/update.js';

// `npm run update` helpers (D-91, D-94): the Scaffold Tutor folder, Codex trust, and what Claude
// Desktop has installed. Everything runs in temporary folders; nothing touches the real apps.

const dirs: string[] = [];
const tmp = (name = 'scaffold-setup-'): string => {
  const d = mkdtempSync(path.join(tmpdir(), name));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeRepo(): string {
  const repo = tmp();
  writeFileSync(path.join(repo, 'AGENTS.md'), '# Codex adapter\n');
  writeFileSync(path.join(repo, 'CLAUDE.md'), '# Claude adapter\n');
  mkdirSync(path.join(repo, 'skills', 'scaffold-tutor', 'references'), { recursive: true });
  writeFileSync(path.join(repo, 'skills', 'scaffold-tutor', 'SKILL.md'), '---\nname: scaffold-tutor\n---\n');
  writeFileSync(path.join(repo, 'skills', 'scaffold-tutor', 'references', 'tools.md'), 'tools\n');
  return repo;
}

const hasGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

describe('D-91 the Scaffold Tutor folder', () => {
  const repo = fakeRepo();
  const vault = path.join(tmp(), "Owner's vault");
  const folder = path.join(tmp(), 'Scaffold Tutor');
  const node = path.join(tmp(), 'node "x".exe');
  const o = { repo, vault, folder, node };

  it('holds both adapters, the skill for both apps and both MCP configs, without a byte-order mark', () => {
    const { git } = writeTutorFolder(o);
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'README.md'])
      expect(existsSync(path.join(folder, f)), f).toBe(true);
    for (const d of ['.agents', '.claude'])
      expect(
        readFileSync(path.join(folder, d, 'skills', 'scaffold-tutor', 'references', 'tools.md'), 'utf8'),
      ).toBe('tools\n');
    const toml = readFileSync(path.join(folder, '.codex', 'config.toml'), 'utf8');
    expect(toml.charCodeAt(0)).not.toBe(0xfeff);
    // TOML basic strings use JSON's escapes, so each value parses as JSON
    const value = (key: string): unknown =>
      JSON.parse(new RegExp(`^${key} = (.+)$`, 'm').exec(toml)![1]!) as unknown;
    expect(value('command')).toBe(node);
    expect(value('args')).toEqual([serverPath(repo), '--vault', vault]);
    expect(toml).toMatch(/^default_tools_approval_mode = "approve"$/m);
    const mcp = JSON.parse(readFileSync(path.join(folder, '.mcp.json'), 'utf8')) as unknown;
    expect(mcp).toEqual({
      mcpServers: { scaffold: { command: node, args: [serverPath(repo), '--vault', vault] } },
    });
    if (hasGit) expect(git && existsSync(path.join(folder, '.git'))).toBe(true);
  });

  it('a refresh replaces the skill, so files removed from it disappear', () => {
    const stale = path.join(folder, '.claude', 'skills', 'scaffold-tutor', 'old.md');
    writeFileSync(stale, 'old');
    writeTutorFolder(o);
    expect(existsSync(stale)).toBe(false);
  });
});

describe('D-94 Codex trust entry', () => {
  it('without Codex nothing is written', () => {
    const home = path.join(tmp(), 'no-codex');
    expect(trustCodexFolder('/x/Scaffold Tutor', { home, platform: 'linux' }).status).toBe('no_codex');
    expect(existsSync(home)).toBe(false);
  });

  it('adds the entry once, after a backup, keeping the rest of the file', () => {
    const home = tmp();
    const config = path.join(home, 'config.toml');
    const before = 'model = "x"\n\n[features]\nhooks = true';
    writeFileSync(config, before);
    const now = new Date('2026-10-10T12:00:00Z');
    const first = trustCodexFolder('C:\\Users\\Owner\\Scaffold Tutor', { home, platform: 'win32', now });
    expect(first.status).toBe('added');
    expect(readFileSync(first.backup!, 'utf8')).toBe(before);
    const after = readFileSync(config, 'utf8');
    expect(after).toBe(
      `${before}\n\n[projects.'c:\\users\\owner\\scaffold tutor']\ntrust_level = "trusted"\n`,
    );
    expect(trustCodexFolder('C:\\Users\\Owner\\Scaffold Tutor', { home, platform: 'win32' }).status).toBe(
      'present',
    );
    expect(readFileSync(config, 'utf8')).toBe(after);
  });

  it('a path with an apostrophe gets a quoted key that is found again', () => {
    const home = tmp();
    const folder = "/home/o'brien/Scaffold Tutor";
    expect(trustCodexFolder(folder, { home, platform: 'linux' })).toMatchObject({ status: 'added' });
    const text = readFileSync(path.join(home, 'config.toml'), 'utf8');
    expect(text).toContain(`[projects."/home/o'brien/Scaffold Tutor"]`);
    expect(projectTable(text, folder, 'linux')).toContain('trust_level = "trusted"');
    expect(trustCodexFolder(folder, { home, platform: 'linux' }).status).toBe('present');
  });

  it("leaves the owner's own choice alone", () => {
    const home = tmp();
    const config = path.join(home, 'config.toml');
    const text = '[projects.\'/x/scaffold tutor\']\ntrust_level = "untrusted"\n';
    writeFileSync(config, text);
    expect(trustCodexFolder('/x/scaffold tutor', { home, platform: 'linux' }).status).toBe('not_trusted');
    expect(readFileSync(config, 'utf8')).toBe(text);
  });
});

describe('D-94 Claude Desktop extension check', () => {
  it('finds the installed copy, its server hash, vault and switch, and ignores other extensions', () => {
    const root = tmp();
    const ext = path.join(root, 'Claude Extensions', 'local.mcpb.owner.scaffold');
    mkdirSync(path.join(ext, 'server'), { recursive: true });
    writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ name: 'scaffold' }));
    writeFileSync(path.join(ext, 'server', 'index.mjs'), 'export {};\n');
    const other = path.join(root, 'Claude Extensions', 'other');
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'manifest.json'), JSON.stringify({ name: 'filesystem' }));
    mkdirSync(path.join(root, 'Claude Extensions Settings'));
    writeFileSync(
      path.join(root, 'Claude Extensions Settings', 'local.mcpb.owner.scaffold.json'),
      JSON.stringify({ isEnabled: false, userConfig: { vault: 'D:\\Vault' } }),
    );
    expect(installedExtensions([root, path.join(root, 'missing')])).toEqual([
      {
        dir: ext,
        server_sha256: sha256Of(path.join(ext, 'server', 'index.mjs')),
        vault: 'D:\\Vault',
        enabled: false,
      },
    ]);
  });

  it('a folder hash changes when any file in it changes', () => {
    const repo = fakeRepo();
    const skill = path.join(repo, 'skills', 'scaffold-tutor');
    const a = sha256Of(skill);
    expect(sha256Of(skill)).toBe(a);
    writeFileSync(path.join(skill, 'references', 'tools.md'), 'tools v2\n');
    expect(sha256Of(skill)).not.toBe(a);
  });

  it('remembers the confirmed skill upload under local/', () => {
    const repo = tmp();
    expect(readState(repo)).toEqual({});
    writeState(repo, { skill_sha256: 'abc', skill_uploaded_at: '2026-10-10T12:00:00.000Z' });
    expect(readState(repo).skill_sha256).toBe('abc');
    expect(existsSync(path.join(repo, 'local', 'install-state.json'))).toBe(true);
  });
});

describe('D-94 npm run update options', () => {
  it('reads --vault, --folder, --skip-tests and --no-wait; rejects the rest', () => {
    expect(parseArgs(['--vault', 'V', '--skip-tests', '--no-wait'])).toEqual({
      vault: 'V',
      skipTests: true,
      wait: false,
      help: false,
    });
    expect(() => parseArgs(['--vault'])).toThrow(/needs a folder path/);
    expect(() => parseArgs(['--fast'])).toThrow(/Unknown option --fast/);
  });

  it('a pasted path loses the quotes that "Copy as path" adds', () => {
    expect(cleanPath(' "C:\\Vaults\\Owner\'s vault" ')).toBe(path.resolve("C:\\Vaults\\Owner's vault"));
  });
});
