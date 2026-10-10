import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { providerFamily } from '../../schemas/common.js';
import type { AttemptEvent, ScaffoldEvent } from '../../schemas/events.js';
import { localDate } from '../../time.js';
import { FOLDERS } from '../../vault/vault.js';
import { loadBank } from '../bank.js';
import type { Scaffold } from '../scaffold.js';
import { lintQuestion } from '../../questions/lint.js';
import { ankiTextByKc } from './anki-hooks.js';
import { overrideGrade } from './attempts.js';

// M8 owner audits. V-GRADE: the owner labels a blind sample of free-text answers; Cohen's κ per
// provider family against the tutor's grades, recall of confident-wrong answers, drift between
// audits. V-QQ: served bank questions passed lint and had an `ok` cross-model verdict when served
// (QB-03, QB-04); a monthly spot check of 10 questions against QB-01. Sheets and results stay in the
// vault (`Scaffold/_system/audits/`), never in the repo (C7). These are CLI-only owner tools: they
// show keys, which must never reach a tutor through MCP (TP-08).

export const AUDITS_DIR = `${FOLDERS.system}/audits`;
const GRADES = ['correct', 'partial', 'incorrect'] as const;
type Label = (typeof GRADES)[number];
type Family = 'claude' | 'openai';

/** Deterministic PRNG (mulberry32) from a string seed, so a sample can be reproduced. */
function rng(seed: string): () => number {
  let a = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const attempts = (sc: Scaffold): AttemptEvent[] =>
  sc.vault.log.read().events.filter((e): e is AttemptEvent => e.type === 'attempt');

/** A vault path given absolute or vault-relative, confined to the vault (IF-03). */
function vaultFile(sc: Scaffold, file: string): string {
  const rel = /^([a-zA-Z]:[\\/]|\/)/.test(file) ? sc.vault.rel(file) : file.replace(/\\/g, '/');
  if (!sc.vault.exists(rel)) throw new ScaffoldError('file_missing', `${rel} does not exist.`);
  return rel;
}

/** `key:: value` fields (Obsidian inline fields) in a block of text. */
function fields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^([a-z_]+)::[ \t]*(.*)$/gm)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** Splits a sheet into `## <id>` blocks. */
function blocks(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = text.replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  for (const p of parts) out.set(p.slice(0, p.indexOf('\n')).trim(), p);
  return out;
}

const quote = (s: string): string =>
  s
    .trim()
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join('\n');

// ---- V-GRADE ----------------------------------------------------------------------------------

export const GradeSampleInput = z.object({
  n: z.number().int().min(4).max(200).default(40),
  seed: z.string().max(60).optional(),
});

interface SampleItem {
  sample: string;
  attempt_id: string;
  family: Family;
  grader: string;
  tutor_grade: Label;
  confidence: number | null;
}

interface History {
  kind: 'grade' | 'qq';
  date: string;
  file: string;
  attempt_ids?: string[];
  [k: string]: unknown;
}

function readHistory(sc: Scaffold): History[] {
  const text = sc.vault.readText(`${AUDITS_DIR}/history.jsonl`) ?? '';
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as History];
      } catch {
        return [];
      }
    });
}

function appendHistory(sc: Scaffold, h: History): void {
  const rel = `${AUDITS_DIR}/history.jsonl`;
  sc.vault.writeText(rel, `${sc.vault.readText(rel) ?? ''}${JSON.stringify(h)}\n`);
}

