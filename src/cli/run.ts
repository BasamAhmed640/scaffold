import { readFileSync } from 'node:fs';
import { Command, CommanderError, Option } from 'commander';
import { callTool } from '../core/api/tools.js';
import { fail, guard, ScaffoldError, type Envelope } from '../core/envelope.js';
import { lintBank, getQuestionFull, pendingReviews } from '../core/service/ops/questions.js';
import { listConcepts } from '../core/service/ops/learner.js';
import { doctorFix } from '../core/service/ops/maintenance.js';
import { weeklyReport } from '../core/service/ops/reports.js';
import { Scaffold } from '../core/service/scaffold.js';
import { FakeClock, localDate, systemClock } from '../core/time.js';
import { initVault } from '../core/vault/init.js';
import { resolveVault } from '../core/vault/paths.js';
import { formatHuman } from './format.js';
import { ankiCommands } from './anki.js';
import { visualCommands } from './visual.js';
import { auditCommands } from './audit.js';

// The `scaffold` CLI (IF-01): the same functions as the MCP server. Human output by default,
// `--json` for agents. Never prompts; every failure is one line plus a next step (REL-03).

export interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
}

export interface Globals {
  vault?: string;
  json?: boolean;
  now?: string;
  tz?: string;
}

export interface CliContext {
  io: CliIO;
  globals: () => Globals;
  open: () => Scaffold;
  emit: (command: string, env: Envelope<unknown>) => void;
  run: (
    command: string,
    fn: (sc: Scaffold) => Promise<Envelope<unknown>> | Envelope<unknown>,
  ) => Promise<void>;
  tool: (command: string, name: string, input: unknown) => Promise<void>;
}

const VERSION = '0.1.0';

function readJsonArg(file?: string, inline?: string): unknown {
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      throw new ScaffoldError('invalid_json', '--input is not valid JSON.');
    }
  }
  if (file) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new ScaffoldError('invalid_json', `Could not read JSON from ${file}: ${(e as Error).message}`);
    }
  }
  return undefined;
}

