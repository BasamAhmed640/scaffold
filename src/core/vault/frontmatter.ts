import { Document, isCollection, isMap, isScalar, parseDocument, type Pair } from 'yaml';
import { ScaffoldError } from '../envelope.js';

// LM-02 / VLT-02: the core rewrites only the frontmatter keys it owns. Every other byte of the
// file (unknown keys, comments, formatting, the body) is preserved exactly. Edits are surgical:
// each top-level key owns a line range, and only the ranges of updated keys are replaced.

export const DERIVED_HEADER = '# ---- derived: written only by scaffold-core ----';

export interface SplitNote {
  bom: string;
  eol: '\n' | '\r\n';
  hasFrontmatter: boolean;
  /** Frontmatter text between the fences (without fences), using the file's line endings. */
  fm: string;
  /** Everything after the closing fence line. */
  body: string;
}

export function detectEol(text: string): '\n' | '\r\n' {
  const i = text.indexOf('\n');
  return i > 0 && text[i - 1] === '\r' ? '\r\n' : '\n';
}

export function splitNote(text: string): SplitNote {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const t = bom ? text.slice(1) : text;
  const eol = detectEol(t);
  const open = /^---[ \t]*\r?\n/.exec(t);
  if (!open) return { bom, eol, hasFrontmatter: false, fm: '', body: t };
  const rest = t.slice(open[0].length);
  const close = /^---[ \t]*(\r?\n|$)/m.exec(rest);
  if (!close) return { bom, eol, hasFrontmatter: false, fm: '', body: t };
  return {
    bom,
    eol,
    hasFrontmatter: true,
    fm: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length),
  };
}

export function joinNote(n: SplitNote): string {
  if (!n.hasFrontmatter) return n.bom + n.body;
  return `${n.bom}---${n.eol}${n.fm}---${n.eol}${n.body}`;
}

export function parseFrontmatter(fm: string): Record<string, unknown> {
  if (fm.trim() === '') return {};
  const doc = parseDocument(fm);
  if (doc.errors.length > 0) {
    throw new ScaffoldError(
      'frontmatter_invalid',
      `YAML error: ${doc.errors[0]!.message.split('\n')[0]}`,
      'Fix the note’s properties in Obsidian (Source mode) and retry.',
    );
  }
  const v = doc.toJS() as unknown;
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v))
    throw new ScaffoldError('frontmatter_invalid', 'Frontmatter is not a key/value map.');
  return v as Record<string, unknown>;
}

interface KeySegment {
  key: string;
  /** Offset of the start of the key's line. */
  start: number;
  /** Offset of the start of the next key's line (or end of text). */
  end: number;
}

function lineStart(text: string, offset: number): number {
  const i = text.lastIndexOf('\n', offset - 1);
  return i === -1 ? 0 : i + 1;
}

function segments(fm: string): KeySegment[] {
  if (fm.trim() === '') return [];
  const doc = parseDocument(fm, { keepSourceTokens: true });
  if (doc.errors.length > 0) {
    throw new ScaffoldError(
      'frontmatter_invalid',
      `YAML error: ${doc.errors[0]!.message.split('\n')[0]}`,
      'Fix the note’s properties in Obsidian (Source mode) and retry.',
    );
  }
  if (!isMap(doc.contents)) {
    if (doc.contents === null) return [];
    throw new ScaffoldError('frontmatter_invalid', 'Frontmatter is not a key/value map.');
  }
  const items = doc.contents.items as Pair[];
  const starts = items.map((p) => {
    const k = p.key;
    if (!isScalar(k) || !k.range)
      throw new ScaffoldError('frontmatter_invalid', 'Unsupported frontmatter key.');
    return { key: String(k.value), start: lineStart(fm, k.range[0]) };
  });
  return starts.map((s, i) => ({
    key: s.key,
    start: s.start,
    end: i + 1 < starts.length ? starts[i + 1]!.start : fm.length,
  }));
}

/** Serializes one top-level key. Plain objects are written in flow style, like the spec example. */
export function serializeKey(
  key: string,
  value: unknown,
  eol: string,
  opts: { flow?: boolean } = {},
): string {
  if (value === undefined) return '';
  const doc = new Document({ [key]: value });
  const contents = doc.contents;
  if (opts.flow !== false && isMap(contents)) {
    const pair = contents.items[0] as Pair | undefined;
    const v = pair?.value;
    if (isCollection(v)) v.flow = true;
  }
  const text = doc.toString({ lineWidth: 0, flowCollectionPadding: false, defaultStringType: 'PLAIN' });
  return text.replace(/\r?\n/g, eol);
}

function splitLines(s: string): string[] {
  const parts = s.split(/(?<=\n)/);
  return parts.filter((p) => p.length > 0);
}

/**
 * Replaces or inserts top-level keys. `undefined` removes a key. Lines that belong to other keys,
 * comments between keys and blank lines are kept byte for byte.
 * @param placeBefore insert new keys before this comment line if present (keeps derived keys last)
 */
export function setKeys(
  fm: string,
  updates: Record<string, unknown>,
  eol: '\n' | '\r\n',
  opts: { insertBeforeHeader?: boolean; header?: string } = {},
): string {
  const segs = segments(fm);
  let out = '';
  let cursor = 0;
  const done = new Set<string>();
  for (const seg of segs) {
    out += fm.slice(cursor, seg.start);
    cursor = seg.end;
    if (!(seg.key in updates)) {
      out += fm.slice(seg.start, seg.end);
      continue;
    }
    done.add(seg.key);
    // Keep trailing column-0 comments and blank lines: they introduce the next key.
    const lines = splitLines(fm.slice(seg.start, seg.end));
    let j = lines.length - 1;
    while (j > 0 && (/^\s*\r?\n?$/.test(lines[j]!) || lines[j]!.startsWith('#'))) j--;
    const trailing = lines.slice(j + 1).join('');
    const value = updates[seg.key];
    if (value !== undefined) out += serializeKey(seg.key, value, eol);
    out += trailing;
  }
  out += fm.slice(cursor);
  const missing = Object.keys(updates).filter((k) => !done.has(k) && updates[k] !== undefined);
  if (missing.length === 0) return out;
  if (out.length > 0 && !out.endsWith('\n')) out += eol;
  const header = opts.header;
  let insertion = '';
  if (header && !out.split(/\r?\n/).includes(header) && !opts.insertBeforeHeader) insertion += header + eol;
  for (const k of missing) insertion += serializeKey(k, updates[k], eol);
  if (opts.insertBeforeHeader && header) {
    const idx = findLine(out, header);
    if (idx >= 0) return out.slice(0, idx) + insertion + out.slice(idx);
  }
  return out + insertion;
}

function findLine(text: string, line: string): number {
  let pos = 0;
  for (const l of splitLines(text)) {
    if (l.replace(/\r?\n$/, '') === line) return pos;
    pos += l.length;
  }
  return -1;
}

/** Updates derived keys (written last, under the derived header). */
export function setDerivedKeys(fm: string, updates: Record<string, unknown>, eol: '\n' | '\r\n'): string {
  return setKeys(fm, updates, eol, { header: DERIVED_HEADER });
}

/** Updates learner-owned keys on the learner's explicit request (inserted above the derived header). */
export function setOwnedKeys(fm: string, updates: Record<string, unknown>, eol: '\n' | '\r\n'): string {
  return setKeys(fm, updates, eol, { header: DERIVED_HEADER, insertBeforeHeader: true });
}
