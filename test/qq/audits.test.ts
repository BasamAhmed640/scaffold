import { afterAll, describe, expect, it } from 'vitest';
import { callTool } from '../../src/core/api/tools.js';
import { AUDITS_DIR, cohensKappa } from '../../src/core/service/ops/audits.js';
import type { Scaffold } from '../../src/core/service/scaffold.js';
import { questionEvent } from '../fixtures/standard.js';
import { LogBuilder } from '../helpers/builder.js';
import { Warnings } from '../../src/core/envelope.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import { cleanupAll, vaultFromEvents as fromEvents } from '../helpers/vault.js';

// M8 owner audits: V-GRADE (κ per provider, confident-wrong recall, drift, optional overrides) and
// V-QQ (served questions passed lint and had ok when served; monthly spot check).

afterAll(cleanupAll);

/** A vault from events, with question notes restored from the log (the bank is read from files). */
function vaultFromEvents(...a: Parameters<typeof fromEvents>) {
  const v = fromEvents(...a);
  rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
  return v;
}

const NOW = '2026-10-09T18:00:00-04:00';
type G = 'correct' | 'partial' | 'incorrect';

function log(opts: { claude?: number; openai?: number } = {}): LogBuilder {
  const b = new LogBuilder('2026-09-01T10:00:00-04:00');
  b.subject('si-pi').kc('kc-a', 'si-pi').kc('kc-b', 'si-pi');
  questionEvent(b, 'Q-0001', ['kc-a'], 'explain', 'Why does an open end reflect a step with the same sign?');
  b.session('S-2026-09-01-1', 'si-pi');
  const grades: G[] = ['correct', 'partial', 'incorrect'];
  const push = (grader: string, i: number, format = 'free'): void => {
    b.hours(1);
    b.push({
      type: 'attempt',
      session_id: 'S-2026-09-01-1',
      question_id: i % 2 ? 'Q-0001' : null,
      question_text: i % 2 ? null : `Improvised question ${i}: what happens at the far end?`,
      kc_ids: ['kc-a'],
      qtype: 'explain',
      format,
      answer_verbatim: `answer number ${i}`,
      grade: grades[i % 3],
      rubric_hits: [],
      evidence_quotes: [],
      confidence: (i % 4) + 1,
      hints_used: 0,
      assisted: false,
      grader,
      grader_uncertain: false,
      misconception_id: null,
      misconception_belief: null,
      step: null,
    });
  };
  for (let i = 0; i < (opts.claude ?? 30); i++) push('claude-desktop', i);
  for (let i = 0; i < (opts.openai ?? 20); i++) push('codex', 100 + i);
  // never sampled: code-graded formats, "I don't know", and non-tutor graders
  push('code', 900, 'numeric');
  push('claude-desktop', 901, 'mc');
  b.attempt('kc-b', 'unanswered', { conf: null });
  b.endSession('S-2026-09-01-1');
  return b;
}

async function call(sc: Scaffold, tool: string, input: Record<string, unknown> = {}) {
  const env = await callTool(sc, tool, input);
  return env as typeof env & { data: Record<string, unknown> };
}

/** Fills in `label::` lines: the tutor's grade unless `flip` says otherwise. */
function label(
  sc: Scaffold,
  sheet: string,
  flip: (item: { sample: string; family: string; tutor_grade: G; confidence: number | null }) => G | null,
) {
  const side = JSON.parse(sc.vault.readText(sheet.replace(/\.md$/, '.json'))!) as {
    items: { sample: string; family: string; tutor_grade: G; confidence: number | null }[];
  };
  let text = sc.vault.readText(sheet)!;
  for (const it of side.items) {
    const l = flip(it) ?? it.tutor_grade;
    text = text.replace(new RegExp(`(## ${it.sample}\\n[\\s\\S]*?)label:: \\n`), `$1label:: ${l}\n`);
  }
  sc.vault.writeText(sheet, text);
  return side.items;
}