/** Writes a blind labelling sheet of tutor-graded free-text answers not audited before. */
export function gradeSample(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = GradeSampleInput.parse(raw);
  const date = localDate(sc.now(), sc.tz());
  const seed = input.seed ?? date;
  const audited = new Set(readHistory(sc).flatMap((h) => (h.kind === 'grade' ? (h.attempt_ids ?? []) : [])));
  const pending = new Set(
    (sc.vault.listMarkdown(AUDITS_DIR) ?? [])
      .filter((p) => /\/grade-[\d-]+\.md$/.test(p))
      .flatMap((p) => {
        const side = sc.vault.readText(p.replace(/\.md$/, '.json'));
        return side ? (JSON.parse(side) as { items: SampleItem[] }).items.map((i) => i.attempt_id) : [];
      }),
  );
  const candidates = attempts(sc).filter((a) => {
    const fam = providerFamily(a.grader);
    return (
      (a.format === 'free' || a.format === 'visual') &&
      a.grade !== 'unanswered' &&
      fam !== 'other' &&
      !audited.has(a.id) &&
      !pending.has(a.id)
    );
  });
  if (!candidates.length)
    throw new ScaffoldError(
      'nothing_to_sample',
      'No tutor-graded free-text answers that have not been audited yet.',
      'Run it again after more sessions.',
    );
  const r = rng(seed);
  const byFamily = new Map<Family, AttemptEvent[]>();
  for (const a of shuffle(candidates, r)) {
    const f = providerFamily(a.grader) as Family;
    byFamily.set(f, [...(byFamily.get(f) ?? []), a]);
  }
  // balanced across the families present, the remainder from whichever has more
  const fams = [...byFamily.keys()].sort();
  const picked: AttemptEvent[] = [];
  const quota = Math.ceil(input.n / fams.length);
  for (const f of fams) picked.push(...byFamily.get(f)!.slice(0, quota));
  for (const f of fams)
    for (const a of byFamily.get(f)!.slice(quota)) if (picked.length < input.n) picked.push(a);
  const sample = shuffle(picked.slice(0, input.n), r);
  if (sample.length < input.n)
    w.add(
      `Only ${sample.length} answer${sample.length === 1 ? ' is' : 's are'} available (asked for ${input.n}).`,
    );
  for (const f of ['claude', 'openai'] as const)
    if (!byFamily.has(f)) w.add(`No ${f} answers to sample: κ for that provider cannot be computed yet.`);

  const bank = new Map(loadBank(sc).entries.map((e) => [e.question.id, e.question]));
  const items: SampleItem[] = [];
  const lines = [
    '---',
    'kind: grade-audit',
    `created: ${date}`,
    `items: ${sample.length}`,
    '---',
    '',
    `# Grade audit ${date} (V-GRADE)`,
    '',
    'Label each answer `correct`, `partial` or `incorrect` against the key and rubric, as a careful grader would. The tutor’s grades are hidden until you score: `scaffold grade score <this file>`.',
    '',
  ];
  sample.forEach((a, i) => {
    const id = `G-${String(i + 1).padStart(2, '0')}`;
    items.push({
      sample: id,
      attempt_id: a.id,
      family: providerFamily(a.grader) as Family,
      grader: a.grader,
      tutor_grade: a.grade as Label,
      confidence: a.confidence,
    });
    const q = a.question_id ? bank.get(a.question_id) : undefined;
    lines.push(
      `## ${id}`,
      '',
      `**Question** (${a.qtype}, ${a.kc_ids.join(', ')}):`,
      '',
      quote(q?.stem ?? a.question_text ?? '(question text missing)'),
      '',
    );
    if (q) {
      lines.push(`**Key:** ${q.answer_key}`, '');
      if (q.rubric.length)
        lines.push('**Rubric:**', '', ...q.rubric.map((x) => `- ${x.id}: ${x.proposition}`), '');
    } else lines.push('**Key:** _(improvised in the session; judge from the question)_', '');
    lines.push(
      `**Answer** (confidence ${a.confidence ?? '–'}${a.hints_used ? `, ${a.hints_used} hints` : ''}):`,
      '',
      quote(a.answer_verbatim || '(empty)'),
      '',
      'label:: ',
      'note:: ',
      '',
    );
  });
  const rel = `${AUDITS_DIR}/grade-${date}.md`;
  if (sc.vault.exists(rel))
    throw new ScaffoldError(
      'sheet_exists',
      `${rel} already exists.`,
      'Score it first, or delete it by hand.',
    );
  sc.vault.writeText(rel, lines.join('\n'));
  sc.vault.writeText(
    rel.replace(/\.md$/, '.json'),
    JSON.stringify({ created: date, seed, items }, null, 2) + '\n',
  );
  return {
    sheet: rel,
    items: sample.length,
    by_family: Object.fromEntries(fams.map((f) => [f, items.filter((i) => i.family === f).length])),
    next_step: `Label every answer in ${rel}, then run \`scaffold grade score ${rel}\`.`,
  };
}

