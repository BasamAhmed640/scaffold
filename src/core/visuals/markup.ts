import { SHIM_CLASSES, themeCss } from './theme.js';

// VIS-05 fast static checks (synchronous, used by the MCP server): well-formed markup, a title/desc
// or aria-label, the size limit, no external network references, no explicit font under the
// minimum, and no plot without a generator. The render check (CLI) catches what static checks
// cannot see (computed fonts, overlaps, overflow, script errors).

export type VisualFormat = 'svg' | 'html';

export interface Element {
  name: string;
  attrs: Record<string, string>;
  parent: number | null;
  /** Text directly inside the element (raw text for script/style). */
  text: string;
}

export interface Parsed {
  elements: Element[];
  errors: string[];
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
/** HTML elements whose end tag may be omitted. */
const OPTIONAL_END = new Set([
  'p',
  'li',
  'dt',
  'dd',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'tfoot',
  'option',
  'optgroup',
  'colgroup',
  'caption',
  'rt',
  'rp',
  'html',
  'head',
  'body',
]);

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(s: string, xml: boolean, errors: string[], tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  let rest = s;
  for (const m of s.matchAll(ATTR)) {
    const name = m[1]!;
    if (xml && m[2] === undefined && m[3] === undefined) {
      errors.push(`<${tag}>: attribute "${name}" has no quoted value`);
      continue;
    }
    if (xml && name in out) errors.push(`<${tag}>: duplicate attribute "${name}"`);
    out[xml ? name : name.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    rest = rest.replace(m[0], '');
  }
  if (xml && rest.trim().replace(/\/$/, '').trim())
    errors.push(`<${tag}>: malformed attributes "${rest.trim().slice(0, 40)}"`);
  return out;
}

/** A tolerant scanner: SVG is checked as XML; HTML allows void elements and omitted end tags. */
export function parseMarkup(src: string, format: VisualFormat): Parsed {
  const xml = format === 'svg';
  const errors: string[] = [];
  const elements: Element[] = [];
  const stack: number[] = [];
  let i = 0;
  const pushText = (t: string): void => {
    const top = stack.at(-1);
    if (top !== undefined) elements[top]!.text += t;
    else if (xml && t.trim()) errors.push(`text outside the root element: "${t.trim().slice(0, 30)}"`);
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      pushText(src.slice(i));
      break;
    }
    pushText(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) {
        errors.push('unterminated comment');
        break;
      }
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (end === -1) {
        errors.push('unterminated CDATA section');
        break;
      }
      pushText(src.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      const end = src.indexOf('>', lt);
      if (end === -1) {
        errors.push('unterminated declaration');
        break;
      }
      i = end + 1;
      continue;
    }
    const gt = src.indexOf('>', lt);
    if (gt === -1) {
      errors.push(`unterminated tag at offset ${lt}`);
      break;
    }
    const raw = src.slice(lt + 1, gt);
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const want = xml ? name : name.toLowerCase();
      // HTML: implicitly close elements with optional end tags
      while (
        !xml &&
        stack.length &&
        elements[stack.at(-1)!]!.name !== want &&
        OPTIONAL_END.has(elements[stack.at(-1)!]!.name)
      )
        stack.pop();
      const top = stack.at(-1);
      if (top === undefined || elements[top]!.name !== want)
        errors.push(`</${name}> does not close <${top === undefined ? 'nothing' : elements[top]!.name}>`);
      else stack.pop();
      i = gt + 1;
      continue;
    }
    const m = /^([^\s/>]+)([\s\S]*?)(\/?)$/.exec(raw);
    if (!m) {
      errors.push(`malformed tag at offset ${lt}`);
      i = gt + 1;
      continue;
    }
    const name = xml ? m[1]! : m[1]!.toLowerCase();
    const attrs = parseAttrs(m[2] ?? '', xml, errors, name);
    const selfClosing = m[3] === '/' || (!xml && VOID.has(name));
    elements.push({ name, attrs, parent: stack.at(-1) ?? null, text: '' });
    const idx = elements.length - 1;
    i = gt + 1;
    if (selfClosing) continue;
    if (!xml && RAW.has(name)) {
      const close = src.toLowerCase().indexOf(`</${name}`, i);
      if (close === -1) {
        errors.push(`<${name}> is never closed`);
        break;
      }
      elements[idx]!.text = src.slice(i, close);
      i = src.indexOf('>', close) + 1;
      continue;
    }
    stack.push(idx);
  }
  for (const idx of stack) {
    const n = elements[idx]!.name;
    if (xml || !OPTIONAL_END.has(n)) errors.push(`<${n}> is never closed`);
  }
  const roots = elements.filter((e) => e.parent === null).length;
  if (xml && roots === 0) errors.push('no root element');
  if (xml && roots > 1) errors.push('more than one root element');
  return { elements, errors };
}

