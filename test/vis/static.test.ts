import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  networkRefs,
  parseMarkup,
  prepareHtml,
  prepareSvg,
  staticChecks,
  stripShim,
  type StaticInput,
} from '../../src/core/visuals/markup.js';
import { compile, niceTicks, parseExpr, plotSvg } from '../../src/core/visuals/plot.js';
import { RAMPS, SHIM_CLASSES, SHIM_VARIABLES, themeCss } from '../../src/core/visuals/theme.js';

// V-VIS (static half): the theme shim (VIS-04), the MCP server's fast checks (VIS-05) and the
// computed-plot template (VIS-02). The render half is test/vis/render.test.ts.

const fx = (name: string): string => readFileSync(`test/fixtures/visuals/${name}`, 'utf8');
const kit = (name: string): string => readFileSync(`visual-kit/templates/${name}`, 'utf8');
const check = (source: string, more: Partial<StaticInput> = {}) =>
  staticChecks({
    source,
    format: 'svg',
    kind: 'diagram',
    has_generator: false,
    max_bytes: 600_000,
    min_font_px: 11,
    ...more,
  });

describe('VIS-04 theme shim', () => {
  it('visual-kit/theme.css is generated from theme.ts and current', () => {
    expect(readFileSync('visual-kit/theme.css', 'utf8')).toBe(themeCss('html'));
  });

  it('defines the visualizer variables and classes in light and dark, with readable fallbacks', () => {
    const css = themeCss('html');
    for (const v of [
      '--text-primary',
      '--text-secondary',
      '--text-muted',
      '--border',
      '--surface-1',
      '--p',
      '--s',
      '--t',
      '--bg2',
      '--b',
    ])
      expect(SHIM_VARIABLES, v).toContain(v);
    for (const c of ['t', 'ts', 'th', 'box', 'arr', 'leader', 'sr-only', 'c-blue', 'c-coral', 'c-teal'])
      expect(SHIM_CLASSES, c).toContain(c);
    expect(Object.keys(RAMPS)).toHaveLength(9);
    // dark values by media query and by an explicit data-mode, light forced by data-mode="light"
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-mode="light"])');
    expect(css).toContain(':root[data-mode="dark"]');
    // every var() in a rule carries a fallback
    const rules = css.split('\n').filter((l) => /^[.a-z]/.test(l) && l.includes('var('));
    for (const r of rules)
      for (const m of r.matchAll(/var\((--[\w-]+)([,)])/g)) expect(m[2], `${m[1]} in ${r}`).toBe(',');
    // the SVG scope has no document rules
    expect(themeCss('svg')).not.toContain('body {');
  });
});