const num = (v: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ScaffoldError('invalid_number', `"${v}" is not a number.`);
  return n;
};
const collect = (v: string, prev: string[] = []): string[] => [...prev, v];

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let exitCode = 0;
  const program = new Command();
  program
    .name('scaffold')
    .description('Scaffold: an evidence-based tutor’s learner model, planner and vault tools.')
    .version(VERSION)
    .option('--vault <path>', 'Obsidian vault folder (overrides SCAFFOLD_VAULT and the user config)')
    .option('--json', 'print the {ok, data, warnings, errors} envelope as JSON')
    .addOption(new Option('--now <iso>', 'fake clock (tests)').hideHelp())
    .addOption(new Option('--tz <zone>', 'IANA time zone override (tests)').hideHelp())
    .exitOverride()
    .configureOutput({
      writeOut: (s) => io.stdout(s.replace(/\n$/, '')),
      writeErr: (s) => io.stderr(s.replace(/\n$/, '')),
    })
    .showHelpAfterError(false);

  const globals = (): Globals => program.opts<Globals>();
  const ctx: CliContext = {
    io,
    globals,
    open: () => {
      const g = globals();
      const r = resolveVault({ flag: g.vault, env: io.env });
      const now = g.now ?? io.env.SCAFFOLD_NOW;
      const tz = g.tz ?? io.env.SCAFFOLD_TZ;
      return Scaffold.open(r.vault, {
        clock: now ? new FakeClock(now) : systemClock,
        ...(tz ? { timezone: tz } : {}),
      });
    },
    emit: (command, env) => {
      if (!env.ok) exitCode = 1;
      if (globals().json) io.stdout(JSON.stringify(env, null, 2));
      else io.stdout(formatHuman(command, env));
    },
    run: async (command, fn) => {
      let env: Envelope<unknown>;
      try {
        env = await fn(ctx.open());
      } catch (e) {
        env =
          e instanceof ScaffoldError
            ? fail(e.toIssue())
            : fail({ code: 'internal_error', message: (e as Error).message });
      }
      ctx.emit(command, env);
    },
    tool: (command, name, input) => ctx.run(command, (sc) => callTool(sc, name, input)),
  };

  program
    .command('init <vault>')
    .description('Create Scaffold/ in an Obsidian vault from the template (never overwrites) (VLT-04)')
    .option('--set-default', 'make this the default vault in the user config')
    .action(async (vault: string, o: { setDefault?: boolean }) => {
      ctx.emit('init', await guard(() => initVault(vault, { setDefault: !!o.setDefault, env: io.env })));
    });

  program
    .command('doctor')
    .description('Check vault health; each failure prints one next step')
    .option('--fix', 'repair what can be repaired safely (torn event-log line)')
    .action(async (o: { fix?: boolean }) => {
      let sc: Scaffold;
      try {
        sc = ctx.open();
      } catch (e) {
        const issue =
          e instanceof ScaffoldError ? e : new ScaffoldError('internal_error', (e as Error).message);
        ctx.emit('doctor', {
          ok: false,
          data: { checks: [{ id: 'vault', ok: false, message: issue.message, next_step: issue.next_step }] },
          warnings: [],
          errors: [issue.toIssue()],
        });
        return;
      }
      if (o.fix) {
        const fixed = doctorFix(sc);
        for (const f of fixed) io.stderr(`fixed: ${f}`);
      }
      const env = await callTool(sc, 'doctor', {});
      if (
        env.ok &&
        (env.data as { checks: { ok: boolean; warn?: boolean }[] }).checks.some((c) => !c.ok && !c.warn)
      )
        env.ok = false;
      ctx.emit('doctor', env);
    });

  const planOpts = (c: Command): Command =>
    c
      .option('--focus <subject>', 'subject id, title or alias; "all" for a mixed review day')
      .option('--minutes <n>', 'session length in minutes', num)
      .option('--carryover <n>', 'carry-over checks from other subjects (0–2)', num);
  const planInput = (o: { focus?: string; minutes?: number; carryover?: number }) => ({
    ...(o.focus ? { focus: o.focus } : {}),
    ...(o.minutes !== undefined ? { minutes: o.minutes } : {}),
    ...(o.carryover !== undefined ? { carryover: o.carryover } : {}),
  });

  planOpts(
    program.command('briefing').description('Start-of-session briefing, at most 600 tokens (LM-11)'),
  ).action((o) => ctx.tool('briefing', 'get_briefing', planInput(o)));
  planOpts(program.command('plan').description('Deterministic session plan (LM-10)')).action((o) =>
    ctx.tool('plan', 'plan_session', planInput(o)),
  );

  const session = program.command('session').description('Start or end a tutoring session');
  planOpts(
    session.command('start').description('Resolve the focus, record it with the plan, print the briefing'),
  ).action((o) => ctx.tool('session start', 'start_session', planInput(o)));
  session
    .command('end')
    .description('End the open session and write its log (TP-15)')
    .requiredOption('--summary <text>', 'what we did')
    .requiredOption('--next <text>', 'one-line preview of next time')
    .option('--thread <text>', 'open thread (repeatable)', collect, [])
    .action((o: { summary: string; next: string; thread: string[] }) =>
      ctx.tool('session end', 'end_session', {
        summary: o.summary,
        next_preview: o.next,
        open_threads: o.thread,
      }),
    );

  const subject = program.command('subject').description('Subjects (LM-14)');
  subject
    .command('add <title>')
    .description('Create a subject and its Anki deck')
    .option('--id <slug>')
    .option('--alias <name>', 'alias (repeatable)', collect, [])
    .option('--goal <text>', 'goal (repeatable)', collect, [])
    .option('--anki-minutes <n|auto>')
    .action((title: string, o: { id?: string; alias: string[]; goal: string[]; ankiMinutes?: string }) =>
      ctx.tool('subject add', 'upsert_subject', {
        title,
        ...(o.id ? { id: o.id } : {}),
        aliases: o.alias,
        goals: o.goal,
        ...(o.ankiMinutes ? { anki_minutes: o.ankiMinutes === 'auto' ? 'auto' : num(o.ankiMinutes) } : {}),
      }),
    );
  subject
    .command('list')
    .description('Subjects with due counts')
    .action(() => ctx.tool('subject list', 'list_subjects', {}));
  subject
    .command('get <id>')
    .description('One subject')
    .action((id: string) =>
      ctx.run('subject get', async (sc) => {
        const env = await callTool(sc, 'list_subjects', {});
        if (!env.ok) return env;
        const s = (env.data as { subjects: { id: string }[] }).subjects.find((x) => x.id === id);
        return s
          ? { ...env, data: s }
          : fail({
              code: 'unknown_subject',
              message: `No subject ${id}.`,
              next_step: 'Run `scaffold subject list`.',
            });
      }),
    );

  const kc = program.command('kc').description('Concepts (knowledge components)');
  kc.command('add')
    .description('Create concepts from a JSON file ({concepts: [...]}) or flags')
    .option('--file <json>')
    .option('--id <id>')
    .option('--title <title>')
    .option('--subject <id>')
    .option('--prereq <id>', 'prerequisite (repeatable)', collect, [])
    .option('--confusable <id>', 'confusable KC (repeatable)', collect, [])
    .option('--requires-visual')
    .action(
      (o: {
        file?: string;
        id?: string;
        title?: string;
        subject?: string;
        prereq: string[];
        confusable: string[];
        requiresVisual?: boolean;
      }) =>
        ctx.run('kc add', async (sc) => {
          const fromFile = readJsonArg(o.file);
          const input = fromFile ?? {
            concepts: [
              {
                id: o.id,
                title: o.title,
                subject: o.subject,
                prerequisites: o.prereq,
                confusable_with: o.confusable,
                requires_visual: !!o.requiresVisual,
              },
            ],
          };
          return callTool(sc, 'upsert_concept', input);
        }),
    );
  kc.command('update <id>')
    .description('Update a concept’s fields (merges with the current ones)')
    .option('--title <title>')
    .option('--prereq <id>', 'replace prerequisites (repeatable)', collect)
    .option('--confusable <id>', 'replace confusables (repeatable)', collect)
    .option('--volatility <v>')
    .option('--review-by <date>')
    .action(
      (
        id: string,
        o: {
          title?: string;
          prereq?: string[];
          confusable?: string[];
          volatility?: string;
          reviewBy?: string;
        },
      ) =>
        ctx.run('kc update', async (sc) => {
          const cur = sc.facts().kcs[id]?.fields;
          if (!cur) return fail({ code: 'unknown_kc', message: `Unknown KC ${id}.` });
          return callTool(sc, 'upsert_concept', {
            concepts: [
              {
                ...cur,
                ...(o.title ? { title: o.title } : {}),
                ...(o.prereq ? { prerequisites: o.prereq } : {}),
                ...(o.confusable ? { confusable_with: o.confusable } : {}),
                ...(o.volatility ? { volatility: o.volatility } : {}),
                ...(o.reviewBy ? { review_by: o.reviewBy } : {}),
              },
            ],
          });
        }),
    );
  kc.command('get <id>')
    .description('One concept')
    .action((id: string) => ctx.tool('kc get', 'get_concept', { kc_id: id }));
  kc.command('list')
    .description('Concepts with status')
    .option('--subject <id>')
    .option('--status <status>')
    .action((o: { subject?: string; status?: string }) =>
      ctx.run('kc list', async (sc) =>
        guard((w) =>
          listConcepts(
            sc,
            { ...(o.subject ? { subject: o.subject } : {}), ...(o.status ? { status: o.status } : {}) },
            w,
          ),
        ),
      ),
    );
  kc.command('taught <ids...>')
    .description('Log that KCs were explained')
    .option('--visual <id>', 'visual shown (repeatable)', collect, [])
    .action((ids: string[], o: { visual: string[] }) =>
      ctx.tool('kc taught', 'mark_taught', { kc_ids: ids, visual_ids: o.visual }),
    );
  kc.command('teachback <id>')
    .description('Save a teach-back to "In my words" (D3.8)')
    .requiredOption('--text <text>')
    .action((id: string, o: { text: string }) =>
      ctx.tool('kc teachback', 'save_teach_back', { kc_id: id, text: o.text }),
    );

  const q = program.command('q').description('Question bank (QB-01 … QB-05)');
  q.command('add')
    .description('Add a question from JSON')
    .requiredOption('--file <json>')
    .action((o: { file: string }) =>
      ctx.run('q add', async (sc) => callTool(sc, 'add_question', readJsonArg(o.file))),
    );
  q.command('get <id>')
    .description('Full question including key (owner use; not an MCP tool)')
    .action((id: string) =>
      ctx.run('q get', async (sc) => guard(() => getQuestionFull(sc, { question_id: id }))),
    );
  q.command('next')
    .description('Stems only: never keys or hints (QB-05)')
    .option('--step <step>')
    .option('--kc <id>', 'KC (repeatable)', collect)
    .option('--id <id>', 'question id (repeatable)', collect)
    .option('--limit <n>', 'max items', num)
    .action((o: { step?: string; kc?: string[]; id?: string[]; limit?: number }) =>
      ctx.tool('q next', 'next_questions', {
        ...(o.step ? { step: o.step } : {}),
        ...(o.kc ? { kc_ids: o.kc } : {}),
        ...(o.id ? { question_ids: o.id } : {}),
        ...(o.limit ? { limit: o.limit } : {}),
      }),
    );
  q.command('lint')
    .description('QB-03 lint over the bank')
    .action(() => ctx.run('q lint', async (sc) => guard((w) => lintBank(sc, {}, w))));
  q.command('review [id]')
    .description(
      'Cross-model review (QB-04); without a verdict prints the question; --pending lists the queue',
    )
    .option('--verdict <v>', 'ok | fix | reject')
    .option('--by <frontend>', 'reviewer, e.g. codex')
    .option('--notes <text>')
    .option('--pending')
    .action(
      (id: string | undefined, o: { verdict?: string; by?: string; notes?: string; pending?: boolean }) => {
        if (o.pending || !id)
          return ctx.run('q review', async (sc) => guard(() => ({ pending: pendingReviews(sc) })));
        return ctx.tool('q review', 'review_question', {
          question_id: id,
          ...(o.verdict ? { verdict: o.verdict } : {}),
          ...(o.by ? { by: o.by } : {}),
          ...(o.notes ? { notes: o.notes } : {}),
        });
      },
    );
  q.command('key <id>')
    .description('Grading key, after the learner answered (TP-08); logged')
    .requiredOption('--answer <text>', 'the learner’s verbatim answer (or "skipped")')
    .action((id: string, o: { answer: string }) =>
      ctx.tool('q key', 'get_grading_key', { question_id: id, answer_verbatim: o.answer }),
    );
  q.command('hint <id> <level>')
    .description('Hint H1–H4; logged')
    .action((id: string, level: string) =>
      ctx.tool('q hint', 'get_hint', { question_id: id, level: num(level) }),
    );

  const attempt = program.command('attempt').description('Answers');
  attempt
    .command('record')
    .description('Record an assessed answer (TP-07); JSON file or flags')
    .option('--file <json>')
    .option('--question <id>')
    .option('--text <stem>', 'improvised question text')
    .option('--kc <id>', 'KC (repeatable, improvised questions)', collect)
    .option('--qtype <t>')
    .option('--answer <text>')
    .option('--grade <g>')
    .option('--confidence <n>', '1–4', num)
    .option('--grader <frontend>', 'who graded', 'cli')
    .option('--hit <rubricId>', 'rubric point hit (repeatable)', collect, [])
    .option('--quote <text>', 'evidence quote (repeatable)', collect, [])
    .option('--belief <text>', 'the wrong belief, as a proposition')
    .option('--step <step>')
    .action((o: Record<string, unknown>) =>
      ctx.run('attempt record', async (sc) => {
        const fromFile = readJsonArg(o.file as string | undefined);
        if (fromFile) return callTool(sc, 'record_attempt', fromFile);
        return callTool(sc, 'record_attempt', {
          ...(o.question ? { question_id: o.question } : {}),
          ...(o.text ? { question_text: o.text } : {}),
          ...(o.kc ? { kc_ids: o.kc } : {}),
          ...(o.qtype ? { qtype: o.qtype } : {}),
          answer_verbatim: o.answer,
          ...(o.grade ? { grade: o.grade } : {}),
          ...(o.confidence !== undefined ? { confidence: o.confidence } : {}),
          grader: o.grader,
          rubric_hits: o.hit,
          evidence_quotes: o.quote,
          ...(o.belief ? { misconception_belief: o.belief } : {}),
          ...(o.step ? { step: o.step } : {}),
        });
      }),
    );
  attempt
    .command('override <attemptId>')
    .description('Correct a recorded grade (logged)')
    .requiredOption('--grade <g>')
    .requiredOption('--reason <text>')
    .action((id: string, o: { grade: string; reason: string }) =>
      ctx.tool('attempt override', 'override_grade', {
        attempt_id: id,
        grade: o.grade,
        reason: o.reason,
        by: 'owner',
      }),
    );

  const mc = program.command('mc').description('Misconceptions');
  mc.command('list')
    .option('--subject <id>')
    .option('--state <s>', 'candidate | open | resolved | all')
    .action((o: { subject?: string; state?: string }) =>
      ctx.tool('mc list', 'list_misconceptions', {
        ...(o.subject ? { subject: o.subject } : {}),
        ...(o.state ? { state: o.state } : {}),
      }),
    );
  mc.command('open')
    .requiredOption('--kc <id>', 'KC (repeatable)', collect)
    .requiredOption('--belief <text>')
    .option('--by <who>', 'who observed it', 'owner')
    .action((o: { kc: string[]; belief: string; by: string }) =>
      ctx.tool('mc open', 'open_misconception', { kc_ids: o.kc, belief: o.belief, by: o.by }),
    );

  program
    .command('rebuild')
    .description('Recompute every derived field from events.jsonl (ARC-08)')
    .option('--restore-missing', 'recreate deleted notes from event snapshots')
    .action((o: { restoreMissing?: boolean }) =>
      ctx.tool('rebuild', 'rebuild', { restore_missing: !!o.restoreMissing }),
    );
  program
    .command('validate')
    .description('Check the concept DAG, notes and questions (LM-12)')
    .action(() => ctx.tool('validate', 'validate', {}));
  program
    .command('dashboard')
    .description('Per-subject summary (status counts, due, misconceptions)')
    .action(() => ctx.tool('subject list', 'list_subjects', {}));
  program
    .command('report <kind>')
    .description('Write a report: weekly (D3.9)')
    .action((kind: string) =>
      ctx.run('report', async (sc) =>
        guard((w) => {
          if (kind !== 'weekly')
            throw new ScaffoldError(
              'unknown_report',
              `Unknown report "${kind}".`,
              'Use `scaffold report weekly`.',
            );
          return weeklyReport(sc, localDate(sc.now(), sc.tz()), w);
        }),
      ),
    );
  program
    .command('call <tool>')
    .description('Call any tool by its MCP name with JSON input (for agents, e.g. pi)')
    .option('--input <json>')
    .option('--file <json>')
    .action((tool: string, o: { input?: string; file?: string }) =>
      ctx.run(`call ${tool}`, async (sc) => callTool(sc, tool, readJsonArg(o.file, o.input) ?? {})),
    );

  ankiCommands(program, ctx);
  visualCommands(program, ctx);
  auditCommands(program, ctx);

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (e instanceof CommanderError) {
      if (
        e.code === 'commander.helpDisplayed' ||
        e.code === 'commander.version' ||
        e.code === 'commander.help'
      )
        return 0;
      return 2;
    }
    io.stderr(`✗ ${(e as Error).message}`);
    return 1;
  }
  return exitCode;
}
