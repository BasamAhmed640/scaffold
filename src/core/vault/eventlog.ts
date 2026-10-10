import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ScaffoldError } from '../envelope.js';
import { parseEvent, type ScaffoldEvent } from '../schemas/events.js';
import { addDaysToDate, localDate } from '../time.js';
import { atomicWrite } from './atomic.js';

// LM-03: Scaffold/_system/events.jsonl is append-only, one JSON object per line, validated with zod.
// LM-13: schema versioned (_system/schema-version); migrations are pure and preceded by a backup;
// a dated daily backup of events.jsonl is kept with 14-day rotation.

export const SCHEMA_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const BACKUP_DAYS = 14;

export interface ReadResult {
  events: ScaffoldEvent[];
  warnings: string[];
  /** 1-based line numbers of lines that failed validation. */
  bad_lines: number[];
}

export interface EventLogOptions {
  timezone: string;
  now: () => Date;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A pure migration from version `from` to `from + 1`. */
export interface Migration {
  from: number;
  describe: string;
  migrate(event: Record<string, unknown>): Record<string, unknown>;
}

/**
 * v0 → v1: v0 was the pre-release draft format, where attempts and `taught` events had a single
 * `kc` string instead of `kc_ids` (synthetic: it exercises the migration path; see DECISIONS.md).
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 0,
    describe: 'kc → kc_ids on attempt and taught events',
    migrate(e) {
      if ((e.type === 'attempt' || e.type === 'taught') && typeof e.kc === 'string' && !('kc_ids' in e)) {
        const { kc, ...rest } = e;
        return { ...rest, kc_ids: [kc] };
      }
      return e;
    },
  },
];

export class EventLog {
  readonly file: string;
  readonly systemDir: string;
  private readonly opts: EventLogOptions;
  private cache: { size: number; mtimeMs: number; result: ReadResult } | null = null;

  constructor(systemDir: string, opts: EventLogOptions) {
    this.systemDir = systemDir;
    this.file = path.join(systemDir, 'events.jsonl');
    this.opts = opts;
  }

  get versionFile(): string {
    return path.join(this.systemDir, 'schema-version');
  }
  get backupDir(): string {
    return path.join(this.systemDir, 'backups');
  }
  private get lockFile(): string {
    return path.join(this.systemDir, 'events.lock');
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  schemaVersion(): number | null {
    if (!existsSync(this.versionFile)) return null;
    const v = Number(readFileSync(this.versionFile, 'utf8').trim());
    return Number.isInteger(v) ? v : null;
  }

  /** Reads and validates every line. A torn last line (crash mid-append) is reported and ignored. */
  read(): ReadResult {
    if (!existsSync(this.file)) return { events: [], warnings: [], bad_lines: [] };
    const st = statSync(this.file);
    if (this.cache && this.cache.size === st.size && this.cache.mtimeMs === st.mtimeMs)
      return this.cache.result;
    const text = readFileSync(this.file, 'utf8');
    const lines = text.split('\n');
    const events: ScaffoldEvent[] = [];
    const warnings: string[] = [];
    const bad: number[] = [];
    lines.forEach((raw, i) => {
      const line = raw.replace(/\r$/, '');
      if (line.trim() === '') return;
      try {
        events.push(parseEvent(JSON.parse(line)));
      } catch {
        bad.push(i + 1);
      }
    });
    if (bad.length > 0) {
      const last = lines.length - (text.endsWith('\n') ? 1 : 0);
      const torn = bad.length === 1 && bad[0] === last && !text.endsWith('\n');
      warnings.push(
        torn
          ? `events.jsonl: the last line is incomplete (interrupted write) and was ignored. Run \`scaffold doctor --fix\`.`
          : `events.jsonl: ${bad.length} invalid line(s) ignored (lines ${bad.slice(0, 5).join(', ')}). Run \`scaffold doctor\`.`,
      );
    }
    const result = { events, warnings, bad_lines: bad };
    this.cache = { size: st.size, mtimeMs: st.mtimeMs, result };
    return result;
  }

