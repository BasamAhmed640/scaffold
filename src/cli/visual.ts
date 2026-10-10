import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { callTool } from '../core/api/tools.js';
import { fail, guard, ScaffoldError, type Envelope } from '../core/envelope.js';
import {
  pendingVisuals,
  recordRenderCheck,
  visualTarget,
  type RenderCheck,
} from '../core/service/visuals.js';
import { prepareHtml, prepareSvg, staticChecks } from '../core/visuals/markup.js';
import { plotSvg } from '../core/visuals/plot.js';
import type { CliContext } from './run.js';

// `scaffold visual …` (D5). add/get go through the shared tools; the render check is CLI-only
// (VIS-05) and loads Playwright on demand.

const collect = (v: string, prev: string[] = []): string[] => [...prev, v];

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    throw new ScaffoldError('file_unreadable', `Could not read ${file}: ${(e as Error).message}`);
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readText(file));
  } catch (e) {
    if (e instanceof ScaffoldError) throw e;
    throw new ScaffoldError('invalid_json', `${file} is not valid JSON: ${(e as Error).message}`);
  }
}

const formatOf = (file: string): 'svg' | 'html' => {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.svg') return 'svg';
  if (ext === '.html' || ext === '.htm') return 'html';
  throw new ScaffoldError('unknown_format', `${file}: use an .svg or .html file.`);
};

