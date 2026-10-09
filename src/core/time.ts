// Time helpers. Events carry local ISO timestamps with an offset ("2026-10-05T19:42:10-04:00");
// all comparisons use absolute instants. Tests inject a fixed clock and an IANA time zone.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  private t: number;
  constructor(start: string | Date) {
    this.t = new Date(start).getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(to: string | Date): void {
    this.t = new Date(to).getTime();
  }
  advanceHours(h: number): void {
    this.t += h * 3_600_000;
  }
  advanceDays(d: number): void {
    this.t += d * 86_400_000;
  }
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

function localParts(d: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (n: number, w = 2): string => String(Math.abs(Math.trunc(n))).padStart(w, '0');

/** Local ISO 8601 with numeric offset, second precision. */
export function toLocalIso(d: Date, tz: string): string {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMin = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const off = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${off}`;
}

/** Local calendar date YYYY-MM-DD. */
export function localDate(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function ms(ts: string): number {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) throw new Error(`Invalid timestamp: ${ts}`);
  return t;
}

export function daysBetween(a: string | number, b: string | number): number {
  const ta = typeof a === 'number' ? a : ms(a);
  const tb = typeof b === 'number' ? b : ms(b);
  return (tb - ta) / DAY_MS;
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
