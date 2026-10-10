// Headless cross-review job (QB-04, AD-06). Usage:
//   tsx scripts/jobs/cross-review.ts --provider codex|claude [--vault <path>] [--limit 10] [--dry-run]
// One bounded turn of the other model family over the questions waiting for it: no model call when
// nothing is waiting (ARC-11), never during a tutoring session, never a retry (REL-04, ARC-10).
// It uses the owner's subscription, so the owner starts it. The log goes to local/jobs/ (C7).
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pendingReviews } from '../../src/core/service/ops/questions.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { resolveVault } from '../../src/core/vault/paths.js';
import {
  ClaudeProvider,
  CodexProvider,
  findExecutable,
  prepareWorkdir,
  type Provider,
} from '../ped/drivers.js';

export type JobProvider = 'claude' | 'codex';
export const FAMILY: Record<JobProvider, 'claude' | 'openai'> = { claude: 'claude', codex: 'openai' };
/** The reviewer recorded on each verdict (`by`); its family must differ from the author's. */
export const REVIEWER: Record<JobProvider, string> = { claude: 'claude-code', codex: 'codex' };

export function reviewPrompt(ids: string[], by: string, family: string): string {
  return [
    `Batch job: cross-review (references/batch-jobs.md, section 1). You are "${by}" (model family ${family}).`,
    `Review exactly these questions, one at a time: ${ids.join(', ')}.`,
    'For each: call review_question {question_id} to read it, check it against the QB-01 checklist item by item, solve it yourself from the stem alone, then call review_question {question_id, verdict: "ok" | "fix" | "reject", by: "' +
      by +
      '", notes}. Notes: one short line per problem; for "ok", say in one line how you solved it.',
    'Do not call any other write tool, do not talk to a learner, and do not change files.',
    'Finish with one line per question: id, verdict, main reason.',
  ].join('\n');
}

export interface JobResult {
  family: string;
  asked: string[];
  reviewed: { question_id: string; verdict: string }[];
  missing: string[];
  skipped_reason: string | null;
  model_text: string;
  error: string | null;
}

export async function runCrossReview(opts: {
  vault: string;
  provider: JobProvider;
  limit?: number;
  dryRun?: boolean;
  /** Builds the front-end for a prepared work dir (tests inject an in-process fake). */
  makeProvider?: (vault: string) => Provider;
}): Promise<JobResult> {
  const family = FAMILY[opts.provider];
  const by = REVIEWER[opts.provider];
  const sc = Scaffold.open(opts.vault);
  const base: JobResult = {
    family,
    asked: [],
    reviewed: [],
    missing: [],
    skipped_reason: null,
    model_text: '',
    error: null,
  };
  if (sc.openSession())
    return { ...base, skipped_reason: 'a tutoring session is open; reviews happen outside sessions (TP-08)' };
  const ids = pendingReviews(sc)
    .filter((p) => p.reviewer_family === family)
    .map((p) => p.id)
    .slice(0, opts.limit ?? 10);
  if (!ids.length)
    return { ...base, skipped_reason: `nothing is waiting for review by the ${family} family` };
  if (opts.dryRun) return { ...base, asked: ids, skipped_reason: 'dry run' };
  const before = sc.vault.log.read().events.length;
  let provider: Provider;
  if (opts.makeProvider) provider = opts.makeProvider(opts.vault);
  else {
    const exe = findExecutable(opts.provider);
    if (!exe) return { ...base, asked: ids, error: `${opts.provider} executable not found` };
    const dir = path.join(os.tmpdir(), 'scaffold-jobs', `cross-review-${Date.now()}`);
    const wd = prepareWorkdir(dir, opts.vault, opts.provider);
    provider = opts.provider === 'claude' ? new ClaudeProvider(exe, wd) : new CodexProvider(exe, wd);
  }
  const r = await provider.turn(reviewPrompt(ids, by, family));
  const after = Scaffold.open(opts.vault).vault.log.read().events.slice(before);
  const reviewed = after
    .filter((e) => e.type === 'question_reviewed' && ids.includes(e.question_id))
    .map((e) => ({
      question_id: (e as { question_id: string }).question_id,
      verdict: (e as { verdict: string }).verdict,
    }));
  return {
    ...base,
    asked: ids,
    reviewed,
    missing: ids.filter((id) => !reviewed.some((x) => x.question_id === id)),
    model_text: r.text,
    error: r.error ?? null,
  };
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

async function main(argv: string[]): Promise<number> {
  const provider = arg(argv, '--provider') as JobProvider | undefined;
  if (provider !== 'claude' && provider !== 'codex') {
    console.error(
      'Usage: tsx scripts/jobs/cross-review.ts --provider codex|claude [--vault <path>] [--limit 10] [--dry-run]',
    );
    return 2;
  }
  const vault = resolveVault({ flag: arg(argv, '--vault'), env: process.env }).vault;
  const limit = Number(arg(argv, '--limit') ?? 10);
  const r = await runCrossReview({ vault, provider, limit, dryRun: argv.includes('--dry-run') });
  const lines = [
    `Cross-review by ${REVIEWER[provider]} (${r.family})`,
    r.skipped_reason ? `Skipped: ${r.skipped_reason}${r.asked.length ? ` (${r.asked.join(', ')})` : ''}` : '',
    ...r.reviewed.map((x) => `- ${x.question_id}: ${x.verdict}`),
    r.missing.length ? `Not reviewed: ${r.missing.join(', ')}` : '',
    r.error ? `Error: ${r.error}` : '',
  ].filter(Boolean);
  console.log(lines.join('\n'));
  if (r.asked.length && !r.skipped_reason) {
    const out = path.resolve('local', 'jobs'); // gitignored (C7)
    mkdirSync(out, { recursive: true });
    const file = path.join(
      out,
      `cross-review-${provider}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
    );
    writeFileSync(file, `${lines.join('\n')}\n\n## Model output\n\n${r.model_text}\n`);
    console.log(`Log: ${file}`);
  }
  return r.error || r.missing.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error((e as Error).message);
      process.exit(1);
    },
  );
}
