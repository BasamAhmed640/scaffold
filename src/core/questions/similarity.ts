// Wording similarity, used to keep tutor questions and Anki cards worded differently
// (QB-01 item 6, ANK-02) and to detect near-duplicate cards (ANK-10).

const STOP = new Set(
  'the a an and or of to in on at for is are was were be by with what which how why does do did this that it its as from into than then when where who whom your you his her their there these those can could would should will if not no yes'.split(
    ' ',
  ),
);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/** DEFAULT threshold above which two texts count as "worded alike". */
export const SIMILAR_WORDING = 0.6;

export function wordedAlike(a: string, b: string, threshold = SIMILAR_WORDING): boolean {
  return jaccard(a, b) >= threshold;
}
