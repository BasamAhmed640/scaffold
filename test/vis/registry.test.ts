import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { callTool } from '../../src/core/api/tools.js';
import { Warnings } from '../../src/core/envelope.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import type { Scaffold } from '../../src/core/service/scaffold.js';
import { pendingVisuals, recordRenderCheck, type RenderCheck } from '../../src/core/service/visuals.js';
import { FIXTURE_NOW, standardFixture } from '../fixtures/standard.js';
import { cleanupAll, vaultFromEvents, type TestVault } from '../helpers/vault.js';

// V-VIS registry (VIS-03, VIS-05): storage layout, spec notes, concept-note embeds, the single fix
// attempt (accepted with warnings or dropped, never a loop: ARC-10), get_visual and check_visual.

const KC = 'kc-si-reflection-coefficient';
const fx = (name: string): string => readFileSync(`test/fixtures/visuals/${name}`, 'utf8');
const kit = (name: string): string => readFileSync(`visual-kit/templates/${name}`, 'utf8');

let v: TestVault;
let sc: Scaffold;

beforeEach(() => {
  v = vaultFromEvents(standardFixture().events, FIXTURE_NOW);
  sc = v.sc;
  rebuildVault(sc, { restoreMissing: true }, new Warnings());
});
afterAll(() => cleanupAll());

const base = {
  kc_ids: [KC],
  kind: 'diagram',
  title: 'Signal path with a reflection',
  purpose: 'Shows where the reflection comes from.',
  notice: 'A launches the step; C reflects half of it back toward A.',
  alt: 'Three boxes A, B, C joined by arrows, with a dashed arrow from C back to A.',
};
const read = (rel: string): string | null => sc.vault.readText(rel);
const dir = (id: string): string => `Scaffold/Visuals/${id}`;
const concept = (): string => read(`Scaffold/Concepts/${KC}.md`)!;

async function register(input: Record<string, unknown>) {
  const env = await callTool(sc, 'register_visual', input);
  return env as typeof env & {
    data: { visual_id: string; status: string; attempt: number; files: string[]; next_step: string } | null;
  };
}

