import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { themeCss } from '../src/core/visuals/theme.js';

// VIS-04: writes visual-kit/theme.css from src/core/visuals/theme.ts. `--check` fails if it is stale.

const OUT = 'visual-kit/theme.css';
const css = themeCss('html');
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== css) {
    console.error(`${OUT} is out of date: run npm run build:theme`);
    process.exit(1);
  }
  console.log(`${OUT} is current (${css.length} bytes)`);
} else {
  mkdirSync('visual-kit', { recursive: true });
  writeFileSync(OUT, css);
  console.log(`wrote ${OUT} (${css.length} bytes)`);
}