/** Cohen's κ for paired labels over a fixed category set. */
export function cohensKappa(pairs: [string, string][], cats: readonly string[] = GRADES): number | null {
  const n = pairs.length;
  if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  let pe = 0;
  for (const c of cats)
    pe += (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n);
  if (pe === 1) return po === 1 ? 1 : 0;
  return Math.round(((po - pe) / (1 - pe)) * 1000) / 1000;
}

export const GradeScoreInput = z.object({
  file: z.string().min(3).max(400),
  apply: z.boolean().default(false),
});

const KAPPA_MIN = 0.7;
const RECALL_MIN = 0.9;

export function gradeScore(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = GradeScoreInput.parse(raw);
  const rel = vaultFile(sc, input.file);
  const side = sc.vault.readText(rel.replace(/\.md$/, '.json'));
  if (!side) throw new ScaffoldError('sample_missing', `${rel.replace(/\.md$/, '.json')} is missing.`);
  const meta = JSON.parse(side) as { created: string; items: SampleItem[] };
  const sheet = blocks(sc.vault.readText(rel)!);
  const rows: (SampleItem & { owner: Label })[] = [];
  const unlabelled: string[] = [];
  for (const it of meta.items) {
    const label = (fields(sheet.get(it.sample) ?? '').label ?? '').toLowerCase() as Label;
    if (GRADES.includes(label)) rows.push({ ...it, owner: label });
    else unlabelled.push(it.sample);
  }
  if (unlabelled.length) w.add(`Not labelled (left out): ${unlabelled.join(', ')}.`);
  if (!rows.length)
    throw new ScaffoldError('no_labels', 'No item has a label (correct, partial or incorrect).');

  const stats = (rs: typeof rows) => {
    const confWrong = rs.filter((r) => r.owner === 'incorrect' && (r.confidence ?? 0) >= 3);
    const caught = confWrong.filter((r) => r.tutor_grade === 'incorrect').length;
    const matrix: Record<string, Record<string, number>> = {};
    for (const o of GRADES) matrix[o] = Object.fromEntries(GRADES.map((t) => [t, 0]));
    for (const r of rs) matrix[r.owner]![r.tutor_grade]! += 1;
    return {
      n: rs.length,
      agreement: Math.round((rs.filter((r) => r.owner === r.tutor_grade).length / rs.length) * 1000) / 1000,
      kappa: cohensKappa(rs.map((r) => [r.owner, r.tutor_grade])),
      confident_wrong: confWrong.length,
      confident_wrong_recall: confWrong.length ? Math.round((caught / confWrong.length) * 1000) / 1000 : null,
      /** owner label (rows) × tutor grade (columns) */
      matrix,
    };
  };
  const families = [...new Set(rows.map((r) => r.family))].sort();
  const per_family = Object.fromEntries(families.map((f) => [f, stats(rows.filter((r) => r.family === f))]));
  const overall = stats(rows);
  const pass =
    families.length > 0 &&
    families.every((f) => (per_family[f]!.kappa ?? 0) >= KAPPA_MIN) &&
    overall.confident_wrong_recall !== null &&
    overall.confident_wrong_recall >= RECALL_MIN;
  if (overall.confident_wrong_recall === null)
    w.add(
      'No confident-wrong answers in the sample (owner: incorrect, confidence ≥ 3): recall is not measured.',
    );

  const prev = readHistory(sc)
    .filter((h) => h.kind === 'grade')
    .at(-1) as (History & { per_family: Record<string, { kappa: number | null }> }) | undefined;
  const drift = prev
    ? Object.fromEntries(
        families.map((f) => {
          const was = prev.per_family[f]?.kappa;
          const now = per_family[f]!.kappa;
          return [f, was == null || now == null ? null : Math.round((now - was) * 1000) / 1000];
        }),
      )
    : null;

  const overrides: { attempt_id: string; from: string; to: string }[] = [];
  if (input.apply)
    for (const r of rows.filter((x) => x.owner !== x.tutor_grade)) {
      overrideGrade(
        sc,
        {
          attempt_id: r.attempt_id,
          grade: r.owner,
          by: 'owner',
          reason: `V-GRADE audit ${meta.created}: owner label`,
        },
        w,
      );
      overrides.push({ attempt_id: r.attempt_id, from: r.tutor_grade, to: r.owner });
    }
  const scored = readHistory(sc).some((h) => h.kind === 'grade' && h.file === rel);
  if (!scored)
    appendHistory(sc, {
      kind: 'grade',
      date: localDate(sc.now(), sc.tz()),
      file: rel,
      attempt_ids: rows.map((r) => r.attempt_id),
      per_family: Object.fromEntries(
        families.map((f) => [f, { n: per_family[f]!.n, kappa: per_family[f]!.kappa }]),
      ),
      confident_wrong_recall: overall.confident_wrong_recall,
      pass,
    });
  return {
    sheet: rel,
    labelled: rows.length,
    per_family,
    overall,
    targets: { kappa_min: KAPPA_MIN, confident_wrong_recall_min: RECALL_MIN },
    pass,
    drift_since_last: drift,
    overrides,
  };
}

