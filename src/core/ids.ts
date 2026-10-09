import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface IdSource {
  /** Event id: 10 time chars + 6 random chars, Crockford base32 (sortable). */
  eventId(now: Date): string;
}

function encodeTime(t: number, len: number): string {
  let out = '';
  let v = t;
  for (let i = 0; i < len; i++) {
    out = CROCKFORD[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

function encodeRandom(bytes: Uint8Array, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CROCKFORD[(bytes[i] ?? 0) % 32];
  return out;
}

export const randomIds: IdSource = {
  eventId(now: Date): string {
    return encodeTime(now.getTime(), 10) + encodeRandom(randomBytes(6), 6);
  },
};

/** Deterministic ids for tests. */
export class SeqIds implements IdSource {
  private n = 0;
  eventId(now: Date): string {
    this.n += 1;
    return encodeTime(now.getTime(), 10) + encodeTime(this.n, 6);
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function shortHash(text: string, len = 12): string {
  return sha256(text).slice(0, len);
}

/** Formats a numbered id like Q-0041. */
export function numberedId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

export function nextNumberedId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return numberedId(prefix, max + 1);
}
