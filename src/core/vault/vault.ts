import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseConfig, type Config } from '../config.js';
import { ScaffoldError } from '../envelope.js';
import { randomIds, type IdSource } from '../ids.js';
import { systemClock, systemTimeZone, toLocalIso, type Clock } from '../time.js';
import { atomicWrite, type AtomicHooks } from './atomic.js';
import { EventLog } from './eventlog.js';
import {
  joinNote,
  parseFrontmatter,
  setDerivedKeys,
  setOwnedKeys,
  splitNote,
  type SplitNote,
} from './frontmatter.js';
import { replaceRegion } from './markers.js';
import { confine, SCAFFOLD_DIR, vaultRel } from './paths.js';

// Plain file I/O over <vault>/Scaffold. Works with Obsidian closed; no plugin required (VLT-03).

export interface VaultOptions {
  clock?: Clock;
  ids?: IdSource;
  /** Overrides config.timezone (tests). */
  timezone?: string;
  hooks?: AtomicHooks;
}

export interface NoteFile {
  rel: string;
  split: SplitNote;
  data: Record<string, unknown>;
}

export class Vault {
  readonly root: string;
  readonly dir: string;
  readonly sys: string;
  readonly log: EventLog;
  readonly clock: Clock;
  readonly ids: IdSource;
  private readonly tzOverride: string | undefined;
  private readonly hooks: AtomicHooks;
  private configCache: { mtimeMs: number; cfg: Config } | null = null;