// ---- V-QQ -------------------------------------------------------------------------------------

/** QB-03/QB-04 over what was actually served: each bank question used in an attempt passes lint now and had `ok` when served. */
export function qqAudit(sc: Scaffold) {
  const events = sc.vault.log.read().events;
  const bank = new Map(loadBank(sc).entries.map((e) => [e.question.id, e.question]));
  const anki = ankiTextByKc(sc);
  const verdictAt = (qid: string, ts: string): string => {
    let v = 'pending';
    for (const e of events as ScaffoldEvent[])
      if (e.type === 'question_reviewed' && e.question_id === qid && e.ts <= ts) v = e.verdict;
    return v;
  };
  const served = new Map<string, { first_served: string; times: number; not_ok_when_served: number }>();
  for (const a of attempts(sc)) {
    if (!a.question_id) continue;
    const s = served.get(a.question_id) ?? { first_served: a.ts, times: 0, not_ok_when_served: 0 };
    s.times++;
    if (verdictAt(a.question_id, a.ts) !== 'ok') s.not_ok_when_served++;
    served.set(a.question_id, s);
  }
  const rows = [...served].map(([id, s]) => {
    const q = bank.get(id);
    const lint = q ? lintQuestion(q, { ankiText: anki[q.kc_ids[0]!] ?? [] }) : null;
    return {
      id,
      ...s,
      lint_ok: lint?.ok ?? false,
      lint_errors: lint?.errors ?? ['not in the bank any more'],
      verdict_now: sc.facts().questions[id]?.verdict ?? 'pending',
    };
  });
  const n = rows.length;
  const pct = (k: number): number => (n ? Math.round((k / n) * 1000) / 10 : 100);
  const lintPass = rows.filter((r) => r.lint_ok).length;
  const okServed = rows.filter((r) => r.not_ok_when_served === 0).length;
  return {
    served_questions: n,
    lint_pass_pct: pct(lintPass),
    ok_when_served_pct: pct(okServed),
    pass: lintPass === n && okServed === n,
    violations: rows.filter((r) => !r.lint_ok || r.not_ok_when_served > 0),
  };
}

export const SpotCheckInput = z.object({
  n: z.number().int().min(1).max(50).default(10),
  seed: z.string().max(60).optional(),
});

/**
 * The owner's monthly spot check (V-QQ): reviewed `ok` questions, preferring ones already answered
 * (less to spoil). Keys and hints sit in collapsed callouts so the owner can choose what to see.
 */
