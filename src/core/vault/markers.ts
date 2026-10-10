// LM-02: in note bodies the core writes only between <!-- scaffold:begin NAME --> and
// <!-- scaffold:end NAME -->. If the learner deletes a marker pair, that region is not written.

export function beginMarker(name: string): string {
  return `<!-- scaffold:begin ${name} -->`;
}
export function endMarker(name: string): string {
  return `<!-- scaffold:end ${name} -->`;
}

export function region(name: string, content: string, eol: string): string {
  const inner = content.length > 0 ? `${eol}${content.replace(/\r?\n/g, eol)}${eol}` : eol;
  return `${beginMarker(name)}${inner}${endMarker(name)}`;
}

export interface RegionResult {
  text: string;
  found: boolean;
  changed: boolean;
}

/** Replaces the inner text of a marker region. Text outside the markers is untouched. */
export function replaceRegion(body: string, name: string, content: string, eol: string): RegionResult {
  const b = beginMarker(name);
  const e = endMarker(name);
  const i = body.indexOf(b);
  if (i === -1) return { text: body, found: false, changed: false };
  const j = body.indexOf(e, i + b.length);
  if (j === -1) return { text: body, found: false, changed: false };
  const next = body.slice(0, i) + region(name, content, eol) + body.slice(j + e.length);
  return { text: next, found: true, changed: next !== body };
}

export function readRegion(body: string, name: string): string | null {
  const b = beginMarker(name);
  const e = endMarker(name);
  const i = body.indexOf(b);
  if (i === -1) return null;
  const j = body.indexOf(e, i + b.length);
  if (j === -1) return null;
  return body
    .slice(i + b.length, j)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n$/, '');
}

/** Body text with every marker region's inner text removed: the learner-owned projection. */
export function learnerProjection(body: string): string {
  return body.replace(/(<!-- scaffold:begin ([\w-]+) -->)[\s\S]*?(<!-- scaffold:end \2 -->)/g, '$1$3');
}

/** Text of a `## Heading` section up to the next heading of the same or higher level. */
export function sectionText(body: string, heading: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2} /.test(lines[i]!)) break;
    out.push(lines[i]!);
  }
  return out.join('\n').trim();
}

/** Fills an empty `## Heading` section (whitespace only). Never overwrites learner text. */
export function fillEmptySection(body: string, heading: string, content: string, eol: string): RegionResult {
  const lines = body.split(/(?<=\n)/);
  const start = lines.findIndex((l) => l.replace(/\r?\n$/, '').trim() === `## ${heading}`);
  if (start === -1) return { text: body, found: false, changed: false };
  let end = start + 1;
  while (end < lines.length && !/^#{1,2} /.test(lines[end]!)) end++;
  const existing = lines.slice(start + 1, end).join('');
  if (existing.trim() !== '') return { text: body, found: true, changed: false };
  const filled = `${eol}${content.replace(/\r?\n/g, eol).trim()}${eol}${eol}`;
  const next = lines.slice(0, start + 1).join('') + filled + lines.slice(end).join('');
  return { text: next, found: true, changed: true };
}
