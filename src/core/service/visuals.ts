import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../envelope.js';
import type { VisualFacts } from '../model/facts.js';
import { KcId, SessionId, VisualId } from '../schemas/common.js';
import { localDate } from '../time.js';
import { visualFigure, visualSpecNote } from '../vault/notes.js';
import { visualDirRel } from '../vault/vault.js';
import { prepareHtml, prepareSvg, staticChecks, stripShim, type VisualFormat } from '../visuals/markup.js';
import { plotSvg, PlotSpec } from '../visuals/plot.js';
import { loadBank } from './bank.js';
import type { Scaffold } from './scaffold.js';
import { refreshNotes } from './writers.js';

// D5 visual registry (VIS-03, VIS-05). register_visual runs the fast static checks; a failing
// visual gets exactly one fix attempt (`needs_fix` stores nothing), after which it is accepted with
// warnings or, if unusable, dropped. It never loops (ARC-10). The render check runs in the CLI
// (src/render) and records its result here.

export const VISUAL_KINDS = [
  'diagram',
  'stepper',
  'mechanism',
  'plot',
  'widget',
  'comparison',
  'dashboard',
] as const;

export const RegisterVisualInput = z
  .object({
    kc_ids: z.array(KcId).min(1).max(10),
    kind: z.enum(VISUAL_KINDS),
    title: z.string().min(3).max(200),
    format: z.enum(['svg', 'html']).optional().describe('Required with source; plot implies svg.'),
    source: z
      .string()
      .max(1_100_000)
      .optional()
      .describe('SVG markup or HTML (a fragment is wrapped in a self-contained page with the theme shim).'),
    plot: PlotSpec.optional().describe(
      'Instead of source: a plot spec; Scaffold computes every curve and stores the spec as the generator.',
    ),
    purpose: z.string().min(3).max(1000),
    notice: z.string().min(3).max(1000).describe('What to notice, naming the labelled parts (A, B, ①).'),
    alt: z.string().min(10).max(1000),
    generator_code: z.string().max(100_000).optional().describe('Code that computed the curves (plots).'),
    provenance: z.string().max(500).optional(),
    visual_id: VisualId.optional().describe(
      'The id from a needs_fix result (the one fix attempt), or to update.',
    ),
    session_id: SessionId.nullish(),
  })
  .refine((i) => (i.source === undefined) !== (i.plot === undefined), 'pass either source or plot')
  .refine((i) => i.plot !== undefined || i.format !== undefined, 'format is required with source');

export const VisualIdInput = z.object({ visual_id: VisualId });

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const figureRel = (id: string, format: VisualFormat): string =>
  `${visualDirRel(id)}/${format === 'svg' ? 'figure.svg' : 'index.html'}`;
export const specRel = (id: string): string => `${visualDirRel(id)}/spec.md`;
export const previewRel = (id: string): string => `${visualDirRel(id)}/preview.png`;

function visualOf(sc: Scaffold, id: string): VisualFacts {
  const v = sc.facts().visuals[id];
  if (!v)
    throw new ScaffoldError('unknown_visual', `Unknown visual ${id}.`, 'list them in Scaffold/Visuals/.');
  if (v.status !== 'accepted')
    throw new ScaffoldError(
      'visual_not_stored',
      `${id} was ${v.status === 'dropped' ? 'dropped' : 'not stored (it failed its checks)'}.`,
      'Register a new visual.',
    );
  return v;
}