  /** Appends validated events under a lock. Events whose id already exists are skipped (LM-04). */
  append(events: ScaffoldEvent[]): ScaffoldEvent[] {
    if (events.length === 0) return [];
    const validated = events.map((e) => parseEvent(e));
    mkdirSync(this.systemDir, { recursive: true });
    return this.withLock(() => {
      const existing = new Set(this.read().events.map((e) => e.id));
      const fresh = validated.filter((e) => !existing.has(e.id));
      if (fresh.length === 0) return [];
      this.dailyBackup();
      let prefix = '';
      if (existsSync(this.file)) {
        const size = statSync(this.file).size;
        if (size > 0) {
          const fd = openSync(this.file, 'r');
          try {
            const b = Buffer.alloc(1);
            readSync(fd, b, 0, 1, size - 1);
            if (b[0] !== 0x0a) prefix = '\n'; // never glue a new event onto a torn line
          } finally {
            closeSync(fd);
          }
        }
      }
      appendFileSync(this.file, prefix + fresh.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      this.cache = null;
      if (this.schemaVersion() === null) writeFileSync(this.versionFile, `${SCHEMA_VERSION}\n`);
      return fresh;
    });
  }

  private tryLock(): number | null {
    try {
      return openSync(this.lockFile, 'wx');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      return null;
    }
  }

  private withLock<T>(fn: () => T): T {
    // RETRY SITE (REL-04): at most 2 attempts to take the lock.
    let fd = this.tryLock();
    if (fd === null) {
      let age = 0;
      try {
        age = Date.now() - statSync(this.lockFile).mtimeMs;
      } catch {
        // the holder just released it: age stays 0
      }
      if (age > LOCK_STALE_MS) rmSync(this.lockFile, { force: true });
      else sleepSync(200);
      fd = this.tryLock();
    }
    if (fd === null)
      throw new ScaffoldError(
        'event_log_locked',
        'Another Scaffold process is writing the event log.',
        'Retry in a moment; if it persists, delete Scaffold/_system/events.lock.',
      );
    try {
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}`);
      closeSync(fd);
      return fn();
    } finally {
      rmSync(this.lockFile, { force: true });
    }
  }

  /** LM-13: one dated backup per day, 14-day rotation (only Scaffold's own backup files are removed). */
  dailyBackup(): string | null {
    if (!existsSync(this.file)) return null;
    mkdirSync(this.backupDir, { recursive: true });
    const today = localDate(this.opts.now(), this.opts.timezone);
    const target = path.join(this.backupDir, `events-${today}.jsonl`);
    if (!existsSync(target)) copyFileSync(this.file, target);
    const cutoff = addDaysToDate(today, -BACKUP_DAYS);
    for (const f of readdirSync(this.backupDir)) {
      const m = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && m[1]! < cutoff) rmSync(path.join(this.backupDir, f), { force: true });
    }
    return target;
  }

  /**
   * Migrates the log to SCHEMA_VERSION if needed. Copies events.jsonl to
   * backups/events-pre-migration-v<from>-<stamp>.jsonl first. Never asks, never blocks (REL-03).
   */
  migrateIfNeeded(): { migrated: boolean; from: number | null; backup: string | null } {
    const v = this.schemaVersion();
    if (!existsSync(this.file)) {
      if (v === null) {
        mkdirSync(this.systemDir, { recursive: true });
        writeFileSync(this.versionFile, `${SCHEMA_VERSION}\n`);
      }
      return { migrated: false, from: v, backup: null };
    }
    const from = v ?? 0;
    if (from === SCHEMA_VERSION) return { migrated: false, from, backup: null };
    if (from > SCHEMA_VERSION)
      throw new ScaffoldError(
        'schema_too_new',
        `The vault uses event schema v${from}; this Scaffold understands v${SCHEMA_VERSION}.`,
        'Update Scaffold (npm i -g scaffold-tutor) before using this vault.',
      );
    mkdirSync(this.backupDir, { recursive: true });
    const stamp = this.opts.now().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(this.backupDir, `events-pre-migration-v${from}-${stamp}.jsonl`);
    copyFileSync(this.file, backup);
    const lines = readFileSync(this.file, 'utf8').split('\n');
    const out: string[] = [];
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.trim() === '') continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        out.push(line); // keep unreadable lines verbatim; doctor reports them
        continue;
      }
      for (let ver = from; ver < SCHEMA_VERSION; ver++) {
        const m = MIGRATIONS.find((x) => x.from === ver);
        if (m) obj = m.migrate(obj);
      }
      out.push(JSON.stringify(obj));
    }
    atomicWrite(this.file, out.join('\n') + '\n');
    writeFileSync(this.versionFile, `${SCHEMA_VERSION}\n`);
    this.cache = null;
    return { migrated: true, from, backup };
  }

  /** doctor --fix: moves a torn last line into backups/ and truncates it from the log. */
  repairTornTail(): boolean {
    if (!existsSync(this.file)) return false;
    const text = readFileSync(this.file, 'utf8');
    if (text.endsWith('\n') || text.length === 0) return false;
    const cut = text.lastIndexOf('\n') + 1;
    const tail = text.slice(cut);
    try {
      parseEvent(JSON.parse(tail));
      atomicWrite(this.file, text + '\n');
      this.cache = null;
      return true;
    } catch {
      mkdirSync(this.backupDir, { recursive: true });
      writeFileSync(path.join(this.backupDir, `torn-line-${Date.now()}.txt`), tail);
      atomicWrite(this.file, text.slice(0, cut));
      this.cache = null;
      return true;
    }
  }
}