const NETWORK = /^\s*(https?:)?\/\//i;
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'poster', 'data', 'formaction', 'background'];

/** External network references (IF-04, self-contained visuals). data: URIs and #fragments are fine. */
export function networkRefs(parsed: Parsed): string[] {
  const out: string[] = [];
  for (const e of parsed.elements) {
    for (const a of URL_ATTRS) {
      const v = e.attrs[a];
      if (v !== undefined && NETWORK.test(v)) out.push(`<${e.name} ${a}="${v.slice(0, 60)}">`);
    }
    if (e.attrs.srcset && /(https?:)?\/\//i.test(e.attrs.srcset)) out.push(`<${e.name} srcset>`);
    const css = `${e.name === 'style' ? e.text : ''} ${e.attrs.style ?? ''}`;
    for (const m of css.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi))
      out.push(`url(${m[1]!.slice(0, 60)})`);
    for (const m of css.matchAll(/@import\s+(?:url\()?\s*['"]?((?:https?:)?\/\/[^'")\s;]+)/gi))
      out.push(`@import ${m[1]!.slice(0, 60)}`);
    if (e.name === 'script') {
      for (const m of e.text.matchAll(
        /\b(?:fetch|import|importScripts)\s*\(\s*['"`]((?:https?:)?\/\/[^'"`]+)/g,
      ))
        out.push(`script loads ${m[1]!.slice(0, 60)}`);
      for (const m of e.text.matchAll(/\bfrom\s+['"]((?:https?:)?\/\/[^'"]+)/g))
        out.push(`script imports ${m[1]!.slice(0, 60)}`);
    }
  }
  return [...new Set(out)];
}

/** Explicit font sizes below the minimum (attributes and inline styles; the render check sees the rest). */
export function smallFonts(parsed: Parsed, minPx: number): string[] {
  const out: string[] = [];
  const check = (v: string, where: string): void => {
    const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v);
    if (m && Number(m[1]) < minPx) out.push(`${where}: font-size ${m[1]}px (minimum ${minPx}px)`);
  };
  for (const e of parsed.elements) {
    if (e.attrs['font-size']) check(e.attrs['font-size'], `<${e.name}>`);
    for (const m of (e.attrs.style ?? '').matchAll(/font-size\s*:\s*([^;]+)/gi))
      check(m[1]!, `<${e.name} style>`);
    if (e.name === 'style')
      for (const m of e.text.matchAll(/font-size\s*:\s*([\d.]+px)/gi)) check(m[1]!, '<style>');
  }
  return out;
}

export interface StaticInput {
  source: string;
  format: VisualFormat;
  kind: string;
  has_generator: boolean;
  max_bytes: number;
  min_font_px: number;
}

export interface StaticResult {
  ok: boolean;
  errors: string[];
  /** The subset of errors that make a visual unusable (dropped after the fix attempt, VIS-05). */
  fatal: string[];
  warnings: string[];
  uses_shim: boolean;
}

export function staticChecks(input: StaticInput): StaticResult {
  const errors: string[] = [];
  const fatal: string[] = [];
  const warnings: string[] = [];
  const unusable = (m: string): void => {
    errors.push(m);
    fatal.push(m);
  };
  const bytes = Buffer.byteLength(input.source, 'utf8');
  if (bytes > input.max_bytes)
    unusable(`${Math.round(bytes / 1000)} kB is over the ${Math.round(input.max_bytes / 1000)} kB limit`);
  const parsed = parseMarkup(input.source, input.format);
  for (const e of parsed.errors.slice(0, 5)) unusable(`not well-formed: ${e}`);
  const els = parsed.elements;
  if (input.format === 'svg') {
    const root = els.find((e) => e.parent === null);
    if (root && root.name !== 'svg') unusable(`the root element is <${root.name}>, not <svg>`);
    const rootIdx = root ? els.indexOf(root) : -1;
    const title = els.find((e) => e.name === 'title' && e.parent === rootIdx && e.text.trim());
    const desc = els.find((e) => e.name === 'desc' && e.parent === rootIdx && e.text.trim());
    if (!title && !root?.attrs['aria-label'])
      errors.push('missing <title> (or aria-label) on the root <svg>');
    else if (!desc && !root?.attrs['aria-label']) warnings.push('no <desc> on the root <svg>');
    if (root && !root.attrs.viewBox) warnings.push('the root <svg> has no viewBox');
  } else {
    const title = els.find((e) => e.name === 'title' && e.text.trim());
    const labelled = els.some(
      (e) => e.attrs['aria-label']?.trim() || /\bsr-only\b/.test(e.attrs.class ?? ''),
    );
    if (!title && !labelled)
      errors.push('missing <title>, aria-label or a visually hidden summary (class="sr-only")');
  }
  const refs = networkRefs(parsed);
  if (refs.length)
    unusable(`external network references (visuals must be self-contained): ${refs.slice(0, 3).join(', ')}`);
  for (const f of smallFonts(parsed, input.min_font_px).slice(0, 3)) errors.push(f);
  if (input.kind === 'plot' && !input.has_generator)
    errors.push(
      'a plot needs its generator code: every curve is computed from its equation or data (VIS-02)',
    );
  const classes = new Set(els.flatMap((e) => (e.attrs.class ?? '').split(/\s+/)).filter(Boolean));
  const uses = SHIM_CLASSES.some((c) => classes.has(c)) || /var\(--/.test(input.source);
  return { ok: errors.length === 0, errors, fatal, warnings, uses_shim: uses };
}

const SHIM_MARK = 'scaffold-theme-shim';

/** The source without the injected shim (what the tutor re-displays; the visualizer brings its own). */
export function stripShim(src: string): string {
  return src.replace(/\s*<style id="scaffold-theme-shim">[\s\S]*?<\/style>/, '');
}

/** Makes an SVG from the inline visualizer self-contained: namespace, and the shim when it uses it. */
export function prepareSvg(src: string, usesShim: boolean): string {
  let s = src.trim();
  if (!/<svg[^>]*\sxmlns=/.test(s)) s = s.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (usesShim && !s.includes(SHIM_MARK)) {
    const style = `<style id="${SHIM_MARK}">\n${themeCss('svg')}</style>`;
    // after <title>/<desc> so they stay the first children (accessibility)
    const m = /<svg\b[^>]*>(\s*<title>[\s\S]*?<\/title>)?(\s*<desc>[\s\S]*?<\/desc>)?/.exec(s);
    if (m) s = s.slice(0, m.index + m[0].length) + style + s.slice(m.index + m[0].length);
  }
  return `${s}\n`;
}

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Wraps a widget fragment (no <html>) in a self-contained document with the shim. */
export function prepareHtml(src: string, title: string): string {
  const s = src.trim();
  const style = `<style id="${SHIM_MARK}">\n${themeCss('html')}</style>`;
  if (/<html[\s>]/i.test(s)) {
    if (s.includes(SHIM_MARK)) return `${s}\n`;
    return /<head[\s>][^]*?>/i.test(s)
      ? `${s.replace(/<head([\s>][^>]*)?>/i, (h) => `${h}\n${style}`)}\n`
      : `${s}\n`;
  }
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    style,
    '</head>',
    '<body>',
    s,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