describe("V-GRADE Cohen's κ", () => {
  it('matches hand-computed values', () => {
    const pairs: [string, string][] = [
      ...Array<[string, string]>(10).fill(['correct', 'correct']),
      ...Array<[string, string]>(5).fill(['partial', 'partial']),
      ...Array<[string, string]>(10).fill(['incorrect', 'incorrect']),
      ...Array<[string, string]>(3).fill(['correct', 'partial']),
      ...Array<[string, string]>(2).fill(['incorrect', 'correct']),
    ];
    // po = 25/30, pe = (13·12 + 5·8 + 12·10)/900 = 316/900 → κ = 0.743
    expect(cohensKappa(pairs)).toBe(0.743);
    expect(
      cohensKappa([
        ['correct', 'correct'],
        ['partial', 'partial'],
      ]),
    ).toBe(1);
    expect(
      cohensKappa([
        ['correct', 'correct'],
        ['correct', 'correct'],
      ]),
    ).toBe(1); // degenerate, all agree
    expect(
      cohensKappa([
        ['correct', 'partial'],
        ['partial', 'correct'],
      ]),
    ).toBe(-1);
    expect(cohensKappa([])).toBeNull();
  });
});

describe('V-GRADE sample and score', () => {
  it('samples a blind, balanced, reproducible sheet of tutor-graded free-text answers', async () => {
    const v = vaultFromEvents(log().events, NOW);
    const env = await call(v.sc, 'grade_sample', { n: 40, seed: 's1' });
    expect(env.ok).toBe(true);
    expect(env.data).toMatchObject({
      sheet: `${AUDITS_DIR}/grade-2026-10-09.md`,
      items: 40,
      by_family: { claude: 20, openai: 20 },
    });
    const md = v.sc.vault.readText(`${AUDITS_DIR}/grade-2026-10-09.md`)!;
    expect(md.match(/^## G-\d\d$/gm)).toHaveLength(40);
    expect(md.match(/^label:: $/gm)).toHaveLength(40);
    expect(md).not.toMatch(/claude-desktop|codex/); // blind: no grader, no tutor grade
    expect(md).toContain('**Key:** see rubric');
    expect(md).toContain('_(improvised in the session; judge from the question)_');
    const side = JSON.parse(v.sc.vault.readText(`${AUDITS_DIR}/grade-2026-10-09.json`)!) as {
      items: { attempt_id: string; grader: string }[];
    };
    expect(side.items.every((i) => i.grader !== 'code' && i.grader !== 'test')).toBe(true);
    // same seed, same sample
    const w = vaultFromEvents(log().events, NOW);
    await call(w.sc, 'grade_sample', { n: 40, seed: 's1' });
    const side2 = JSON.parse(w.sc.vault.readText(`${AUDITS_DIR}/grade-2026-10-09.json`)!) as typeof side;
    expect(side2.items.map((i) => i.attempt_id)).toEqual(side.items.map((i) => i.attempt_id));
    // a second sheet on the same day is refused; answers on an unscored sheet are not re-sampled
    expect((await call(v.sc, 'grade_sample', { n: 4 })).errors[0]!.code).toBe('sheet_exists');
    v.clock.set('2026-10-10T18:00:00-04:00');
    const next = await call(v.sc, 'grade_sample', { n: 40 });
    expect(next.data.items).toBe(10);
    expect(next.warnings.join(' ')).toMatch(/Only 10 answers/);
  });

  it('scores κ per provider, confident-wrong recall, history and drift; --apply records overrides', async () => {
    const v = vaultFromEvents(log().events, NOW);
    const sheet = (await call(v.sc, 'grade_sample', { n: 40, seed: 's2' })).data.sheet as string;
    // the owner disagrees on 2 claude items: two confident answers the tutor marked correct are wrong
    let flipped = 0;
    const items = label(v.sc, sheet, (it) =>
      it.family === 'claude' && it.tutor_grade === 'correct' && (it.confidence ?? 0) >= 3 && flipped++ < 2
        ? 'incorrect'
        : null,
    );
    expect(flipped).toBe(2);
    const env = await call(v.sc, 'grade_score', { file: sheet });
    expect(env.ok).toBe(true);
    const d = env.data as {
      per_family: Record<
        string,
        {
          n: number;
          kappa: number;
          confident_wrong: number;
          confident_wrong_recall: number;
          matrix: Record<string, Record<string, number>>;
        }
      >;
      overall: { confident_wrong_recall: number };
      pass: boolean;
      drift_since_last: unknown;
    };
    expect(d.per_family.openai).toMatchObject({ n: 20, kappa: 1 });
    expect(d.per_family.claude!.n).toBe(20);
    expect(d.per_family.claude!.kappa).toBeLessThan(1);
    expect(d.per_family.claude!.matrix.incorrect!.correct).toBe(2);
    const confWrong =
      items.filter((i) => i.tutor_grade === 'incorrect' && (i.confidence ?? 0) >= 3).length + 2;
    expect(d.overall.confident_wrong_recall).toBe(Math.round(((confWrong - 2) / confWrong) * 1000) / 1000);
    expect(d.pass).toBe(d.per_family.claude!.kappa >= 0.7 && d.overall.confident_wrong_recall >= 0.9);
    expect(d.drift_since_last).toBeNull();
    const hist = v.sc.vault.readText(`${AUDITS_DIR}/history.jsonl`)!.trim().split('\n');
    expect(hist).toHaveLength(1);
    // scoring again neither duplicates history nor overrides without --apply
    await call(v.sc, 'grade_score', { file: sheet });
    expect(v.sc.vault.readText(`${AUDITS_DIR}/history.jsonl`)!.trim().split('\n')).toHaveLength(1);
    expect(v.sc.vault.log.read().events.some((e) => e.type === 'grade_overridden')).toBe(false);
    const applied = await call(v.sc, 'grade_score', { file: sheet, apply: true });
    expect(applied.data.overrides).toHaveLength(2);
    const ov = v.sc.vault.log.read().events.filter((e) => e.type === 'grade_overridden');
    expect(ov.map((e) => (e as { by: string }).by)).toEqual(['owner', 'owner']);
    // a later audit reports drift against this one
    v.clock.set('2026-11-09T18:00:00-05:00');
    const s2 = (await call(v.sc, 'grade_sample', { n: 10 })).data.sheet as string;
    label(v.sc, s2, () => null);
    const second = await call(v.sc, 'grade_score', { file: s2 });
    expect(second.data.drift_since_last).toMatchObject({ claude: expect.any(Number) });
  });

  it('unlabelled items are left out with a warning; nothing labelled is an error; paths stay in the vault', async () => {
    const v = vaultFromEvents(log({ claude: 6, openai: 0 }).events, NOW);
    const sheet = (await call(v.sc, 'grade_sample', { n: 6 })).data.sheet as string;
    expect((await call(v.sc, 'grade_score', { file: sheet })).errors[0]!.code).toBe('no_labels');
    let k = 0;
    label(v.sc, sheet, (it) => (k++ < 3 ? it.tutor_grade : null));
    let text = v.sc.vault.readText(sheet)!;
    // leave the last three blank again
    const side = JSON.parse(v.sc.vault.readText(sheet.replace(/\.md$/, '.json'))!) as {
      items: { sample: string }[];
    };
    for (const it of side.items.slice(3))
      text = text.replace(new RegExp(`(## ${it.sample}\\n[\\s\\S]*?label:: )\\w+`), '$1');
    v.sc.vault.writeText(sheet, text);
    const env = await call(v.sc, 'grade_score', { file: sheet });
    expect(env.data.labelled).toBe(3);
    expect(env.warnings.join(' ')).toMatch(/Not labelled/);
    expect(env.warnings.join(' ')).toMatch(/No openai|recall is not measured|No confident-wrong/);
    expect((await call(v.sc, 'grade_score', { file: '../../outside.md' })).ok).toBe(false);
  });
});

describe('V-QQ', () => {
  function qqLog(): LogBuilder {
    const b = new LogBuilder('2026-09-01T10:00:00-04:00');
    b.subject('si-pi').kc('kc-a', 'si-pi');
    questionEvent(
      b,
      'Q-0001',
      ['kc-a'],
      'explain',
      'Why does an open end reflect a step with the same sign?',
    );
    questionEvent(
      b,
      'Q-0002',
      ['kc-a'],
      'predict',
      'Predict the voltage at a shorted far end after one TD.',
      { verdict: 'pending' },
    );
    questionEvent(b, 'Q-0003', ['kc-a'], 'apply', 'A 75 Ω load on a 50 Ω line: compute Γ.');
    b.session('S-2026-09-01-1', 'si-pi');
    b.attempt('kc-a', 'correct', { q: 'Q-0001' });
    b.attempt('kc-a', 'partial', { q: 'Q-0002' }); // served before it was reviewed
    b.endSession('S-2026-09-01-1');
    b.days(1).push({
      type: 'question_reviewed',
      question_id: 'Q-0002',
      verdict: 'ok',
      by: 'codex',
      notes: '',
    });
    return b;
  }

  it('q audit: served questions must pass lint and have been ok when served (QB-03, QB-04)', async () => {
    const v = vaultFromEvents(qqLog().events, NOW);
    const env = await call(v.sc, 'qq_audit');
    expect(env.data).toMatchObject({
      served_questions: 2,
      lint_pass_pct: 100,
      ok_when_served_pct: 50,
      pass: false,
    });
    expect(
      (env.data.violations as { id: string; not_ok_when_served: number }[]).map((x) => [
        x.id,
        x.not_ok_when_served,
      ]),
    ).toEqual([['Q-0002', 1]]);
  });

  it('spot check: a sheet with folded keys and hints, scored against 9 of 10', async () => {
    const v = vaultFromEvents(qqLog().events, NOW);
    const sheet = (await call(v.sc, 'qq_spotcheck', { n: 10 })).data.sheet as string;
    expect(sheet).toBe(`${AUDITS_DIR}/qq-2026-10-09.md`);
    let md = v.sc.vault.readText(sheet)!;
    expect(md.match(/^## Q-\d{4}$/gm)).toHaveLength(3);
    expect(md).toContain('> [!note]- Key and rubric');
    expect(md).toContain('> [!note]- Hints');
    // answered questions come first (less to spoil)
    expect(md.indexOf('## Q-0001')).toBeLessThan(md.indexOf('## Q-0003'));
    md = md
      .replace(/acceptable:: \n/g, 'acceptable:: yes\n')
      .replace(/(## Q-0003[\s\S]*?)acceptable:: yes\nissue:: /, '$1acceptable:: no\nissue:: ambiguous units');
    v.sc.vault.writeText(sheet, md);
    const env = await call(v.sc, 'qq_spotcheck_score', { file: sheet });
    expect(env.data).toMatchObject({
      marked: 3,
      acceptable: 2,
      pass: false,
      issues: [{ id: 'Q-0003', issue: 'ambiguous units' }],
    });
    expect(v.sc.vault.readText(`${AUDITS_DIR}/history.jsonl`)).toContain('"kind":"qq"');
  });

  it('owner audits are CLI-only (they show keys); the review queue is on MCP (QB-04)', async () => {
    const { allTools } = await import('../../src/core/api/tools.js');
    const t = Object.fromEntries(allTools().map((x) => [x.name, x]));
    for (const n of ['grade_sample', 'grade_score', 'qq_audit', 'qq_spotcheck', 'qq_spotcheck_score'])
      expect(t[n]!.cliOnly, n).toBe(true);
    expect(t.list_pending_reviews!.cliOnly).toBeFalsy();
    const v = vaultFromEvents(qqLog().events, NOW);
    const env = await call(v.sc, 'list_pending_reviews');
    expect(env.data.pending).toEqual([]); // Q-0002 was reviewed ok afterwards
  });
});
