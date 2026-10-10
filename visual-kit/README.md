# Scaffold visual kit

The visual kit is a standalone theme, figure templates and a render checker for Scaffold's visuals (spec D5).

Contents:

- `theme.css`: the theme shim (VIS-04).
  - It defines every CSS variable and class used by Claude's inline visualizer, with light and dark values. Examples are `--text-primary`, `--border`, `.t`, `.ts`, `.th`, `.box`, `.arr`, `.leader` and `.c-<ramp>` for nine colour ramps.
  - A widget authored in Claude Desktop therefore renders the same way from the vault.
  - It is generated from `src/core/visuals/theme.ts` by `npm run build:theme`. `npm run check:theme` fails if it is stale.
- `templates/diagram.svg`: a labelled block diagram. Its parts carry short ids (A, B, C) and its labels sit next to what they name.
- `templates/stepper.html`: a segmented, multi-step widget with Back and Next controls and a caption for each step.
- `templates/plot.json`: a plot spec. Scaffold computes every curve from its equation (VIS-02) and stores the spec as the generator.

## Use

- **Register a visual you showed:**
  - From the MCP server: `register_visual`.
  - From the CLI: `scaffold visual add figure.svg --kc kc-… --kind diagram --title … --purpose … --notice … --alt …`.
  - The fast static checks run on registration: well-formed markup, a title/desc or aria-label, the size limit, no network references, and no explicit font under 11 px.
- **Compute a plot:**
  - Write the SVG to a file with `scaffold visual plot templates/plot.json --out plot.svg`.
  - Or register it directly with `scaffold visual add --plot templates/plot.json --kind plot …`.
- **Render check** (CLI only, VIS-05): `scaffold visual check --pending`, or `scaffold visual check --file figure.svg` for a file outside the vault.
  - It renders each visual at 680 px in light and dark mode, with every network request blocked.
  - It fails on console or script errors, overlapping text, text outside the viewBox or viewport, effective fonts under 11 px, and a plot with no generator. For a plot spec it also checks that 50 rendered points match the equation within 1 % of the axis range.
  - It writes `preview.png`. Contrast under WCAG AA is reported as a warning.
- **Fix attempts:** a visual that fails gets one fix attempt. After that it is kept with warnings or dropped, never retried in a loop (ARC-10).

The render checker uses Playwright, an optional dependency. If Chromium is missing, run `npx playwright install chromium`. The checker falls back to an installed Microsoft Edge.
