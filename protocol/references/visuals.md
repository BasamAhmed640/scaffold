# Visuals (D5)

The rules below are the build spec's D5, verbatim, followed by the workflow.

{{include references/_d5.md}}

## Workflow

1. Decide (VIS-01): spatial layout, structure, a causal process over time, a quantitative relationship, or a comparison. Not for a pure definition.
2. Name the parts before showing the process (pre-training). Give each part a short id (A, B, ①) and use the ids in your explanation.
3. Make it:
   - **Claude Desktop:** use the inline visual capability. Use the visualizer's CSS variables and classes (`--text-primary`, `--border`, `.t`, `.ts`, `.th`, `.c-<ramp>`…); Scaffold's theme shim renders them the same way from the vault (VIS-04).
   - **Terminal front-ends:** write SVG (preferred) or a self-contained HTML file. No external network references (no CDN scripts, fonts or images).
   - **Plots:** compute every point from the equation or data with code, and pass that code as `generator_code`. A plot without a generator fails the check. Simplest: pass a plot spec instead of source (`plot: {title, desc, x: {label, unit, min, max, var}, y: {label, unit, min, max}, params, series: [{label, expr}]}`); Scaffold computes the curves, labels them directly, and stores the spec as the generator.
4. Persist it: `register_visual {kc_ids, kind, title, format: "svg" | "html", source, purpose, notice, alt, generator_code?, provenance?}` (or `plot` in place of `format` and `source`). `kind` is one of `diagram`, `stepper`, `mechanism`, `plot`, `widget`, `comparison`, `dashboard`. The call runs the fast static checks (well-formed, title/desc or aria-label, size limit, no network references, fonts ≥ 11 px) and returns the visual id, a `status` and any problems.
5. `status: "needs_fix"` means nothing was stored. Fix the source once and call `register_visual` again with the returned `visual_id`. That second call is final: the visual is kept with warnings, or dropped if it is unusable (malformed, too large, network references). A third call is refused; never loop (ARC-10).
6. Terminal front-ends: `scaffold visual open <id>` opens it for the learner. The owner runs `scaffold visual check --pending` for the full render check (light and dark, overlaps, overflow, fonts under 11 px, plot fidelity), which writes `preview.png`. `check_visual {visual_id}` shows the static result and the last render check.
7. `mark_taught {kc_ids, visual_ids: [id]}` after explaining with it. To reuse it later, `get_visual {visual_id}` returns the source; quiz with it ("In V-0012, what does the source see at t = 1.5·TD?").