describe('VIS-05 fast static checks', () => {
  it('clean templates pass', () => {
    expect(check(kit('diagram.svg'))).toMatchObject({ ok: true, errors: [], uses_shim: true });
    expect(check(kit('stepper.html'), { format: 'html', kind: 'stepper' })).toMatchObject({
      ok: true,
      errors: [],
    });
  });

  it('well-formed XML: unclosed tags, mismatched ends, unquoted attributes, two roots', () => {
    const bad = [
      '<svg viewBox="0 0 10 10"><title>x</title><g></svg>',
      '<svg viewBox="0 0 10 10"><title>x</title></g></svg>',
      '<svg viewBox=0><title>x</title></svg>',
      '<svg><title>x</title></svg><svg/>',
      '<svg><title>x</title><text>a < b</text></svg>',
    ];
    for (const s of bad) {
      const r = check(s);
      expect(r.ok, s).toBe(false);
      expect(r.fatal.length, s).toBeGreaterThan(0);
      expect(r.errors.join(' '), s).toMatch(/not well-formed/);
    }
    // HTML tolerates void elements and optional end tags
    expect(parseMarkup('<p>one<p>two<br><input type="range"><ul><li>a<li>b</ul>', 'html').errors).toEqual([]);
  });

  it('title/desc or aria-label (missing title is an error, missing desc a warning)', () => {
    expect(check(fx('adv-no-title.svg')).errors).toContain(
      'missing <title> (or aria-label) on the root <svg>',
    );
    expect(check('<svg viewBox="0 0 1 1" aria-label="a dot"><circle r="1"/></svg>').ok).toBe(true);
    expect(check('<svg viewBox="0 0 1 1"><title>t</title></svg>').warnings).toContain(
      'no <desc> on the root <svg>',
    );
    expect(check('<p>no title</p>', { format: 'html' }).errors[0]).toMatch(/missing <title>/);
    expect(check('<p class="sr-only">summary</p>', { format: 'html' }).ok).toBe(true);
  });

  it('size limit', () => {
    const r = check(kit('diagram.svg'), { max_bytes: 1000 });
    expect(r.fatal[0]).toMatch(/over the 1 kB limit/);
  });

  it('no external network references (IF-04): attributes, CSS url(), @import, script fetch/import', () => {
    expect(check(fx('adv-network.svg')).fatal[0]).toMatch(/external network references.*example\.com/);
    const html = [
      '<title>t</title><link rel="stylesheet" href="https://cdn.example.com/x.css">',
      '<title>t</title><style>@import url("https://fonts.example.com/a.css");</style>',
      '<title>t</title><div style="background: url(//example.com/bg.png)"></div>',
      '<title>t</title><script>fetch("https://api.example.com/data")</script>',
      '<title>t</title><script type="module">import x from "https://esm.example.com/x.js";</script>',
      '<title>t</title><img srcset="https://example.com/a.png 2x">',
    ];
    for (const h of html) expect(networkRefs(parseMarkup(h, 'html')).length, h).toBeGreaterThan(0);
    // data: URIs and fragments are self-contained
    expect(
      check(
        '<svg viewBox="0 0 1 1"><title>t</title><use href="#a"/><image href="data:image/png;base64,AA=="/></svg>',
      ).ok,
    ).toBe(true);
  });

  it('explicit fonts under 11 px', () => {
    expect(check(fx('adv-font-9px.svg')).errors).toContain('<text>: font-size 9px (minimum 11px)');
    expect(
      check('<svg viewBox="0 0 1 1"><title>t</title><style>.x { font-size: 10px }</style></svg>').ok,
    ).toBe(false);
  });

  it('a plot without a generator fails (VIS-02)', () => {
    const r = check(fx('adv-hand-plot.svg'), { kind: 'plot' });
    expect(r.errors.join(' ')).toMatch(/a plot needs its generator code/);
    expect(r.fatal).toEqual([]); // not fatal: kept with warnings after the fix attempt
    expect(check(fx('adv-hand-plot.svg'), { kind: 'plot', has_generator: true }).ok).toBe(true);
  });

  it('prepareSvg adds the namespace and the shim after <title>/<desc>; stripShim removes it', () => {
    const src = '<svg viewBox="0 0 10 10"><title>t</title><desc>d</desc><text class="t">x</text></svg>';
    const out = prepareSvg(src, true);
    expect(out).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(out.indexOf('<style id="scaffold-theme-shim">')).toBeGreaterThan(out.indexOf('</desc>'));
    expect(check(out).ok).toBe(true);
    expect(prepareSvg(out, true)).toBe(out); // idempotent
    expect(stripShim(out).trim()).toBe(src.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
  });

  it('prepareHtml wraps a fragment in a self-contained page with the shim', () => {
    const out = prepareHtml(kit('stepper.html'), 'Stepper');
    expect(out).toMatch(/^<!doctype html>/);
    expect(out).toContain('<title>Stepper</title>');
    expect(out).toContain('<style id="scaffold-theme-shim">');
    expect(check(out, { format: 'html' }).ok).toBe(true);
  });
});

describe('VIS-02 computed plots', () => {
  it('the expression evaluator is safe: no globals, properties or unknown functions', () => {
    expect(compile('1 - exp(-t / tau)', 't', { tau: 2 })(2)).toBeCloseTo(1 - Math.exp(-1), 12);
    expect(compile('2^3^2', 'x')(0)).toBe(512); // right-associative
    expect(compile('-x^2', 'x')(3)).toBe(-9);
    expect(compile('max(x, 1) + pi', 'x')(0)).toBeCloseTo(1 + Math.PI, 12);
    for (const bad of [
      'constructor',
      'process.exit(1)',
      'this',
      'eval("1")',
      'x[0]',
      'require("fs")',
      '1 +',
      '(1',
    ])
      expect(() => compile(bad, 'x')(1), bad).toThrow(/Expression|Unknown variable/);
    expect(() => parseExpr('alert(1)')).toThrow(/unknown function alert/);
  });

  it('nice ticks', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 1.2).map((v) => +v.toFixed(6))).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1, 1.2]);
    expect(niceTicks(-1, 1).map((v) => +v.toFixed(6))).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it('the template writes axis metadata, units, direct labels and its generator, and passes the static checks', () => {
    const spec = JSON.parse(kit('plot.json')) as Record<string, unknown>;
    const p = plotSvg(spec);
    expect(p.svg).toContain('data-scaffold-plot="1"');
    expect(p.svg).toContain('data-x-min="0" data-x-max="10" data-y-min="0" data-y-max="1.2"');
    expect(p.svg).toContain('time (ns)');
    expect(p.svg).toContain('voltage (V)');
    expect(p.svg).toContain('data-expr="1 - exp(-t / tau)"');
    expect(JSON.parse(p.generator)).toMatchObject({ params: { tau: 2 } });
    expect(check(p.svg, { kind: 'plot', has_generator: true })).toMatchObject({ ok: true, warnings: [] });
    // the curve passes through the analytic points (before rendering; the render test inverts pixels)
    const pts = [...p.svg.matchAll(/data-series="v\(t\)[^"]*"/g)];
    expect(pts).toHaveLength(1);
  });

  it('rejects a spec without units fields, an inverted axis, or a series with neither expr nor points', () => {
    const spec = JSON.parse(kit('plot.json')) as { x: { min: number; max: number }; series: unknown[] };
    expect(() => plotSvg({ ...spec, x: { ...spec.x, min: 5, max: 1 } })).toThrow();
    expect(() => plotSvg({ ...spec, series: [{ label: 'empty' }] })).toThrow();
  });
});
