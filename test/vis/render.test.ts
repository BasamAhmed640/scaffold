import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Warnings } from '../../src/core/envelope.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import { launchBrowser } from '../../src/render/check.js';
import { FIXTURE_NOW, standardFixture } from '../fixtures/standard.js';
import { cli } from '../helpers/cli.js';
import { cleanupAll, tempDir, vaultFromEvents } from '../helpers/vault.js';

// V-VIS (render half, VIS-05) through the real CLI: adversarial fixtures are all caught, clean
// fixtures pass in light and dark, and a computed plot's rendered points match its equation
// (50 points, max error ≤ 1 % of the axis range). Needs Chromium or Edge; CI sets
// SCAFFOLD_REQUIRE_RENDER=1 so a missing browser fails instead of skipping.

async function browserAvailable(): Promise<boolean> {
  try {
    const { browser } = await launchBrowser();
    await browser.close();
    return true;
  } catch (e) {
    if (process.env.SCAFFOLD_REQUIRE_RENDER === '1') throw e;
    return false;
  }
}
const available = await browserAvailable();
let work = '';

beforeAll(() => {
  work = tempDir('scaffold-vis-');
  for (const f of readdirSync('test/fixtures/visuals'))
    copyFileSync(`test/fixtures/visuals/${f}`, path.join(work, f));
  for (const f of readdirSync('visual-kit/templates'))
    copyFileSync(`visual-kit/templates/${f}`, path.join(work, f));
});
afterAll(() => cleanupAll());

interface Row {
  visual_id: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  plot: { ok: boolean; series: { label: string; points: number; max_error_pct: number }[] } | null;
  preview: string | null;
}

async function checkFiles(files: string[], extra: string[] = []): Promise<Record<string, Row>> {
  const args = ['visual', 'check', ...files.flatMap((f) => ['--file', path.join(work, f)]), ...extra];
  const r = await cli(work, args);
  expect(r.json, r.out + r.err).not.toBeNull();
  const rows = (r.json!.data as { results: Row[] }).results;
  expect(r.code).toBe(rows.every((x) => x.ok) ? 0 : 1);
  return Object.fromEntries(rows.map((x) => [path.basename(x.visual_id), x]));
}