  constructor(root: string, opts: VaultOptions = {}) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, SCAFFOLD_DIR);
    this.sys = path.join(this.dir, '_system');
    this.clock = opts.clock ?? systemClock;
    this.ids = opts.ids ?? randomIds;
    this.tzOverride = opts.timezone;
    this.hooks = opts.hooks ?? {};
    this.log = new EventLog(this.sys, { timezone: this.tz(), now: () => this.clock.now() });
  }

  /** Opens an initialized vault; fails loudly with a next step (REL-03). Migrates the log if needed. */
  static open(root: string, opts: VaultOptions = {}): Vault {
    const v = new Vault(root, opts);
    if (!existsSync(v.root))
      throw new ScaffoldError(
        'vault_missing',
        `Vault folder not found: ${v.root}`,
        'Check the path, or run `scaffold init <vault>`.',
      );
    if (!existsSync(v.dir))
      throw new ScaffoldError(
        'vault_not_initialized',
        `No Scaffold folder in ${v.root}.`,
        `Run \`scaffold init "${v.root}"\`.`,
      );
    v.log.migrateIfNeeded();
    return v;
  }

  tz(): string {
    if (this.tzOverride) return this.tzOverride;
    try {
      return this.config().timezone ?? systemTimeZone();
    } catch {
      return systemTimeZone();
    }
  }

  now(): Date {
    return this.clock.now();
  }

  nowIso(): string {
    return toLocalIso(this.clock.now(), this.tz());
  }

  config(): Config {
    const file = path.join(this.sys, 'config.json');
    if (!existsSync(file)) return parseConfig({});
    const st = statSync(file);
    if (this.configCache && this.configCache.mtimeMs === st.mtimeMs) return this.configCache.cfg;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new ScaffoldError(
        'config_invalid',
        'Scaffold/_system/config.json is not valid JSON.',
        'Fix the file or restore it from the vault template.',
      );
    }
    let cfg: Config;
    try {
      cfg = parseConfig(raw);
    } catch (e) {
      throw new ScaffoldError(
        'config_invalid',
        `config.json: ${(e as Error).message.slice(0, 200)}`,
        'Fix the listed setting.',
      );
    }
    this.configCache = { mtimeMs: st.mtimeMs, cfg };
    return cfg;
  }

  /** Vault-relative POSIX path → confined absolute path (IF-03). */
  abs(rel: string): string {
    return confine(this.root, rel);
  }

  rel(abs: string): string {
    return vaultRel(this.root, abs);
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel));
  }

  readText(rel: string): string | null {
    const p = this.abs(rel);
    if (!existsSync(p)) return null;
    return readFileSync(p, 'utf8');
  }

  writeText(rel: string, text: string): void {
    atomicWrite(this.abs(rel), text, this.hooks);
  }

  writeBytes(rel: string, data: Buffer): void {
    atomicWrite(this.abs(rel), data, this.hooks);
  }

  /** Writes a new file; never overwrites an existing one. Returns false if it already existed. */
  createText(rel: string, text: string): boolean {
    if (this.exists(rel)) return false;
    this.writeText(rel, text);
    return true;
  }

  ensureDir(rel: string): void {
    mkdirSync(this.abs(rel), { recursive: true });
  }

  isWritable(rel: string): boolean {
    try {
      accessSync(this.abs(rel), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** Markdown files in a Scaffold folder, sorted. */
  listMarkdown(folderRel: string): string[] {
    const dir = this.abs(folderRel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .sort()
      .map((f) => `${folderRel}/${f}`);
  }

  /** Sub-folder names of a Scaffold folder, sorted. */
  listDirs(folderRel: string): string[] {
    const dir = this.abs(folderRel);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  }

  readNote(rel: string): NoteFile | null {
    const text = this.readText(rel);
    if (text === null) return null;
    const split = splitNote(text);
    const data = split.hasFrontmatter ? parseFrontmatter(split.fm) : {};
    return { rel, split, data };
  }

  /**
   * LM-02: updates only derived frontmatter keys and marker regions. Returns true if the file changed.
   * Missing marker pairs are reported as warnings and left alone.
   */
  writeDerived(
    rel: string,
    derived: Record<string, unknown>,
    regions: Record<string, string> = {},
    warn?: (m: string) => void,
  ): boolean {
    const text = this.readText(rel);
    if (text === null) return false;
    const split = splitNote(text);
    if (!split.hasFrontmatter) {
      warn?.(`${rel}: no properties block; derived fields not written.`);
      return false;
    }
    let fm = split.fm;
    if (Object.keys(derived).length > 0) fm = setDerivedKeys(fm, derived, split.eol);
    let body = split.body;
    for (const [name, content] of Object.entries(regions)) {
      const r = replaceRegion(body, name, content, split.eol);
      if (!r.found) warn?.(`${rel}: marker "${name}" missing; that section was not updated.`);
      body = r.text;
    }
    const next = joinNote({ ...split, fm, body });
    if (next === text) return false;
    this.writeText(rel, next);
    return true;
  }

  /** Updates learner-owned keys on an explicit learner request (upsert tools). */
  writeOwned(rel: string, owned: Record<string, unknown>): boolean {
    const text = this.readText(rel);
    if (text === null) return false;
    const split = splitNote(text);
    if (!split.hasFrontmatter) return false;
    const fm = setOwnedKeys(split.fm, owned, split.eol);
    const next = joinNote({ ...split, fm });
    if (next === text) return false;
    this.writeText(rel, next);
    return true;
  }

  writeBody(rel: string, fn: (body: string, eol: string) => string): boolean {
    const text = this.readText(rel);
    if (text === null) return false;
    const split = splitNote(text);
    const body = fn(split.body, split.eol);
    const next = joinNote({ ...split, body });
    if (next === text) return false;
    this.writeText(rel, next);
    return true;
  }
}

export const FOLDERS = {
  concepts: `${SCAFFOLD_DIR}/Concepts`,
  subjects: `${SCAFFOLD_DIR}/Subjects`,
  questions: `${SCAFFOLD_DIR}/Questions`,
  visuals: `${SCAFFOLD_DIR}/Visuals`,
  sessions: `${SCAFFOLD_DIR}/Sessions`,
  sources: `${SCAFFOLD_DIR}/Sources`,
  learner: `${SCAFFOLD_DIR}/Learner`,
  weekly: `${SCAFFOLD_DIR}/Learner/Weekly`,
  bases: `${SCAFFOLD_DIR}/_bases`,
  templates: `${SCAFFOLD_DIR}/_templates`,
  system: `${SCAFFOLD_DIR}/_system`,
  queue: `${SCAFFOLD_DIR}/_system/queue`,
  backups: `${SCAFFOLD_DIR}/_system/backups`,
} as const;

export const conceptRel = (id: string): string => `${FOLDERS.concepts}/${id}.md`;
export const subjectRel = (id: string): string => `${FOLDERS.subjects}/${id}.md`;
export const questionRel = (id: string): string => `${FOLDERS.questions}/${id}.md`;
export const sessionRel = (id: string): string => `${FOLDERS.sessions}/${id}.md`;
export const visualDirRel = (id: string): string => `${FOLDERS.visuals}/${id}`;