/** Opens a file with the platform's default app; SCAFFOLD_NO_OPEN=1 only prints it (tests). */
function openWithDefaultApp(abs: string, env: NodeJS.ProcessEnv): boolean {
  if (env.SCAFFOLD_NO_OPEN === '1') return false;
  const [cmd, args] =
    process.platform === 'win32'
      ? ['explorer.exe', [abs]]
      : process.platform === 'darwin'
        ? ['open', [abs]]
        : ['xdg-open', [abs]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
  return true;
}

interface RenderRow {
  visual_id: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  plot: RenderCheck['plot'];
  preview: string | null;
}

async function renderVisuals(
  ctx: CliContext,
  ids: string[],
  o: { pending?: boolean; file?: string[]; kind: string; generator?: string; preview: boolean },
): Promise<Envelope<unknown>> {
  const { launchBrowser, renderCheck } = await import('../render/check.js');
  const env = await guard(async (w) => {
    const files = o.file ?? [];
    const sc = ids.length || o.pending || !files.length ? ctx.open() : null;
    const targets = sc ? [...new Set([...ids, ...(o.pending ? pendingVisuals(sc) : [])])] : [];
    if (!targets.length && !files.length) {
      if (o.pending) return { checked: 0, passed: 0, results: [] as RenderRow[] };
      throw new ScaffoldError('nothing_to_check', 'Name visual ids, --pending or --file.');
    }
    const minFont = sc ? sc.cfg().visuals.min_font_px : 11;
    const { browser, name } = await launchBrowser();
    const rows: RenderRow[] = [];
    try {
      for (const id of targets) {
        const t = visualTarget(sc!, id);
        const out = await renderCheck(
          browser,
          name,
          {
            format: t.visual.format,
            source: t.text,
            kind: t.visual.kind,
            has_generator: t.visual.has_generator,
            generator: t.generator,
            min_font_px: minFont,
            sha256: t.sha256,
          },
          { preview: o.preview, now: sc!.now() },
        );
        const rec = recordRenderCheck(sc!, id, out.result, out.preview, w);
        rows.push({ visual_id: id, ...pick(out.result), preview: rec.preview });
      }
      for (const file of files) {
        const format = formatOf(file);
        const raw = readText(file);
        // The static checks and the same preparation as register_visual, so a file checks like a stored visual.
        const st = staticChecks({
          source: raw,
          format,
          kind: o.kind,
          has_generator: !!o.generator,
          max_bytes: sc ? sc.cfg().visuals.max_bytes : 600_000,
          min_font_px: minFont,
        });
        const source =
          format === 'svg' ? prepareSvg(raw, st.uses_shim) : prepareHtml(raw, path.basename(file));
        const out = await renderCheck(
          browser,
          name,
          {
            format,
            source,
            kind: o.kind,
            has_generator: !!o.generator,
            generator: o.generator ? readText(o.generator) : null,
            min_font_px: minFont,
            sha256: createHash('sha256').update(source, 'utf8').digest('hex'),
          },
          { preview: o.preview },
        );
        let preview: string | null = null;
        if (out.preview) {
          preview = `${file.replace(/\.(svg|html?)$/i, '')}.preview.png`;
          writeFileSync(preview, out.preview);
        }
        const r = pick(out.result);
        rows.push({ visual_id: file, ...r, ok: r.ok && st.ok, errors: [...st.errors, ...r.errors], preview });
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    return { checked: rows.length, passed: rows.filter((r) => r.ok).length, results: rows };
  });
  if (env.ok) {
    const failed = (env.data as { results: RenderRow[] }).results.filter((r) => !r.ok);
    if (failed.length) {
      env.ok = false;
      env.errors = failed.map((r) => ({
        code: 'render_check_failed',
        message: `${r.visual_id}: ${r.errors.slice(0, 4).join(' | ')}`,
        next_step:
          'Fix once and re-register (register_visual with visual_id), or keep it with warnings (ARC-10).',
      }));
    }
  }
  return env;
}

const pick = (r: RenderCheck) => ({ ok: r.ok, errors: r.errors, warnings: r.warnings, plot: r.plot });

export function visualCommands(program: Command, ctx: CliContext): void {
  const visual = program.command('visual').description('Visuals: add, check, open, get, plot (D5)');
  visual
    .command('add [file]')
    .description('Register an SVG or HTML file (or --plot spec) as a visual (VIS-03); runs the static checks')
    .requiredOption('--kc <id>', 'KC id (repeatable)', collect, [])
    .requiredOption('--kind <kind>', 'diagram | stepper | mechanism | plot | widget | comparison | dashboard')
    .requiredOption('--title <text>')
    .requiredOption('--purpose <text>')
    .requiredOption('--notice <text>', 'what to notice, naming the labelled parts')
    .requiredOption('--alt <text>', 'alt text')
    .option('--plot <spec.json>', 'a plot spec instead of a file: Scaffold computes the curves')
    .option('--generator <file>', 'the code that computed the figure (plots)')
    .option('--provenance <text>')
    .option('--id <visual_id>', 'the fix attempt for a needs_fix visual, or an update')
    .action(
      (
        file: string | undefined,
        o: {
          kc: string[];
          kind: string;
          title: string;
          purpose: string;
          notice: string;
          alt: string;
          plot?: string;
          generator?: string;
          provenance?: string;
          id?: string;
        },
      ) =>
        ctx.run('visual add', (sc) => {
          if (!file === !o.plot)
            return fail({ code: 'bad_input', message: 'Pass a file or --plot <spec.json>, not both.' });
          return callTool(sc, 'register_visual', {
            kc_ids: o.kc,
            kind: o.kind,
            title: o.title,
            purpose: o.purpose,
            notice: o.notice,
            alt: o.alt,
            ...(file ? { source: readText(file), format: formatOf(file) } : { plot: readJson(o.plot!) }),
            ...(o.generator ? { generator_code: readText(o.generator) } : {}),
            ...(o.provenance ? { provenance: o.provenance } : {}),
            ...(o.id ? { visual_id: o.id } : {}),
          });
        }),
    );
  visual
    .command('check [ids...]')
    .description(
      'Render check in light and dark (Playwright): overlaps, overflow, fonts, errors; writes preview.png',
    )
    .option('--pending', 'every visual not checked since it last changed')
    .option('--file <path>', 'check an SVG/HTML file outside the vault (repeatable)', collect, [])
    .option('--kind <kind>', 'with --file', 'diagram')
    .option('--generator <file>', 'with --file: the generator (a plot spec enables the fidelity check)')
    .option('--no-preview', 'skip preview.png')
    .action(
      async (
        ids: string[],
        o: { pending?: boolean; file: string[]; kind: string; generator?: string; preview: boolean },
      ) => ctx.emit('visual check', await renderVisuals(ctx, ids, o)),
    );
  visual
    .command('open <id>')
    .description('Open a visual in the default app (browser for HTML)')
    .action((id: string) =>
      ctx.run('visual open', async (sc) =>
        guard(() => {
          const t = visualTarget(sc, id);
          const opened = openWithDefaultApp(t.abs, ctx.io.env);
          return { visual_id: id, file: t.rel, opened };
        }),
      ),
    );
  visual
    .command('get <id>')
    .description('Source, purpose, what to notice, alt text and generator of a visual')
    .action((id: string) => ctx.tool('visual get', 'get_visual', { visual_id: id }));
  visual
    .command('plot <spec>')
    .description('Compute a plot from a JSON spec (VIS-02) and write the SVG')
    .requiredOption('--out <file.svg>')
    .action(async (spec: string, o: { out: string }) =>
      ctx.emit(
        'visual plot',
        await guard(() => {
          const p = plotSvg(readJson(spec));
          const svg = prepareSvg(p.svg, true);
          writeFileSync(o.out, svg);
          return { out: o.out, bytes: Buffer.byteLength(svg), generator: spec };
        }),
      ),
    );
}