export function spotCheckSheet(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = SpotCheckInput.parse(raw);
  const date = localDate(sc.now(), sc.tz());
  const facts = sc.facts();
  const ok = loadBank(sc)
    .entries.map((e) => e.question)
    .filter((q) => facts.questions[q.id]?.verdict === 'ok');
  if (!ok.length) throw new ScaffoldError('nothing_to_check', 'No reviewed (ok) questions in the bank yet.');
  const used = new Set(Object.values(facts.attempts).map((a) => a.question_id));
  const r = rng(input.seed ?? `qq-${date}`);
  const pick = [
    ...shuffle(
      ok.filter((q) => used.has(q.id)),
      r,
    ),
    ...shuffle(
      ok.filter((q) => !used.has(q.id)),
      r,
    ),
  ].slice(0, input.n);
  if (pick.length < input.n)
    w.add(
      `Only ${pick.length} ok question${pick.length === 1 ? ' is' : 's are'} available (asked for ${input.n}).`,
    );
  const lines = [
    '---',
    'kind: question-spot-check',
    `created: ${date}`,
    `items: ${pick.length}`,
    '---',
    '',
    `# Question spot check ${date} (V-QQ)`,
    '',
    'For each question set `acceptable:: yes` or `acceptable:: no` against QB-01 (one KC, production, key and rubric, unambiguous, no leak, worded unlike the Anki cards, four-step hints, answerable in one message). Keys and hints are folded so you can skip them for questions you have not answered yet. Then run `scaffold q spotcheck --score <this file>`.',
    '',
  ];
  for (const q of pick) {
    lines.push(
      `## ${q.id}`,
      '',
      `${q.qtype} · ${q.format} · difficulty ${q.difficulty} · ${q.kc_ids.join(', ')}`,
      '',
      quote(q.stem),
      '',
    );
    if (q.options?.length) lines.push(...q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`), '');
    lines.push(
      '> [!note]- Key and rubric',
      `> ${q.answer_key}`,
      ...q.rubric.map((x) => `> - ${x.id}: ${x.proposition}`),
      '',
      '> [!note]- Hints',
      ...q.hints.map((h, i) => `> H${i + 1}. ${h}`),
      '',
      'acceptable:: ',
      'issue:: ',
      '',
    );
  }
  const rel = `${AUDITS_DIR}/qq-${date}.md`;
  if (sc.vault.exists(rel))
    throw new ScaffoldError(
      'sheet_exists',
      `${rel} already exists.`,
      'Score it first, or delete it by hand.',
    );
  sc.vault.writeText(rel, lines.join('\n'));
  return {
    sheet: rel,
    items: pick.length,
    next_step: `Mark each question, then \`scaffold q spotcheck --score ${rel}\`.`,
  };
}

export const SpotScoreInput = z.object({ file: z.string().min(3).max(400) });

export function spotCheckScore(sc: Scaffold, raw: unknown, w: Warnings) {
  const { file } = SpotScoreInput.parse(raw);
  const rel = vaultFile(sc, file);
  const sheet = blocks(sc.vault.readText(rel)!);
  const results = [...sheet].map(([id, block]) => {
    const f = fields(block);
    const v = (f.acceptable ?? '').toLowerCase();
    return { id, acceptable: v === 'yes' ? true : v === 'no' ? false : null, issue: f.issue ?? '' };
  });
  const marked = results.filter((x) => x.acceptable !== null);
  const missing = results.filter((x) => x.acceptable === null).map((x) => x.id);
  if (!marked.length)
    throw new ScaffoldError('no_marks', 'No question is marked `acceptable:: yes` or `acceptable:: no`.');
  if (missing.length) w.add(`Not marked (left out): ${missing.join(', ')}.`);
  const accepted = marked.filter((x) => x.acceptable).length;
  const target = Math.ceil(0.9 * marked.length);
  const pass = accepted >= target;
  if (!readHistory(sc).some((h) => h.kind === 'qq' && h.file === rel))
    appendHistory(sc, {
      kind: 'qq',
      date: localDate(sc.now(), sc.tz()),
      file: rel,
      marked: marked.length,
      accepted,
      pass,
    });
  return {
    sheet: rel,
    marked: marked.length,
    acceptable: accepted,
    target: `at least ${target} of ${marked.length}`,
    pass,
    issues: marked.filter((x) => !x.acceptable).map((x) => ({ id: x.id, issue: x.issue })),
  };
}
