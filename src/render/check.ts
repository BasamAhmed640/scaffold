import type { Browser } from 'playwright';
import { ScaffoldError } from '../core/envelope.js';
import type { RenderCheck } from '../core/service/visuals.js';
import { compile, PlotSpec } from '../core/visuals/plot.js';

// VIS-05 render check (CLI only; Playwright is an optional dependency so the .mcpb stays small).
// Each visual renders at 680 px in light and dark mode with every network request blocked. It fails
// on console or script errors, overlapping text, text outside the viewBox or viewport, effective
// fonts under the minimum, a plot without a generator, and a computed plot that does not match its
// equation (V-VIS: 50 sampled points, max error ≤ 1 % of the axis range). Light mode gives preview.png.

export const RENDER_WIDTH = 680;
/** Reserved TLD: requests are fulfilled in-process and never leave the machine (IF-04). */
const ORIGIN = 'http://scaffold.invalid';
const PLOT_SAMPLES = 50;
const PLOT_MAX_ERROR_PCT = 1;
const MAX_PREVIEW_HEIGHT = 3000;

export interface RenderInput {
  format: 'svg' | 'html';
  /** The stored file (figure.svg with the shim, or index.html). */
  source: string;
  kind: string;
  has_generator: boolean;
  generator: string | null;
  min_font_px: number;
  sha256: string;
}

export interface RenderOutput {
  result: RenderCheck;
  preview: Buffer | null;
}

/** Launches Chromium, falling back to the installed Edge channel. */
export async function launchBrowser(): Promise<{ browser: Browser; name: string }> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new ScaffoldError(
      'playwright_missing',
      'The render check needs Playwright, an optional dependency.',
      'Run `npm install playwright` and then `npx playwright install chromium`.',
    );
  }
  const errs: string[] = [];
  // RETRY SITE (REL-04): two launch attempts at most, bundled Chromium then Edge.
  for (const channel of [undefined, 'msedge'] as const) {
    try {
      const browser = await pw.chromium.launch({ ...(channel ? { channel } : {}), timeout: 30_000 });
      return { browser, name: `${channel ?? 'chromium'} ${browser.version()}` };
    } catch (e) {
      errs.push((e as Error).message.split('\n')[0]!);
    }
  }
  throw new ScaffoldError(
    'chromium_missing',
    `Could not start Chromium or Edge: ${errs[0]}`,
    'Run `npx playwright install chromium`.',
  );
}

const HARNESS_CSS = [
  'html { background: #fcfcfb; color-scheme: light dark; }',
  '@media (prefers-color-scheme: dark) { html { background: #1f1f1e; } }',
  `body { margin: 0; } #scaffold-figure { width: ${RENDER_WIDTH}px; }`,
].join('\n');

