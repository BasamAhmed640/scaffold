// V-PED runner. Usage:
//   tsx scripts/ped/run.ts --provider claude|codex|stub [--scenarios s01,s02] [--run <id>] [--dry-run]
//   tsx scripts/ped/run.ts --score <run dir>        re-score saved transcripts (also hand-run ones)
// Real providers use the owner's subscription allowance: run them only with the owner's approval.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEvent, type ScaffoldEvent } from '../../src/core/schemas/events.js';
import { checkTranscript, summarize, summaryTable, type Summary } from './checker.js';
import {
  ClaudeProvider,
  CodexProvider,
  defaultWorkRoot,
  findExecutable,
  prepareWorkdir,
  type Provider,
} from './drivers.js';
import { createFixtureVault } from './fixture.js';
import { Learner } from './learner.js';
import { SCENARIOS, scenarioById, type Scenario } from './scenarios.js';
import { StubProvider } from './stub.js';
import type { CheckResult, Transcript, Turn } from './types.js';

/** Hard cap on tutor turns per scenario, whatever the script says (keeps runs small). */
export const MAX_TUTOR_TURNS = 16;

export function readRunEvents(vault: string, skip: number): ScaffoldEvent[] {
  const file = path.join(vault, 'Scaffold', '_system', 'events.jsonl');
  const out: ScaffoldEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(parseEvent(JSON.parse(line)));
    } catch {
      // a torn last line is ignored here; the server repairs it
    }
  }
  return out.slice(skip);
}

export interface ScenarioRun {
  transcript: Transcript;
  checks: CheckResult[];
  error?: string;
}

export async function runScenario(
  s: Scenario,
  providerName: 'claude' | 'codex' | 'stub',
  workRoot: string,
  log: (line: string) => void = () => {},
): Promise<ScenarioRun> {
  const dir = path.join(workRoot, providerName, s.id);
  rmSync(dir, { recursive: true, force: true });
  const vault = path.join(dir, 'vault');
  const fx = createFixtureVault(vault, s.fixture, path.join(dir, 'user-config.json'));
  let provider: Provider;
  if (providerName === 'stub') provider = new StubProvider(vault, s.focus);
  else {
    const exe = findExecutable(providerName);
    if (!exe)
      throw new Error(`${providerName} executable not found (set SCAFFOLD_${providerName.toUpperCase()})`);
    const wd = prepareWorkdir(dir, vault, providerName);
    provider = providerName === 'claude' ? new ClaudeProvider(exe, wd) : new CodexProvider(exe, wd);
  }
  const learner = new Learner(s.learner);
  const turns: Turn[] = [];
  let msg = learner.opening();
  let error: string | undefined;
  for (let i = 0; i < MAX_TUTOR_TURNS; i++) {
    turns.push({
      role: 'learner',
      text: msg.text,
      tools: [],
      ...(msg.answer ? { answer: true } : {}),
      ...(msg.switch_to ? { switch_to: msg.switch_to } : {}),
    });
    log(`  learner: ${msg.text}`);
    const r = await provider.turn(msg.text);
    const events = readRunEvents(vault, fx.events.length);
    turns.push({ role: 'tutor', text: r.text, tools: r.tools, events_after: events.length });
    log(
      `  tutor (${r.tools.map((c) => c.name).join(', ') || 'no tools'}): ${r.text.slice(0, 160).replace(/\s+/g, ' ')}`,
    );
    if (r.error) {
      error = r.error;
      log(`  error: ${r.error}`);
      break;
    }
    if (events.some((e) => e.type === 'session_ended' && !e.auto_closed) || learner.done) break;
    msg = learner.reply(r.text);
  }
  const transcript: Transcript = {
    provider: providerName === 'stub' ? 'manual' : providerName,
    scenario: s.id,
    turns,
    events: readRunEvents(vault, fx.events.length),
    kcs: fx.kcs,
    subjects: fx.subjects,
    questions: fx.questions,
    focus: s.focus,
  };
  return { transcript, checks: checkTranscript(transcript, s.checks), ...(error ? { error } : {}) };
}

/** Failed Scaffold tool calls in a transcript, for the report (a refused or failing tool explains most misses). */
export function toolErrors(t: Transcript): string[] {
  return t.turns.flatMap((turn, i) =>
    turn.tools.filter((c) => c.ok === false).map((c) => `turn ${i}: ${c.name} → ${c.error ?? 'failed'}`),
  );
}

