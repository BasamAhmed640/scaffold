// Small deterministic helpers shared by the planner and reports.

/** Total order on strings (code-unit order, locale-independent). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort key comparator: lower numbers first, then ids. */
export function byNumberThenId(an: number, bn: number, aid: string, bid: string): number {
  return an - bn || cmp(aid, bid);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…';
}

export function round(x: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(x * p) / p;
}

/** Lexicographic comparison of sort keys (numbers ascending, strings in code-unit order). */
export function compareKeys(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : cmp(String(x), String(y));
    if (c !== 0) return c;
  }
  return a.length - b.length;
}
