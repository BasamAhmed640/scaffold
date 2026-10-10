import type { Command } from 'commander';
import type { CliContext } from './run.js';

// `scaffold grade …` and `scaffold q audit|spotcheck` (M8: V-GRADE, V-QQ). Owner tools; the sheets
// and results live in the vault under Scaffold/_system/audits/ (C7).

const int = (v: string): number => Number.parseInt(v, 10);

export function auditCommands(program: Command, ctx: CliContext): void {
  const grade = program.command('grade').description('Grading audit (V-GRADE)');
  grade
    .command('sample')
    .description('Write a blind labelling sheet of tutor-graded free-text answers')
    .option('--n <count>', 'answers to sample', int, 40)
    .option('--seed <text>', 'reproducible sample (default: today)')
    .action((o: { n: number; seed?: string }) =>
      ctx.tool('grade sample', 'grade_sample', { n: o.n, ...(o.seed ? { seed: o.seed } : {}) }),
    );
  grade
    .command('score <sheet>')
    .description("Cohen's κ per provider, confident-wrong recall and drift from your labels")
    .option('--apply', 'record your label as a grade override where it differs from the tutor')
    .action((sheet: string, o: { apply?: boolean }) =>
      ctx.tool('grade score', 'grade_score', { file: sheet, apply: !!o.apply }),
    );

  const q = program.commands.find((c) => c.name() === 'q')!;
  q.command('audit')
    .description('V-QQ: served questions passed lint and had an ok verdict when served')
    .action(() => ctx.tool('q audit', 'qq_audit', {}));
  q.command('spotcheck')
    .description('V-QQ: write the monthly spot-check sheet, or --score a marked one')
    .option('--n <count>', 'questions on the sheet', int, 10)
    .option('--seed <text>')
    .option('--score <sheet>', 'score a marked sheet')
    .action((o: { n: number; seed?: string; score?: string }) =>
      o.score
        ? ctx.tool('q spotcheck', 'qq_spotcheck_score', { file: o.score })
        : ctx.tool('q spotcheck', 'qq_spotcheck', { n: o.n, ...(o.seed ? { seed: o.seed } : {}) }),
    );
}