describe('VIS-03 storage', () => {
  it('a clean SVG is stored with its spec note and embedded in the concept note', async () => {
    const env = await register({ ...base, format: 'svg', source: kit('diagram.svg') });
    expect(env.ok).toBe(true);
    expect(env.data).toMatchObject({ visual_id: 'V-0001', status: 'accepted', attempt: 1 });
    expect(env.data!.files).toEqual([`${dir('V-0001')}/figure.svg`, `${dir('V-0001')}/spec.md`]);
    const fig = read(`${dir('V-0001')}/figure.svg`)!;
    expect(fig).toContain('<style id="scaffold-theme-shim">');
    const spec = read(`${dir('V-0001')}/spec.md`)!;
    expect(spec).toContain('kc_ids: [kc-si-reflection-coefficient]');
    expect(spec).toContain('![[Scaffold/Visuals/V-0001/figure.svg]]');
    expect(spec).toContain('## What to notice\n\nA launches the step');
    expect(spec).toContain('_Hand-authored; no generator._');
    expect(spec).toMatch(/checks:[\s\S]*static:[\s\S]*ok: true/);
    expect(concept()).toContain('[[Scaffold/Visuals/V-0001/spec|V-0001 · Signal path with a reflection]]');
    expect(concept()).toContain('![[Scaffold/Visuals/V-0001/figure.svg]]');
    const e = sc.vault.log.read().events.at(-1)!;
    expect(e).toMatchObject({
      type: 'visual_registered',
      status: 'accepted',
      static_ok: true,
      format: 'svg',
    });
    expect((e as { source_sha256: string }).source_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an HTML widget fragment becomes a self-contained page; the concept note links to it', async () => {
    const env = await register({ ...base, kind: 'stepper', format: 'html', source: kit('stepper.html') });
    expect(env.data!.status).toBe('accepted');
    const page = read(`${dir('V-0001')}/index.html`)!;
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<title>Signal path with a reflection</title>');
    expect(concept()).toContain('[[Scaffold/Visuals/V-0001/index.html|Open the interactive version]]');
    expect(concept()).not.toContain('preview.png'); // not rendered yet
  });

  it('a plot spec is computed by Scaffold and its spec is stored as the generator (VIS-02)', async () => {
    const env = await register({ ...base, kind: 'plot', plot: JSON.parse(kit('plot.json')) });
    expect(env.data!.status).toBe('accepted');
    const got = await callTool(sc, 'get_visual', { visual_id: 'V-0001' });
    const d = got.data as { generator: string; source: string; format: string };
    expect(d.format).toBe('svg');
    expect(JSON.parse(d.generator)).toMatchObject({ params: { tau: 2 } });
    expect(d.source).toContain('data-scaffold-plot="1"');
    expect(sc.facts().visuals['V-0001']).toMatchObject({ has_generator: true, kind: 'plot' });
  });

  it('get_visual returns the source without the shim, with purpose, notice and alt text', async () => {
    await register({ ...base, format: 'svg', source: kit('diagram.svg') });
    const env = await callTool(sc, 'get_visual', { visual_id: 'V-0001' });
    expect(env.ok).toBe(true);
    const d = env.data as Record<string, unknown>;
    expect(d.source).toBe(kit('diagram.svg').trim() + '\n');
    expect(d).toMatchObject({
      purpose: base.purpose,
      notice: base.notice,
      alt: base.alt,
      generator: null,
      edited_since_registered: false,
    });
  });

  it('rejects unknown KCs, unknown visual ids, and source with plot', async () => {
    expect(
      (await register({ ...base, kc_ids: ['kc-nope'], format: 'svg', source: kit('diagram.svg') })).errors[0]!
        .code,
    ).toBe('unknown_kc');
    expect(
      (await register({ ...base, format: 'svg', source: kit('diagram.svg'), visual_id: 'V-0042' })).errors[0]!
        .code,
    ).toBe('unknown_visual');
    expect(
      (
        await register({
          ...base,
          format: 'svg',
          source: kit('diagram.svg'),
          plot: JSON.parse(kit('plot.json')),
        })
      ).ok,
    ).toBe(false);
    expect((await register({ ...base, source: kit('diagram.svg') })).ok).toBe(false); // format missing
  });
});

describe('VIS-05 one fix attempt, then accepted with warnings or dropped (ARC-10)', () => {
  it('needs_fix stores nothing; the fixed source is accepted', async () => {
    const first = await register({ ...base, format: 'svg', source: fx('adv-no-title.svg') });
    expect(first.data).toMatchObject({ visual_id: 'V-0001', status: 'needs_fix', attempt: 1, files: [] });
    expect(first.data!.next_step).toMatch(/visual_id "V-0001"/);
    expect(first.warnings.join(' ')).toMatch(/missing <title>/);
    expect(sc.vault.exists(dir('V-0001'))).toBe(false);
    expect(concept()).not.toContain('V-0001');
    const fixed = fx('adv-no-title.svg').replace(
      '<g class',
      '<title>Fixed title</title><desc>d</desc><g class',
    );
    const second = await register({ ...base, format: 'svg', source: fixed, visual_id: 'V-0001' });
    expect(second.data).toMatchObject({ visual_id: 'V-0001', status: 'accepted', attempt: 2 });
    expect(sc.facts().visuals['V-0001']).toMatchObject({ status: 'accepted', static_ok: true });
  });

  it('a non-fatal failure after the fix attempt is kept with warnings; a third call is refused', async () => {
    const plot = { ...base, kind: 'plot', format: 'svg', source: fx('adv-hand-plot.svg') };
    expect((await register(plot)).data!.status).toBe('needs_fix');
    const second = await register({ ...plot, visual_id: 'V-0001' });
    expect(second.data).toMatchObject({ status: 'accepted', attempt: 2 });
    expect(second.data!.next_step).toMatch(/Kept with warnings/);
    expect(sc.facts().visuals['V-0001']).toMatchObject({ status: 'accepted', static_ok: false });
    expect(sc.facts().visuals['V-0001']!.warnings.join(' ')).toMatch(/generator/);
    const third = await register({ ...plot, visual_id: 'V-0001' });
    expect(third.ok).toBe(false);
    expect(third.errors[0]).toMatchObject({ code: 'fix_limit' });
    expect(sc.facts().visuals['V-0001']!.registrations).toHaveLength(2);
  });

  it('an unusable visual (network reference) is dropped after the fix attempt', async () => {
    const net = { ...base, format: 'svg', source: fx('adv-network.svg') };
    expect((await register(net)).data!.status).toBe('needs_fix');
    const second = await register({ ...net, visual_id: 'V-0001' });
    expect(second.data).toMatchObject({ status: 'dropped', attempt: 2, files: [] });
    expect(sc.vault.exists(dir('V-0001'))).toBe(false);
    const got = await callTool(sc, 'get_visual', { visual_id: 'V-0001' });
    expect(got.errors[0]).toMatchObject({ code: 'visual_not_stored' });
    expect(concept()).not.toContain('V-0001');
  });

  it('a failed update of an accepted visual leaves the stored version in place', async () => {
    await register({ ...base, format: 'svg', source: kit('diagram.svg') });
    const before = read(`${dir('V-0001')}/figure.svg`);
    const upd = await register({
      ...base,
      format: 'svg',
      source: fx('adv-no-title.svg'),
      visual_id: 'V-0001',
    });
    expect(upd.data!.status).toBe('needs_fix');
    expect(read(`${dir('V-0001')}/figure.svg`)).toBe(before);
    expect(sc.facts().visuals['V-0001']).toMatchObject({ status: 'accepted', static_ok: true });
    expect(concept()).toContain('![[Scaffold/Visuals/V-0001/figure.svg]]');
  });

  it('the registry rebuilds identically from the event log (ARC-08)', async () => {
    await register({ ...base, format: 'svg', source: fx('adv-no-title.svg') });
    await register({ ...base, format: 'svg', source: kit('diagram.svg'), visual_id: 'V-0001' });
    await register({ ...base, format: 'svg', source: fx('adv-network.svg') });
    const live = structuredClone(sc.facts().visuals);
    rebuildVault(sc, { restoreMissing: false }, new Warnings());
    expect(sc.facts().visuals).toEqual(live);
    expect(Object.values(live).map((x) => [x.id, x.status])).toEqual([
      ['V-0001', 'accepted'],
      ['V-0002', 'needs_fix'],
    ]);
  });
});

describe('check_visual and recorded render checks', () => {
  const render = (sha: string, ok = true): RenderCheck => ({
    ok,
    errors: ok ? [] : ['overlapping text: "a" and "b"'],
    warnings: [],
    modes: ['light', 'dark'],
    plot: null,
    checked_at: '2026-10-09T22:00:00.000Z',
    source_sha256: sha,
    browser: 'test',
  });

  it('before a render check: static results and a CLI next step', async () => {
    await register({ ...base, format: 'svg', source: kit('diagram.svg') });
    const env = await callTool(sc, 'check_visual', { visual_id: 'V-0001' });
    expect(env.data).toMatchObject({ static: { ok: true }, render: null });
    expect((env.data as { next_step: string }).next_step).toMatch(/scaffold visual check V-0001/);
    expect(pendingVisuals(sc)).toEqual(['V-0001']);
  });

  it('a recorded render check writes preview.png, embeds it for HTML, and goes stale on a hand edit', async () => {
    await register({ ...base, kind: 'stepper', format: 'html', source: kit('stepper.html') });
    const sha = sc.facts().visuals['V-0001']!.source_sha256!;
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    recordRenderCheck(sc, 'V-0001', render(sha), png, new Warnings());
    expect(readFileSync(path.join(v.root, dir('V-0001'), 'preview.png'))).toEqual(png);
    expect(read(`${dir('V-0001')}/spec.md`)).toContain('![[Scaffold/Visuals/V-0001/preview.png]]');
    expect(concept()).toContain('![[Scaffold/Visuals/V-0001/preview.png]]');
    expect(pendingVisuals(sc)).toEqual([]);
    let env = await callTool(sc, 'check_visual', { visual_id: 'V-0001' });
    expect(env.data).toMatchObject({ render: { ok: true, stale: false }, next_step: null });
    // the owner edits the page by hand
    const file = path.join(v.root, dir('V-0001'), 'index.html');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Back', 'Previous'));
    env = await callTool(sc, 'check_visual', { visual_id: 'V-0001' });
    expect(env.data).toMatchObject({ render: { stale: true } });
    expect(pendingVisuals(sc)).toEqual(['V-0001']);
    expect((await callTool(sc, 'get_visual', { visual_id: 'V-0001' })).data).toMatchObject({
      edited_since_registered: true,
    });
  });

  it('a failed render check asks for one fix, or keeping it with warnings', async () => {
    await register({ ...base, format: 'svg', source: kit('diagram.svg') });
    recordRenderCheck(
      sc,
      'V-0001',
      render(sc.facts().visuals['V-0001']!.source_sha256!, false),
      null,
      new Warnings(),
    );
    const env = await callTool(sc, 'check_visual', { visual_id: 'V-0001' });
    expect(env.data).toMatchObject({ render: { ok: false, stale: false } });
    expect((env.data as { next_step: string }).next_step).toMatch(/Fix once.*ARC-10/);
  });
});
