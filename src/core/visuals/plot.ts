import { z } from 'zod';
import { ScaffoldError } from '../envelope.js';
import { RAMPS, type Ramp } from './theme.js';

// Computed plots (VIS-02): every curve is computed from its equation or data. A plot spec (JSON) is
// the generator: `plotSvg(spec)` samples each expression with a safe evaluator (no eval), draws it
// in the visualizer's style, and writes the axis mapping as data attributes so a checker can invert
// the rendered geometry and compare it with the function (V-VIS).

// ---- expressions ---------------------------------------------------------------------------------

type Ast =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'neg'; a: Ast }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Ast; b: Ast }
  | { k: 'call'; fn: string; args: Ast[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function parseExpr(src: string): Ast {
  const toks = src.match(/\d*\.?\d+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|\S/g) ?? [];
  let p = 0;
  const fail = (msg: string): never => {
    throw new ScaffoldError(
      'bad_expression',
      `Expression "${src}": ${msg}.`,
      'Use numbers, the variables, + - * / ^ and functions like exp, sin, sqrt.',
    );
  };
  const expect = (t: string): void => {
    if (toks[p] !== t) fail(`expected "${t}" at token ${p + 1}`);
    p++;
  };
  function expr(): Ast {
    let a = term();
    while (toks[p] === '+' || toks[p] === '-') {
      const op = toks[p++] as '+' | '-';
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): Ast {
    let a = unary();
    while (toks[p] === '*' || toks[p] === '/') {
      const op = toks[p++] as '*' | '/';
      a = { k: 'bin', op, a, b: unary() };
    }
    return a;
  }
  function unary(): Ast {
    if (toks[p] === '-') {
      p++;
      return { k: 'neg', a: unary() };
    }
    if (toks[p] === '+') {
      p++;
      return unary();
    }
    return power();
  }
  function power(): Ast {
    const base = primary();
    if (toks[p] === '^') {
      p++;
      return { k: 'bin', op: '^', a: base, b: unary() }; // right-associative
    }
    return base;
  }
  function primary(): Ast {
    const t = toks[p];
    if (t === undefined) return fail('unexpected end');
    if (/^\d*\.?\d/.test(t)) {
      p++;
      return { k: 'num', v: Number(t) };
    }
    if (t === '(') {
      p++;
      const a = expr();
      expect(')');
      return a;
    }
    if (/^[A-Za-z_]/.test(t)) {
      p++;
      if (toks[p] === '(') {
        p++;
        if (!Object.hasOwn(FUNCS, t)) fail(`unknown function ${t}`);
        const args: Ast[] = [];
        if (toks[p] !== ')') {
          args.push(expr());
          while (toks[p] === ',') {
            p++;
            args.push(expr());
          }
        }
        expect(')');
        return { k: 'call', fn: t, args };
      }
      return { k: 'var', name: t };
    }
    return fail(`unexpected "${t}"`);
  }
  const ast = expr();
  if (p !== toks.length) fail(`unexpected "${toks[p]}"`);
  return ast;
}

export function evalExpr(ast: Ast, vars: Record<string, number>): number {
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'var': {
      // own properties only: names like "constructor" must not reach Object.prototype
      const v = Object.hasOwn(vars, ast.name)
        ? vars[ast.name]
        : Object.hasOwn(CONSTS, ast.name)
          ? CONSTS[ast.name]
          : undefined;
      if (v === undefined)
        throw new ScaffoldError('bad_expression', `Unknown variable "${ast.name}".`, 'Define it in params.');
      return v;
    }
    case 'neg':
      return -evalExpr(ast.a, vars);
    case 'bin': {
      const a = evalExpr(ast.a, vars);
      const b = evalExpr(ast.b, vars);
      return ast.op === '+'
        ? a + b
        : ast.op === '-'
          ? a - b
          : ast.op === '*'
            ? a * b
            : ast.op === '/'
              ? a / b
              : a ** b;
    }
    case 'call':
      return FUNCS[ast.fn]!(...ast.args.map((x) => evalExpr(x, vars)));
  }
}

/** f(x) for an expression in the variable `name` with constant params. */
export function compile(
  src: string,
  name: string,
  params: Record<string, number> = {},
): (x: number) => number {
  const ast = parseExpr(src);
  return (x) => evalExpr(ast, { ...params, [name]: x });
}

// ---- plot spec -----------------------------------------------------------------------------------

const Axis = z.object({
  label: z.string().min(1).max(60),
  unit: z.string().max(20),
  min: z.number(),
  max: z.number(),
  ticks: z.array(z.number()).max(12).optional(),
});

export const PlotSpec = z
  .object({
    title: z.string().min(3).max(120),
    desc: z.string().min(3).max(500),
    x: Axis.extend({
      var: z
        .string()
        .regex(/^[A-Za-z_]\w*$/)
        .default('x'),
    }),
    y: Axis,
    params: z.record(z.string(), z.number()).default({}),
    series: z
      .array(
        z.object({
          label: z.string().min(1).max(30),
          expr: z.string().max(400).optional(),
          points: z
            .array(z.tuple([z.number(), z.number()]))
            .max(5000)
            .optional(),
          ramp: z.enum(Object.keys(RAMPS) as [Ramp, ...Ramp[]]).optional(),
          dash: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(6),
    samples: z.number().int().min(10).max(2000).default(240),
    height: z.number().int().min(200).max(800).default(380),
  })
  .refine((s) => s.x.max > s.x.min && s.y.max > s.y.min, 'axis max must be greater than min')
  .refine((s) => s.series.every((x) => !!x.expr !== !!x.points), 'each series has either expr or points');
export type PlotSpec = z.infer<typeof PlotSpec>;

/** Nice tick values (1, 2, 5 × 10^n), about `n` of them, inside [min, max]. */
export function niceTicks(min: number, max: number, n = 5): number[] {
  const raw = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => (max - min) / s <= n * 1.5) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step)
    out.push(Math.round(v / step) * step);
  return out;
}

const fmt = (v: number): string => {
  const r = Math.abs(v) < 1e-12 ? 0 : v;
  return Math.abs(r) >= 1e4 || (Math.abs(r) < 1e-3 && r !== 0)
    ? r.toExponential(1)
    : String(Number(r.toPrecision(4)));
};
const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const DEFAULT_RAMPS: Ramp[] = ['blue', 'coral', 'teal', 'purple', 'amber', 'pink'];

export interface PlotGeometry {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function plotSvg(raw: unknown): { svg: string; geometry: PlotGeometry; generator: string } {
  const spec = PlotSpec.parse(raw);
  const W = 680;
  const H = spec.height;
  // Direct labels sit right of the plot (spatial contiguity, no legend); the gutter fits the longest
  // one at ~7.2 px per character of 12 px text, within 40–240 px.
  const longest = Math.max(...spec.series.map((s) => [...s.label].length));
  const gutter = Math.min(240, Math.max(40, Math.ceil(longest * 7.2) + 24));
  const g: PlotGeometry = { left: 72, right: W - gutter, top: 48, bottom: H - 64 };
  const sx = (x: number): number =>
    g.left + ((x - spec.x.min) / (spec.x.max - spec.x.min)) * (g.right - g.left);
  const sy = (y: number): number =>
    g.bottom - ((y - spec.y.min) / (spec.y.max - spec.y.min)) * (g.bottom - g.top);
  const r2 = (v: number): string => String(Math.round(v * 100) / 100);
  const xt = spec.x.ticks ?? niceTicks(spec.x.min, spec.x.max);
  const yt = spec.y.ticks ?? niceTicks(spec.y.min, spec.y.max);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 ${W} ${H}" role="img">`,
    `<title>${esc(spec.title)}</title>`,
    `<desc>${esc(spec.desc)}</desc>`,
    `<defs><clipPath id="plot-area"><rect x="${g.left}" y="${g.top}" width="${g.right - g.left}" height="${g.bottom - g.top}"/></clipPath></defs>`,
  );
  // gridlines and ticks
  for (const v of yt) {
    const y = r2(sy(v));
    parts.push(
      `<line x1="${g.left}" y1="${y}" x2="${g.right}" y2="${y}" style="stroke: var(--gridline, #e1e0d9)" stroke-width="1"/>`,
      `<text class="ts" x="${g.left - 8}" y="${y}" text-anchor="end" dominant-baseline="central">${esc(fmt(v))}</text>`,
    );
  }
  for (const v of xt) {
    const x = r2(sx(v));
    parts.push(
      `<line x1="${x}" y1="${g.bottom}" x2="${x}" y2="${g.bottom + 4}" style="stroke: var(--baseline, #c3c2b7)" stroke-width="1"/>`,
      `<text class="ts" x="${x}" y="${g.bottom + 18}" text-anchor="middle" dominant-baseline="central">${esc(fmt(v))}</text>`,
    );
  }
  parts.push(
    `<line x1="${g.left}" y1="${g.bottom}" x2="${g.right}" y2="${g.bottom}" style="stroke: var(--baseline, #c3c2b7)" stroke-width="1"/>`,
    `<line x1="${g.left}" y1="${g.top}" x2="${g.left}" y2="${g.bottom}" style="stroke: var(--baseline, #c3c2b7)" stroke-width="1"/>`,
    `<text class="ts" x="${(g.left + g.right) / 2}" y="${g.bottom + 44}" text-anchor="middle" dominant-baseline="central">${esc(spec.x.label)}${spec.x.unit ? ` (${esc(spec.x.unit)})` : ''}</text>`,
    `<text class="ts" x="${g.left}" y="${g.top - 22}" text-anchor="start" dominant-baseline="central">${esc(spec.y.label)}${spec.y.unit ? ` (${esc(spec.y.unit)})` : ''}</text>`,
  );
  const meta = `data-scaffold-plot="1" data-x-min="${spec.x.min}" data-x-max="${spec.x.max}" data-y-min="${spec.y.min}" data-y-max="${spec.y.max}" data-left="${g.left}" data-right="${g.right}" data-top="${g.top}" data-bottom="${g.bottom}"`;
  parts.push(`<g ${meta} clip-path="url(#plot-area)">`);
  const ends: { label: string; x: number; y: number; color: string }[] = [];
  spec.series.forEach((s, i) => {
    const color = RAMPS[s.ramp ?? DEFAULT_RAMPS[i % DEFAULT_RAMPS.length]!][3]!; // the 400 stop reads in both modes
    let pts: [number, number][];
    if (s.expr) {
      const f = compile(s.expr, spec.x.var, spec.params);
      pts = Array.from({ length: spec.samples + 1 }, (_, k) => {
        const x = spec.x.min + ((spec.x.max - spec.x.min) * k) / spec.samples;
        return [x, f(x)] as [number, number];
      });
    } else pts = s.points!;
    const segs: string[] = [];
    let pen = false;
    for (const [x, y] of pts) {
      if (!Number.isFinite(y)) {
        pen = false;
        continue;
      }
      segs.push(`${pen ? 'L' : 'M'}${r2(sx(x))} ${r2(sy(y))}`);
      pen = true;
    }
    const exprAttr = s.expr ? ` data-expr="${esc(s.expr)}"` : '';
    parts.push(
      `<path d="${segs.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ' stroke-dasharray="6 4"' : ''} data-series="${esc(s.label)}"${exprAttr}/>`,
    );
    const last = [...pts].reverse().find(([, y]) => Number.isFinite(y) && y >= spec.y.min && y <= spec.y.max);
    if (last) ends.push({ label: s.label, x: sx(last[0]), y: sy(last[1]), color });
  });
  parts.push('</g>');
  // direct labels at the right of each curve's last visible point, nudged apart to avoid overlaps
  ends.sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++)
    if (ends[k]!.y - ends[k - 1]!.y < 16) ends[k]!.y = ends[k - 1]!.y + 16;
  for (const e of ends) {
    parts.push(
      `<line x1="${r2(e.x + 4)}" y1="${r2(e.y)}" x2="${g.right + 6}" y2="${r2(e.y)}" class="leader"/>`,
      `<text class="ts" x="${g.right + 10}" y="${r2(e.y)}" dominant-baseline="central">${esc(e.label)}</text>`,
    );
  }
  parts.push('</svg>');
  return {
    svg: `${parts.join('\n')}\n`,
    geometry: g,
    generator: JSON.stringify(PlotSpec.parse(raw), null, 2),
  };
}
