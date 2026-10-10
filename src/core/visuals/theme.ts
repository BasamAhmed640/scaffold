// VIS-04 theme shim: every CSS variable and class used by Claude's inline visualizer, with light
// and dark values, so a widget authored in Claude Desktop renders the same way from the vault.
// Built from the visualizer's documented design system (variables, `.t/.ts/.th/.box/.node/.arr/
// .leader`, nine `c-<ramp>` ramps with 7 stops each). Unknown variables fall back to readable
// defaults because every `var()` in the shim carries one. `visual-kit/theme.css` is generated
// from this file (`npm run build:theme`, checked by tests).

export const RAMPS = {
  purple: ['#EEEDFE', '#CECBF6', '#AFA9EC', '#7F77DD', '#534AB7', '#3C3489', '#26215C'],
  teal: ['#E1F5EE', '#9FE1CB', '#5DCAA5', '#1D9E75', '#0F6E56', '#085041', '#04342C'],
  coral: ['#FAECE7', '#F5C4B3', '#F0997B', '#D85A30', '#993C1D', '#712B13', '#4A1B0C'],
  pink: ['#FBEAF0', '#F4C0D1', '#ED93B1', '#D4537E', '#993556', '#72243E', '#4B1528'],
  gray: ['#F1EFE8', '#D3D1C7', '#B4B2A9', '#888780', '#5F5E5A', '#444441', '#2C2C2A'],
  blue: ['#E6F1FB', '#B5D4F4', '#85B7EB', '#378ADD', '#185FA5', '#0C447C', '#042C53'],
  green: ['#EAF3DE', '#C0DD97', '#97C459', '#639922', '#3B6D11', '#27500A', '#173404'],
  amber: ['#FAEEDA', '#FAC775', '#EF9F27', '#BA7517', '#854F0B', '#633806', '#412402'],
  red: ['#FCEBEB', '#F7C1C1', '#F09595', '#E24B4A', '#A32D2D', '#791F1F', '#501313'],
} as const;
export type Ramp = keyof typeof RAMPS;
/** Stop names in RAMPS order. */
export const STOPS = [50, 100, 200, 400, 600, 800, 900] as const;
const stop = (r: Ramp, s: (typeof STOPS)[number]): string => RAMPS[r][STOPS.indexOf(s)]!;

/** Role tokens: [ramp, light text/bg/border stops, dark stops]. */
const ROLES: Record<string, Ramp> = { accent: 'blue', danger: 'red', success: 'green', warning: 'amber' };

const LIGHT: Record<string, string> = {
  '--surface-0': '#f5f4ef',
  '--surface-1': '#fcfcfb',
  '--surface-2': '#ffffff',
  '--surface-3': '#ffffff',
  '--text-primary': '#0b0b0b',
  '--text-secondary': '#52514e',
  '--text-muted': '#898781',
  '--text-disabled': 'rgba(11, 11, 11, 0.3)',
  '--border': 'rgba(11, 11, 11, 0.10)',
  '--border-strong': 'rgba(11, 11, 11, 0.20)',
  '--border-stronger': 'rgba(11, 11, 11, 0.40)',
  '--gridline': '#e1e0d9',
  '--baseline': '#c3c2b7',
};
const DARK: Record<string, string> = {
  '--surface-0': '#0b0b0b',
  '--surface-1': '#1a1a19',
  '--surface-2': '#1f1f1e',
  '--surface-3': '#262624',
  '--text-primary': '#f0efec',
  '--text-secondary': '#c3c2b7',
  '--text-muted': '#898781',
  '--text-disabled': 'rgba(255, 255, 255, 0.3)',
  '--border': 'rgba(255, 255, 255, 0.10)',
  '--border-strong': 'rgba(255, 255, 255, 0.20)',
  '--border-stronger': 'rgba(255, 255, 255, 0.40)',
  '--gridline': '#2c2c2a',
  '--baseline': '#383835',
};
for (const [role, ramp] of Object.entries(ROLES)) {
  LIGHT[`--text-${role}`] = stop(ramp, 600);
  LIGHT[`--bg-${role}`] = stop(ramp, 50);
  LIGHT[`--border-${role}`] = stop(ramp, 200);
  DARK[`--text-${role}`] = stop(ramp, 200);
  DARK[`--bg-${role}`] = stop(ramp, 800);
  DARK[`--border-${role}`] = stop(ramp, 600);
}

/** Mode-independent tokens, including the visualizer's short aliases. */
const COMMON: Record<string, string> = {
  '--font-sans': '"Anthropic Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
  '--font-voice': '"Anthropic Serif", Georgia, "Times New Roman", serif',
  '--font-mono': '"JetBrains Mono", Consolas, "Courier New", monospace',
  '--radius': '8px',
  '--pad-sm': '4px',
  '--pad-md': '8px',
  '--pad-lg': '12px',
  '--pad-xl': '16px',
  '--gap-xs': '4px',
  '--gap-sm': '8px',
  '--gap-md': '12px',
  '--gap-lg': '16px',
  '--gap-xl': '24px',
  '--p': 'var(--text-primary)',
  '--s': 'var(--text-secondary)',
  '--t': 'var(--text-muted)',
  '--bg2': 'var(--surface-1)',
  '--b': 'var(--border)',
};

