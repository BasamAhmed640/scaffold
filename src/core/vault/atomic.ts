import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ScaffoldError } from '../envelope.js';

// VLT-02: writes are atomic (temp file + fsync + rename). A crash leaves either the old or the new
// file, never a truncated one. REL-04: the rename retry is bounded (at most 2 attempts).

export const TMP_MARK = '.scaffold-tmp-';

/** Test hook: called between writing the temp file and renaming it (simulated crash). */
export interface AtomicHooks {
  beforeRename?: (tmpPath: string, target: string) => void;
}

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function atomicWrite(target: string, content: string | Buffer, hooks: AtomicHooks = {}): void {
  const dir = path.dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(target)}${TMP_MARK}${randomBytes(4).toString('hex')}`);
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    hooks.beforeRename?.(tmp, target);
    // RETRY SITE (REL-04): Windows may briefly lock a file (Obsidian, antivirus); 2 attempts max.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        renameSync(tmp, target);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (attempt === 2 || !RETRY_CODES.has(code)) throw err;
        sleepSync(150);
      }
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    const code = (err as NodeJS.ErrnoException).code;
    if (code && RETRY_CODES.has(code))
      throw new ScaffoldError(
        'file_locked',
        `Could not replace ${target} (${code}).`,
        'Close programs that lock the file (or pause sync) and retry.',
      );
    throw err;
  }
}