export function report(
  provider: string,
  runs: { scenario: string; checks: CheckResult[]; error?: string; tool_errors?: string[] }[],
): { text: string; summary: Summary[] } {
  const summary = summarize(runs);
  const lines = [summaryTable(provider, summary), ''];
  const errors = runs.filter((r) => r.error);
  if (errors.length) lines.push('Errors:', ...errors.map((r) => `- [${r.scenario}] ${r.error}`), '');
  const tools = runs.flatMap((r) => (r.tool_errors ?? []).map((e) => `- [${r.scenario}] ${e}`));
  if (tools.length) lines.push('Tool errors:', ...tools, '');
  const failing = summary.filter((s) => !s.pass);
  for (const s of failing) lines.push(`Failures for ${s.id}:`, ...s.details.map((d) => `- ${d}`), '');
  lines.push(
    `Overall: ${failing.length === 0 && errors.length === 0 ? 'PASS' : 'FAIL'} (${runs.length} scenario(s))`,
  );
  return { text: lines.join('\n'), summary };
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv: string[]): Promise<number> {
  const scoreDir = arg(argv, '--score');
  if (scoreDir) {
    const files = readdirSync(scoreDir).filter((f) => f.endsWith('.transcript.json'));
    const byProvider = new Map<
      string,
      { scenario: string; checks: CheckResult[]; tool_errors: string[] }[]
    >();
    for (const f of files) {
      const t = JSON.parse(readFileSync(path.join(scoreDir, f), 'utf8')) as Transcript;
      const list = byProvider.get(t.provider) ?? [];
      list.push({
        scenario: t.scenario,
        checks: checkTranscript(t, scenarioById(t.scenario).checks),
        tool_errors: toolErrors(t),
      });
      byProvider.set(t.provider, list);
    }
    let failed = false;
    for (const [p, runs] of byProvider) {
      const r = report(p, runs);
      console.log(r.text, '\n');
      failed ||= r.text.includes('Overall: FAIL');
    }
    return failed ? 1 : 0;
  }
  const provider = (arg(argv, '--provider') ?? 'stub') as 'claude' | 'codex' | 'stub';
  if (!['claude', 'codex', 'stub'].includes(provider)) throw new Error(`unknown provider ${provider}`);
  const ids = arg(argv, '--scenarios');
  const scenarios = ids ? ids.split(',').map(scenarioById) : SCENARIOS;
  const runId = arg(argv, '--run') ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const workRoot = defaultWorkRoot(runId);
  const outDir = path.resolve('local', 'ped', runId); // gitignored (C7)
  if (argv.includes('--dry-run')) {
    for (const s of scenarios) {
      const dir = path.join(workRoot, provider, s.id);
      const vault = path.join(dir, 'vault');
      createFixtureVault(vault, s.fixture, path.join(dir, 'user-config.json'));
      if (provider !== 'stub') {
        const wd = prepareWorkdir(dir, vault, provider);
        const exe = findExecutable(provider) ?? `<${provider} not found>`;
        const p = provider === 'claude' ? new ClaudeProvider(exe, wd) : new CodexProvider(exe, wd);
        console.log(`${s.id}: ${exe} ${p.args().join(' ')}`);
      } else console.log(`${s.id}: ${dir}`);
    }
    return 0;
  }
  mkdirSync(outDir, { recursive: true });
  const runs: { scenario: string; checks: CheckResult[]; error?: string; tool_errors: string[] }[] = [];
  for (const s of scenarios) {
    console.log(`${provider} ${s.id}: ${s.title}`);
    const r = await runScenario(s, provider, workRoot, (l) => console.log(l));
    writeFileSync(
      path.join(outDir, `${provider}-${s.id}.transcript.json`),
      JSON.stringify(r.transcript, null, 2),
    );
    runs.push({
      scenario: s.id,
      checks: r.checks,
      tool_errors: toolErrors(r.transcript),
      ...(r.error ? { error: r.error } : {}),
    });
  }
  const r = report(provider, runs);
  writeFileSync(path.join(outDir, `${provider}-report.md`), `${r.text}\n`);
  console.log(`\n${r.text}\n\nTranscripts: ${outDir}`);
  return r.text.includes('Overall: FAIL') ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && existsSync(process.argv[1] ?? '')) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exit(2);
    },
  );
}
