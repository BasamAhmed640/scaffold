// Runs verification suites and pastes their real output into docs/VERIFICATION.md (G7).
// Usage: npx tsx scripts/record-verification.ts [SUITE ...]   (no args = all automated suites)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

interface Suite {
  id: string;
  title: string;
  commands: string[];
}

const SUITES: Suite[] = [
  {
    id: 'V-CORE',
    title: 'V-CORE: the learner model is correct',
    commands: [
      'npx vitest run test/core --reporter=verbose',
      'npx vitest run test/core --coverage --coverage.include=src/core/model/status.ts --coverage.include=src/core/model/misconceptions.ts --coverage.include=src/core/model/derive.ts --coverage.include=src/core/planner/plan.ts --coverage.include=src/core/planner/focus.ts --coverage.include=src/core/planner/briefing.ts --coverage.reporter=text --coverage.reportsDirectory=.tmp/cov-core',
    ],
  },
  {
    id: 'V-VAULT',
    title: 'V-VAULT: files are safe',
    commands: ['npx vitest run test/vault --reporter=verbose'],
  },
  {
    id: 'V-CLI',
    title: 'V-CLI: CLI keeps its contracts',
    commands: ['npx vitest run test/cli --reporter=verbose'],
  },
  {
    id: 'V-MCP',
    title: 'V-MCP: MCP server keeps its contracts',
    commands: ['npx vitest run test/mcp --reporter=verbose'],
  },
  {
    id: 'V-PROTO',
    title: 'V-PROTO: the protocol files are complete',
    commands: ['npx vitest run test/proto --reporter=verbose'],
  },
  {
    id: 'V-PED-HARNESS',
    title:
      'V-PED harness: checker, scripted learner, fixtures and run loop (no model calls). The stub tutor is a negative control: it must pass the mechanical checks (TP-03, TP-07, TP-08) and fail the pedagogy ones (S2, S8, S10a, S10b, TP-17), so its run reports FAIL',
    commands: [
      'npx vitest run test/ped --reporter=verbose',
      'npx tsx scripts/ped/run.ts --provider stub --run verification-stub',
    ],
  },
  {
    id: 'V-ANKI',
    title: 'V-ANKI: the memory layer stays correct and bounded (mocked)',
    commands: ['npx vitest run test/anki --reporter=verbose'],
  },
  {
    id: 'V-VIS',
    title: 'V-VIS: visuals are correct and readable (Playwright Chromium; Edge is the fallback)',
    commands: [
      'npx vitest run test/vis --reporter=verbose',
      'npx tsx scripts/build-theme.ts --check',
      'npx tsx src/cli/index.ts visual check --no-preview --file visual-kit/templates/diagram.svg --file visual-kit/templates/stepper.html',
      'npx tsx src/cli/index.ts visual check --no-preview --file test/fixtures/visuals/adv-overlap.svg --file test/fixtures/visuals/adv-font-scaled.svg --file test/fixtures/visuals/adv-dark-only.svg',
    ],
  },
  {
    id: 'V-QQ',
    title: 'V-QQ: questions are good (lint)',
    commands: ['npx vitest run test/qq --reporter=verbose'],
  },
  {
    id: 'STATIC',
    title: 'Static checks: typecheck, lint, format, adapters, theme',
    commands: [
      'npx tsc --noEmit',
      'npx eslint .',
      'npx prettier --check .',
      'npx tsx scripts/build-adapters.ts --check',
      'npx tsx scripts/build-theme.ts --check',
    ],
  },
];

const FILE = 'docs/VERIFICATION.md';
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function run(cmd: string): { code: number; out: string } {
  const r = spawnSync(cmd, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(ANSI, '').replace(/\r\n/g, '\n').trimEnd();
  return { code: r.status ?? 1, out };
}

function section(s: Suite): string {
  const parts = [`<!-- suite:${s.id}:begin -->`, `### ${s.title}`, ''];
  const when = new Date().toISOString();
  for (const cmd of s.commands) {
    const { code, out } = run(cmd);
    parts.push(
      `\`${cmd}\` — exit ${code} — ${when} — ${process.platform} node ${process.version}`,
      '',
      '```text',
      out || '(no output)',
      '```',
      '',
    );
  }
  parts.push(`<!-- suite:${s.id}:end -->`);
  return parts.join('\n');
}

const wanted = process.argv.slice(2);
const suites = wanted.length ? SUITES.filter((s) => wanted.includes(s.id)) : SUITES;
let doc = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '# Verification\n';
for (const s of suites) {
  const text = section(s);
  const re = new RegExp(`<!-- suite:${s.id}:begin -->[\\s\\S]*?<!-- suite:${s.id}:end -->`);
  doc = re.test(doc) ? doc.replace(re, () => text) : `${doc.trimEnd()}\n\n${text}\n`;
  console.log(`recorded ${s.id}`);
}
writeFileSync(FILE, doc.endsWith('\n') ? doc : doc + '\n');