export async function registerVisual(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = RegisterVisualInput.parse(raw);
  const facts = sc.facts();
  for (const k of input.kc_ids)
    if (!facts.kcs[k])
      throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`, 'Create it with upsert_concept first.');
  const prev = input.visual_id ? facts.visuals[input.visual_id] : undefined;
  if (input.visual_id && !prev)
    throw new ScaffoldError(
      'unknown_visual',
      `Unknown visual ${input.visual_id}.`,
      'Omit visual_id to register a new visual.',
    );

  let source: string;
  let format: VisualFormat;
  let generator = input.generator_code?.trim() || null;
  let provenance = input.provenance ?? '';
  if (input.plot) {
    const p = plotSvg(input.plot);
    source = p.svg;
    format = 'svg';
    generator = p.generator;
    provenance ||= 'Computed by the Scaffold plot template from the spec above (`scaffold visual plot`).';
  } else {
    source = input.source!;
    format = input.format!;
  }

  // One fix attempt per visual per session (or per day outside a session); never a loop (ARC-10).
  const sessionId = input.session_id ?? sc.openSession()?.id ?? null;
  const today = localDate(sc.now(), sc.tz());
  const recent = (prev?.registrations ?? []).filter((r) =>
    sessionId
      ? r.session_id === sessionId
      : r.session_id === null && localDate(new Date(r.ts), sc.tz()) === today,
  );
  if (prev && recent.length >= 2)
    throw new ScaffoldError(
      'fix_limit',
      `${prev.id} already had its fix attempt ${sessionId ? 'in this session' : 'today'} (ARC-10).`,
      'Keep it with its warnings (check_visual lists them) or drop it; do not retry.',
    );
  const attempt = recent.at(-1)?.status === 'needs_fix' ? 2 : 1;

  const cfg = sc.cfg().visuals;
  const check = staticChecks({
    source,
    format,
    kind: input.kind,
    has_generator: !!generator,
    max_bytes: cfg.max_bytes,
    min_font_px: cfg.min_font_px,
  });
  const status = check.ok
    ? 'accepted'
    : attempt === 1
      ? 'needs_fix'
      : check.fatal.length
        ? 'dropped'
        : 'accepted';
  const id = prev?.id ?? sc.nextId('V');
  const files: string[] = [];
  let stored: string | null = null;
  if (status === 'accepted') {
    stored = format === 'svg' ? prepareSvg(source, check.uses_shim) : prepareHtml(source, input.title);
    const fig = figureRel(id, format);
    sc.vault.writeText(fig, stored);
    sc.vault.writeText(
      specRel(id),
      visualSpecNote({
        id,
        title: input.title,
        kind: input.kind,
        kc_ids: input.kc_ids,
        format,
        purpose: input.purpose,
        notice: input.notice,
        alt: input.alt,
        generator,
        provenance,
        checks: {
          static: {
            ok: check.ok,
            errors: check.errors,
            warnings: check.warnings,
            at: sc.now().toISOString(),
          },
          render: null,
        },
        has_preview: false,
      }),
    );
    files.push(fig, specRel(id));
  }
  const warnings = [...check.errors, ...check.warnings].map((m) => m.slice(0, 300)).slice(0, 20);
  sc.emit([
    {
      type: 'visual_registered',
      visual_id: id,
      session_id: sessionId,
      kc_ids: input.kc_ids,
      kind: input.kind,
      title: input.title,
      format,
      has_generator: !!generator,
      static_ok: check.ok,
      status,
      attempt,
      source_sha256: stored ? sha256(stored) : null,
      warnings,
    },
  ]);
  if (status === 'accepted')
    refreshNotes(sc, { kcs: [...new Set([...input.kc_ids, ...(prev?.kc_ids ?? [])])] }, loadBank(sc), w);

  const next_step =
    status === 'needs_fix'
      ? `Fix these once and call register_visual again with visual_id "${id}" (one fix attempt, ARC-10).`
      : status === 'dropped'
        ? 'Dropped: it is still unusable after the fix attempt. Explain without it or make a simpler figure.'
        : check.ok
          ? `Pass visual_ids ["${id}"] to mark_taught. Terminal front-ends: \`scaffold visual open ${id}\`.`
          : `Kept with warnings. Pass visual_ids ["${id}"] to mark_taught; do not retry (ARC-10).`;
  if (status === 'needs_fix') for (const e of check.errors) w.add(`${id}: ${e}`);
  return {
    visual_id: id,
    status,
    attempt,
    format,
    static: { ok: check.ok, errors: check.errors, warnings: check.warnings },
    files,
    next_step,
  };
}

/** Sections of a spec note by `## Heading`. */
function sections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    out[p.slice(0, nl).trim()] = p.slice(nl + 1).trim();
  }
  return out;
}