describe.skipIf(!available)('V-VIS render check', () => {
  it('adversarial fixtures are all caught: overlap, overflow, console error, missing title, 9 px font, network', async () => {
    const r = await checkFiles(
      [
        'adv-overlap.svg',
        'adv-overflow.svg',
        'adv-console-error.html',
        'adv-no-title.svg',
        'adv-font-9px.svg',
        'adv-font-scaled.svg',
        'adv-network.svg',
        'adv-dark-only.svg',
      ],
      ['--no-preview'],
    );
    const errs = (f: string): string => r[f]!.errors.join(' | ');
    for (const row of Object.values(r)) expect(row.ok, row.visual_id).toBe(false);
    expect(errs('adv-overlap.svg')).toMatch(/overlapping text: "incident wave" and "reflected wave"/);
    expect(errs('adv-overflow.svg')).toMatch(
      /text outside the viewBox: "a label that runs far past the edge"/,
    );
    expect(errs('adv-console-error.html')).toMatch(/console error: widget failed to initialise/);
    expect(errs('adv-console-error.html')).toMatch(/script error: .*addEventListener/);
    expect(errs('adv-no-title.svg')).toMatch(/missing <title>/);
    expect(errs('adv-font-9px.svg')).toMatch(/font 9 px is under 11 px/);
    // only the render check sees the effective size of a scaled viewBox
    expect(errs('adv-font-scaled.svg')).toMatch(/font 8\.65 px is under 11 px: "scaled-down label"/);
    expect(errs('adv-network.svg')).toMatch(/network request blocked: https:\/\/example\.com\/logo\.png/);
    // both modes are rendered: this collision exists only in dark mode
    expect(errs('adv-dark-only.svg')).toMatch(
      /overlapping text: "driver output" and "load input" \(dark only\)/,
    );
  }, 120_000);

  it('a hand-drawn "plot" with no generator fails', async () => {
    const r = await checkFiles(['adv-hand-plot.svg'], ['--kind', 'plot', '--no-preview']);
    expect(r['adv-hand-plot.svg']!.ok).toBe(false);
    expect(r['adv-hand-plot.svg']!.errors.join(' ')).toMatch(/a plot without generator code/);
  }, 60_000);

  it('clean fixtures pass in light and dark mode, with previews; low contrast is a warning', async () => {
    const r = await checkFiles(['diagram.svg', 'stepper.html', 'adv-contrast.svg']);
    for (const f of ['diagram.svg', 'stepper.html']) {
      expect(r[f], f).toMatchObject({ ok: true, errors: [], warnings: [] });
      expect(existsSync(r[f]!.preview!), f).toBe(true);
      expect(readFileSync(r[f]!.preview!).subarray(1, 4).toString()).toBe('PNG');
    }
    expect(r['adv-contrast.svg']!.ok).toBe(true);
    expect(r['adv-contrast.svg']!.warnings.join(' ')).toMatch(/contrast 1\.\d+:1 is under WCAG AA 4\.5:1/);
  }, 120_000);

  it('computed plot: 50 rendered points inverted through the axis mapping are within 1 % of the equation', async () => {
    const plot = await cli(work, [
      'visual',
      'plot',
      path.join(work, 'plot.json'),
      '--out',
      path.join(work, 'plot.svg'),
    ]);
    expect(plot.code).toBe(0);
    const good = await checkFiles(
      ['plot.svg'],
      ['--kind', 'plot', '--generator', path.join(work, 'plot.json'), '--no-preview'],
    );
    const p = good['plot.svg']!;
    expect(p.ok).toBe(true);
    expect(p.plot!.ok).toBe(true);
    expect(p.plot!.series.map((s) => s.points)).toEqual([50, 50]);
    for (const s of p.plot!.series) expect(s.max_error_pct, s.label).toBeLessThanOrEqual(1);
    // the same figure against a generator that claims τ = 3 ns is caught
    const bad = await checkFiles(
      ['plot.svg'],
      ['--kind', 'plot', '--generator', path.join(work, 'plot-wrong-generator.json'), '--no-preview'],
    );
    expect(bad['plot.svg']!.ok).toBe(false);
    expect(bad['plot.svg']!.errors.join(' ')).toMatch(
      /plot "v\(t\) = 1 − e\^\(−t\/τ\)" is [\d.]+ % of the axis range away from its equation/,
    );
  }, 120_000);

  it('registered visuals: check --pending records results and previews, then nothing is pending', async () => {
    const v = vaultFromEvents(standardFixture().events, FIXTURE_NOW, { name: 'Render Vault' });
    rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
    const add = (file: string, kind: string) =>
      cli(v.root, [
        'visual',
        'add',
        path.join(work, file),
        '--kc',
        'kc-si-reflection-coefficient',
        '--kind',
        kind,
        '--title',
        `Template ${file}`,
        '--purpose',
        'Shows the reflection.',
        '--notice',
        'Watch A, B and C.',
        '--alt',
        'Driver, line and load with a reflection.',
      ]);
    expect((await add('diagram.svg', 'diagram')).json!.data).toMatchObject({
      visual_id: 'V-0001',
      status: 'accepted',
    });
    expect((await add('stepper.html', 'stepper')).json!.data).toMatchObject({
      visual_id: 'V-0002',
      status: 'accepted',
    });
    const first = await cli(v.root, ['visual', 'check', '--pending']);
    expect(first.code, first.out).toBe(0);
    expect(first.json!.data).toMatchObject({ checked: 2, passed: 2 });
    for (const id of ['V-0001', 'V-0002'])
      expect(existsSync(path.join(v.root, 'Scaffold', 'Visuals', id, 'preview.png')), id).toBe(true);
    const concept = readFileSync(
      path.join(v.root, 'Scaffold', 'Concepts', 'kc-si-reflection-coefficient.md'),
      'utf8',
    );
    expect(concept).toContain('![[Scaffold/Visuals/V-0002/preview.png]]');
    const spec = readFileSync(path.join(v.root, 'Scaffold', 'Visuals', 'V-0001', 'spec.md'), 'utf8');
    expect(spec).toMatch(/render:[\s\S]*ok: true/);
    const again = await cli(v.root, ['visual', 'check', '--pending']);
    expect(again.json!.data).toMatchObject({ checked: 0, passed: 0 });
    const checked = await cli(v.root, ['call', 'check_visual', '--input', '{"visual_id":"V-0002"}']);
    expect(checked.json!.data).toMatchObject({ render: { ok: true, stale: false }, next_step: null });
  }, 120_000);
});