const block = (sel: string, vars: Record<string, string>): string =>
  `${sel} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`;

/** Ramp rules for one mode, every selector under `pre` (a root scope such as `:root[data-mode="dark"] `). */
function rampRules(dark: boolean, pre = ''): string[] {
  const out: string[] = [];
  for (const ramp of Object.keys(RAMPS) as Ramp[]) {
    const fill = stop(ramp, dark ? 800 : 50);
    const stroke = stop(ramp, dark ? 200 : 600);
    const title = stop(ramp, dark ? 100 : 800);
    const sub = stop(ramp, dark ? 200 : 600);
    const c = `${pre}.c-${ramp}`;
    out.push(
      `${c} > rect, ${c} > circle, ${c} > ellipse, ${c} > polygon, ${pre}rect.c-${ramp}, ${pre}circle.c-${ramp}, ${pre}ellipse.c-${ramp} { fill: ${fill}; stroke: ${stroke}; }`,
      `${c} > .t, ${c} > .th { fill: ${title}; }`,
      `${c} > .ts { fill: ${sub}; }`,
    );
  }
  return out;
}

/** Element and class rules shared by both modes (they read the variables). */
const BASE = [
  'svg { overflow: visible; }',
  '.t, .ts, .th { font-family: var(--font-sans, system-ui, sans-serif); }',
  '.t { font-size: 14px; font-weight: 400; fill: var(--text-primary, #0b0b0b); }',
  '.ts { font-size: 12px; font-weight: 400; fill: var(--text-secondary, #52514e); }',
  '.th { font-size: 14px; font-weight: 500; fill: var(--text-primary, #0b0b0b); }',
  '.box { fill: var(--surface-1, #fcfcfb); stroke: var(--border-strong, rgba(11, 11, 11, 0.2)); }',
  '.node { cursor: pointer; }',
  '.node:hover { opacity: 0.85; }',
  '.arr { stroke: var(--text-secondary, #52514e); stroke-width: 1.5; fill: none; }',
  '.leader { stroke: var(--text-muted, #898781); stroke-width: 0.5; stroke-dasharray: 3 3; fill: none; }',
  '.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }',
];

/** HTML document rules (widgets): body, headings and the pre-styled form controls. */
const HTML = [
  'html { background: var(--surface-0, #f5f4ef); color: var(--text-primary, #0b0b0b); }',
  'body { margin: 0 auto; padding: 16px; max-width: 712px; font-family: var(--font-sans, system-ui, sans-serif); font-size: 16px; line-height: 1.7; color: var(--text-primary, #0b0b0b); }',
  'h1 { font-size: 22px; font-weight: 500; } h2 { font-size: 18px; font-weight: 500; } h3 { font-size: 16px; font-weight: 500; }',
  'a { color: var(--text-accent, #185FA5); }',
  'button { font: inherit; font-size: 14px; color: var(--text-primary, #0b0b0b); background: transparent; border: 0.5px solid var(--border-strong, rgba(11, 11, 11, 0.2)); border-radius: var(--radius, 8px); padding: 6px 12px; cursor: pointer; }',
  'button:hover { background: var(--surface-1, #fcfcfb); } button:active { transform: scale(0.98); }',
  'input[type="text"], input[type="number"], select, textarea { font: inherit; font-size: 14px; color: var(--text-primary, #0b0b0b); background: var(--surface-2, #fff); border: 0.5px solid var(--border-strong, rgba(11, 11, 11, 0.2)); border-radius: var(--radius, 8px); padding: 6px 10px; }',
  'input[type="text"], input[type="number"], select { height: 36px; box-sizing: border-box; }',
  'input[type="range"] { accent-color: var(--text-accent, #185FA5); }',
];

/** The shim CSS. `scope: "svg"` omits document rules (for a <style> inside a standalone SVG). */
export function themeCss(scope: 'html' | 'svg' = 'html'): string {
  const parts = [
    '/* Scaffold visual-kit theme shim (VIS-04). Generated from src/core/visuals/theme.ts; do not edit. */',
    block(':root', { ...COMMON, ...LIGHT }),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-mode="light"])', DARK).replace(/^/gm, '  ')}\n}`,
    block(':root[data-mode="dark"]', DARK),
    ...BASE,
    ...rampRules(false),
    `@media (prefers-color-scheme: dark) {\n${rampRules(true, ':root:not([data-mode="light"]) ')
      .map((r) => `  ${r}`)
      .join('\n')}\n}`,
    ...rampRules(true, ':root[data-mode="dark"] '),
    ...(scope === 'html' ? HTML : []),
  ];
  return `${parts.join('\n')}\n`;
}

/** Variables a widget may reference; anything else gets a fallback through `var(--x, …)` in the shim's rules. */
export const SHIM_VARIABLES = Object.keys({ ...COMMON, ...LIGHT });
export const SHIM_CLASSES = [
  't',
  'ts',
  'th',
  'box',
  'node',
  'arr',
  'leader',
  'sr-only',
  ...Object.keys(RAMPS).map((r) => `c-${r}`),
];