function generatorOf(section: string | undefined): string | null {
  const m = /^(`{3,})\r?\n([\s\S]*?)\r?\n\1/m.exec(section ?? '');
  return m ? m[2]! : null;
}

export interface RenderCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  modes: string[];
  plot: { ok: boolean; series: { label: string; points: number; max_error_pct: number }[] } | null;
  checked_at: string;
  source_sha256: string;
  browser: string;
}

/** Everything the render checker needs for one stored visual. */
export function visualTarget(sc: Scaffold, id: string) {
  const v = visualOf(sc, id);
  const rel = figureRel(id, v.format);
  const text = sc.vault.readText(rel);
  if (text === null)
    throw new ScaffoldError(
      'visual_missing',
      `${rel} is missing.`,
      `Register ${id} again with visual_id "${id}".`,
    );
  const note = sc.vault.readNote(specRel(id));
  const sec = sections(note?.split.body ?? '');
  const checks = (note?.data.checks ?? null) as { static?: unknown; render?: RenderCheck | null } | null;
  return {
    visual: v,
    rel,
    abs: sc.vault.abs(rel),
    text,
    sha256: sha256(text),
    generator: generatorOf(sec['Generator / provenance']),
    sections: sec,
    checks,
  };
}

export function getVisual(sc: Scaffold, raw: unknown) {
  const { visual_id } = VisualIdInput.parse(raw);
  const t = visualTarget(sc, visual_id);
  const v = t.visual;
  return {
    visual_id,
    title: v.title,
    kind: v.kind,
    format: v.format,
    kc_ids: v.kc_ids,
    file: t.rel,
    source: stripShim(t.text),
    edited_since_registered: t.sha256 !== v.source_sha256,
    purpose: t.sections['Purpose'] ?? '',
    notice: t.sections['What to notice'] ?? '',
    alt: t.sections['Alt text'] ?? '',
    generator: t.generator,
    warnings: v.warnings,
  };
}

/** Fast static checks on the stored file plus the last render check (VIS-05; the render check is CLI-only). */
export function checkVisual(sc: Scaffold, raw: unknown) {
  const { visual_id } = VisualIdInput.parse(raw);
  const t = visualTarget(sc, visual_id);
  const cfg = sc.cfg().visuals;
  const s = staticChecks({
    source: stripShim(t.text),
    format: t.visual.format,
    kind: t.visual.kind,
    has_generator: t.visual.has_generator,
    max_bytes: cfg.max_bytes,
    min_font_px: cfg.min_font_px,
  });
  const render = t.checks?.render ?? null;
  const stale = !!render && render.source_sha256 !== t.sha256;
  const next_step = !render
    ? `Not rendered yet: the owner runs \`scaffold visual check ${visual_id}\` (CLI).`
    : stale
      ? `Edited since the render check: run \`scaffold visual check ${visual_id}\`.`
      : render.ok && s.ok
        ? null
        : `Fix once and register again with visual_id "${visual_id}", or keep it with its warnings (ARC-10).`;
  return {
    visual_id,
    status: t.visual.status,
    static: { ok: s.ok, errors: s.errors, warnings: s.warnings },
    render: render ? { ...render, stale } : null,
    next_step,
  };
}

/** Accepted visuals whose render check is missing or older than the stored file (`visual check --pending`). */
export function pendingVisuals(sc: Scaffold): string[] {
  const out: string[] = [];
  for (const v of Object.values(sc.facts().visuals)) {
    if (v.status !== 'accepted') continue;
    try {
      const t = visualTarget(sc, v.id);
      if (!t.checks?.render || t.checks.render.source_sha256 !== t.sha256) out.push(v.id);
    } catch {
      out.push(v.id);
    }
  }
  return out.sort();
}

/** Records a CLI render check: checks.render in spec.md, preview.png, and the preview embeds. */
export function recordRenderCheck(
  sc: Scaffold,
  id: string,
  result: RenderCheck,
  preview: Buffer | null,
  w: Warnings,
) {
  const t = visualTarget(sc, id);
  if (preview) sc.vault.writeBytes(previewRel(id), preview);
  const hasPreview = sc.vault.exists(previewRel(id));
  sc.vault.writeDerived(
    specRel(id),
    { checks: { static: t.checks?.static ?? null, render: result } },
    { figure: visualFigure(id, t.visual.format, hasPreview) },
    (m) => w.add(m),
  );
  if (t.visual.format === 'html') refreshNotes(sc, { kcs: t.visual.kc_ids }, loadBank(sc), w);
  return { visual_id: id, ok: result.ok, preview: preview ? previewRel(id) : null };
}