function harness(input: RenderInput): string {
  if (input.format === 'html') return input.source;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>render check</title><style>${HARNESS_CSS}</style></head><body><div id="scaffold-figure">${input.source}</div></body></html>`;
}

// Runs in the page. Plain JS (a string) so the Node build needs no DOM types.
const PROBE = String.raw`(opts) => {
  const rectOf = (r) => [r.left, r.top, r.right, r.bottom];
  const shown = (el) => {
    for (let p = el; p && p.nodeType === 1; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || parseFloat(s.opacity) === 0) return false;
    }
    return true;
  };
  const rgb = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const pageBg = rgb(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  const bgAt = (x, y, self) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === self || self.contains(el)) continue;
      const s = getComputedStyle(el);
      if (el instanceof SVGElement) {
        if (['rect', 'circle', 'ellipse', 'polygon', 'path'].includes(el.tagName.toLowerCase())) {
          const f = rgb(s.fill);
          if (f && f.a * parseFloat(s.fillOpacity || '1') > 0.5) return f;
        }
        continue;
      }
      const b = rgb(s.backgroundColor);
      if (b && b.a > 0.5) return b;
    }
    return pageBg;
  };
  const items = [];
  const svgs = [...document.querySelectorAll('svg')].filter((s) => !s.ownerSVGElement);
  let group = 0;
  const add = (el, label, r, px, svg, g) => {
    if (r.width < 0.5 || r.height < 0.5) return;
    const s = getComputedStyle(el);
    const fg = rgb(el instanceof SVGElement ? s.fill : s.color);
    let contrast = null;
    if (fg) {
      const bg = bgAt((r.left + r.right) / 2, (r.top + r.bottom) / 2, el);
      const a = lum(fg), b = lum(bg);
      const large = px >= 24 || (px >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
      contrast = { ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, need: large ? 3 : 4.5 };
    }
    items.push({ label: label.replace(/\s+/g, ' ').slice(0, 40), box: rectOf(r), px: Math.round(px * 100) / 100, svg, group: g, contrast });
  };
  for (const t of document.querySelectorAll('svg text')) {
    if (t.closest('defs, clipPath, mask, symbol, marker, pattern') || !t.textContent.trim() || !shown(t)) continue;
    const m = t.getScreenCTM();
    let root = t.ownerSVGElement;
    while (root && root.ownerSVGElement) root = root.ownerSVGElement;
    add(t, t.textContent.trim(), t.getBoundingClientRect(), parseFloat(getComputedStyle(t).fontSize) * (m ? Math.hypot(m.a, m.b) : 1), svgs.indexOf(root), group++);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || !n.textContent.trim() || p.closest('svg, script, style, noscript, template, select, option, textarea, .sr-only') || !shown(p)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const px = parseFloat(getComputedStyle(p).fontSize);
    const g = group++;
    for (const r of range.getClientRects()) add(p, n.textContent.trim(), r, px, -1, g);
  }
  const plots = [];
  for (const g of document.querySelectorAll('[data-scaffold-plot]')) {
    const d = (k) => parseFloat(g.getAttribute('data-' + k));
    const m = g.getScreenCTM();
    if (!m) continue;
    const P = (x, y) => new DOMPoint(x, y).matrixTransform(m);
    const tl = P(d('left'), d('top')), br = P(d('right'), d('bottom'));
    const series = [];
    for (const path of g.querySelectorAll('path[data-series]')) {
      const len = path.getTotalLength();
      const pm = path.getScreenCTM();
      if (!len || !pm) continue;
      const pts = [];
      for (let k = 0; k < opts.samples; k++) {
        const q = path.getPointAtLength(((k + 0.5) / opts.samples) * len).matrixTransform(pm);
        pts.push([
          d('x-min') + ((q.x - tl.x) / (br.x - tl.x)) * (d('x-max') - d('x-min')),
          d('y-min') + ((br.y - q.y) / (br.y - tl.y)) * (d('y-max') - d('y-min')),
        ]);
      }
      series.push({ label: path.getAttribute('data-series'), pts });
    }
    plots.push({ y_range: d('y-max') - d('y-min'), series });
  }
  return {
    items,
    svgBoxes: svgs.map((s) => rectOf(s.getBoundingClientRect())),
    scrollWidth: document.documentElement.scrollWidth,
    width: innerWidth,
    plots,
  };
}`;

type Box = [number, number, number, number];
interface Probe {
  items: {
    label: string;
    box: Box;
    px: number;
    svg: number;
    group: number;
    contrast: { ratio: number; need: number } | null;
  }[];
  svgBoxes: Box[];
  scrollWidth: number;
  width: number;
  plots: { y_range: number; series: { label: string; pts: [number, number][] }[] }[];
}

/** The ink of a text box: font boxes include line gaps, so trim 20 % at the top and 10 % at the bottom. */
const core = ([l, t, r, b]: Box): Box => {
  const h = b - t;
  return [l + 1, t + 0.2 * h, r - 1, b - 0.1 * h];
};

/** Layout problems in one rendering (pure; unit-tested). */
export function layoutProblems(
  p: Probe,
  format: 'svg' | 'html',
  minFont: number,
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const items = p.items.map((i) => ({ ...i, core: core(i.box) }));
  for (const i of items)
    if (i.px < minFont - 0.01) errors.push(`font ${i.px} px is under ${minFont} px: "${i.label}"`);
  for (let a = 0; a < items.length; a++)
    for (let b = a + 1; b < items.length; b++) {
      const A = items[a]!;
      const B = items[b]!;
      if (A.group === B.group) continue;
      const ix = Math.min(A.core[2], B.core[2]) - Math.max(A.core[0], B.core[0]);
      const iy = Math.min(A.core[3], B.core[3]) - Math.max(A.core[1], B.core[1]);
      if (ix > 1 && iy > 1) errors.push(`overlapping text: "${A.label}" and "${B.label}"`);
    }
  for (const i of items) {
    const [l, t, r, b] = i.core;
    if (i.svg >= 0) {
      const [L, T, R, B] = p.svgBoxes[i.svg]!;
      if (l < L - 1 || t < T - 1 || r > R + 1 || b > B + 1)
        errors.push(`text outside the viewBox: "${i.label}"`);
    } else if (l < -1 || r > p.width + 1)
      errors.push(`text outside the ${p.width} px viewport: "${i.label}"`);
    if (i.contrast && i.contrast.ratio < i.contrast.need)
      warnings.push(`contrast ${i.contrast.ratio}:1 is under WCAG AA ${i.contrast.need}:1: "${i.label}"`);
  }
  if (format === 'html' && p.scrollWidth > p.width + 1)
    errors.push(`content is ${p.scrollWidth} px wide, wider than the ${p.width} px viewport`);
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/** V-VIS plot fidelity: rendered points, inverted through the axis mapping, against the spec's equations. */
export function plotFidelity(p: Probe, generator: string | null): RenderCheck['plot'] {
  if (!p.plots.length || !generator) return null;
  let spec: PlotSpec;
  try {
    spec = PlotSpec.parse(JSON.parse(generator));
  } catch {
    return null;
  }
  const series: NonNullable<RenderCheck['plot']>['series'] = [];
  for (const plot of p.plots)
    for (const s of plot.series) {
      const def = spec.series.find((x) => x.label === s.label);
      if (!def?.expr) continue;
      const f = compile(def.expr, spec.x.var, spec.params);
      let max = 0;
      for (const [x, y] of s.pts) {
        const want = f(x);
        if (Number.isFinite(want)) max = Math.max(max, Math.abs(y - want) / plot.y_range);
      }
      series.push({ label: s.label, points: s.pts.length, max_error_pct: Math.round(max * 1e4) / 100 });
    }
  return { ok: series.every((s) => s.max_error_pct <= PLOT_MAX_ERROR_PCT), series };
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function renderMode(
  browser: Browser,
  input: RenderInput,
  mode: 'light' | 'dark',
  timeoutMs: number,
  wantPreview: boolean,
): Promise<{ probe: Probe; errors: string[]; preview: Buffer | null }> {
  const ctx = await browser.newContext({
    viewport: { width: RENDER_WIDTH, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: mode,
  });
  const errors: string[] = [];
  try {
    const doc = harness(input);
    await ctx.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === `${ORIGIN}/index.html`)
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: doc });
      if (url === `${ORIGIN}/favicon.ico`) return route.fulfill({ status: 204, body: '' });
      errors.push(`network request blocked: ${url.slice(0, 80)}`);
      return route.abort('blockedbyclient');
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT/.test(m.text()))
        errors.push(`console error: ${m.text().slice(0, 160)}`);
    });
    page.on('pageerror', (e) => errors.push(`script error: ${e.message.slice(0, 160)}`));
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load', timeout: timeoutMs });
    await withTimeout(page.evaluate('document.fonts.ready.then(() => true)'), timeoutMs, 'font loading');
    await page.waitForTimeout(100);
    const height = await withTimeout(
      // content height (the document is at least as tall as the viewport, so not scrollHeight)
      page.evaluate<number>(
        'Math.ceil(Math.max(document.body.getBoundingClientRect().bottom, ...[...document.body.children].map((e) => e.getBoundingClientRect().bottom)) + 16)',
      ),
      timeoutMs,
      'layout',
    );
    // The whole figure inside the viewport, so hit-testing (contrast) sees every label.
    await page.setViewportSize({
      width: RENDER_WIDTH,
      height: Math.min(Math.max(height, 200), MAX_PREVIEW_HEIGHT),
    });
    const probe = await withTimeout(
      page.evaluate<Probe>(`(${PROBE})(${JSON.stringify({ samples: PLOT_SAMPLES })})`),
      timeoutMs,
      'the layout probe',
    );
    let preview: Buffer | null = null;
    if (wantPreview)
      preview =
        input.format === 'svg'
          ? await page.locator('#scaffold-figure').screenshot({ timeout: timeoutMs })
          : await page.screenshot({ timeout: timeoutMs });
    return { probe, errors, preview };
  } finally {
    await withTimeout(ctx.close(), 10_000, 'closing the page').catch(() => undefined);
  }
}

/** Renders one visual in light and dark mode; never retries (ARC-10). */
export async function renderCheck(
  browser: Browser,
  browserName: string,
  input: RenderInput,
  opts: { preview?: boolean; timeoutMs?: number; now?: Date } = {},
): Promise<RenderOutput> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const byMessage = new Map<string, Set<string>>();
  const warnings = new Set<string>();
  const note = (m: string, mode: string): void => {
    if (!byMessage.has(m)) byMessage.set(m, new Set());
    byMessage.get(m)!.add(mode);
  };
  let preview: Buffer | null = null;
  let plot: RenderCheck['plot'] = null;
  for (const mode of ['light', 'dark'] as const) {
    try {
      const r = await renderMode(browser, input, mode, timeoutMs, mode === 'light' && opts.preview !== false);
      if (mode === 'light') {
        preview = r.preview;
        plot = plotFidelity(r.probe, input.generator);
      }
      const lp = layoutProblems(r.probe, input.format, input.min_font_px);
      for (const e of [...r.errors, ...lp.errors]) note(e, mode);
      for (const w of lp.warnings) warnings.add(mode === 'dark' ? `${w} (dark)` : w);
    } catch (e) {
      note(`render failed: ${(e as Error).message.split('\n')[0]!.slice(0, 200)}`, mode);
    }
  }
  const errors = [...byMessage].map(([m, modes]) => (modes.size === 2 ? m : `${m} (${[...modes][0]} only)`));
  if (input.kind === 'plot' && !input.has_generator)
    errors.push(
      'a plot without generator code: every curve must be computed from its equation or data (VIS-02)',
    );
  if (plot && !plot.ok)
    for (const s of plot.series.filter((x) => x.max_error_pct > PLOT_MAX_ERROR_PCT))
      errors.push(
        `plot "${s.label}" is ${s.max_error_pct} % of the axis range away from its equation (max ${PLOT_MAX_ERROR_PCT} %)`,
      );
  if (input.kind === 'plot' && input.has_generator && !plot)
    warnings.add('plot fidelity not verified: the generator is not a Scaffold plot spec');
  return {
    result: {
      ok: errors.length === 0,
      errors: errors.slice(0, 20),
      warnings: [...warnings].slice(0, 20),
      modes: ['light', 'dark'],
      plot,
      checked_at: (opts.now ?? new Date()).toISOString(),
      source_sha256: input.sha256,
      browser: browserName,
    },
    preview,
  };
}
