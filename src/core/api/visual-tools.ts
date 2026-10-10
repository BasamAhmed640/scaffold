import {
  checkVisual,
  getVisual,
  registerVisual,
  RegisterVisualInput,
  VisualIdInput,
} from '../service/visuals.js';
import type { ToolDef } from './tools.js';

// D5 visual rows (VIS-03, VIS-05). The MCP server runs only the fast static checks; the render
// check (light/dark, overlaps, overflow, fonts, preview.png) is `scaffold visual check` in the CLI.

export const VISUAL_TOOLS: ToolDef[] = [
  {
    name: 'register_visual',
    title: 'Register a visual',
    description:
      'Persist a visual you showed (TP-12, VIS-03): SVG or HTML source (or a plot spec that Scaffold computes), KC links, purpose, what to notice, alt text and generator code for plots. Runs the fast static checks (well-formed, title/desc or aria-label, size limit, no network references, fonts ≥ 11 px). A failing visual gets one fix attempt: re-register with the returned visual_id; then it is kept with warnings or dropped (ARC-10).',
    input: RegisterVisualInput,
    handler: (sc, i, w) => registerVisual(sc, i, w),
  },
  {
    name: 'check_visual',
    title: 'Check a visual',
    description:
      'Static checks on a stored visual plus the last render check (light/dark, overlaps, overflow, fonts), which the owner runs with `scaffold visual check`.',
    input: VisualIdInput,
    readOnly: true,
    handler: (sc, i) => checkVisual(sc, i),
  },
  {
    name: 'get_visual',
    title: 'Get a visual',
    description:
      'Returns a stored visual’s source, purpose, what to notice, alt text and generator, to re-display it or quiz with it ("In V-0012, what does … at ①?").',
    input: VisualIdInput,
    readOnly: true,
    handler: (sc, i) => getVisual(sc, i),
  },
];
