import type { Warnings } from '../../envelope.js';
import type { AttemptEvent } from '../../schemas/events.js';
import { addDaysToDate, DAY_MS, localDate, ms } from '../../time.js';
import { round } from '../../util.js';
import { FOLDERS } from '../../vault/vault.js';
import type { Scaffold } from '../scaffold.js';

// D3.9: weekly calibration chart and Brier score in Learner/Weekly/<date>.md.

/** Confidence → stated probability of being right (DEFAULT, DECISIONS.md D-36). */
export const CONFIDENCE_P: Record<number, number> = { 1: 0.25, 2: 0.5, 3: 0.75, 4: 0.95 };

const outcome = (g: AttemptEvent['grade']): number => (g === 'correct' ? 1 : g === 'partial' ? 0.5 : 0);

export interface CalibrationRow {
  confidence: number;
  n: number;
  correct_rate: number | null;
  stated: number;
}

export function calibration(attempts: Pick<AttemptEvent, 'grade' | 'confidence'>[]): {
  rows: CalibrationRow[];
  brier: number | null;
  n: number;
} {
  const graded = attempts.filter((a) => a.grade !== 'unanswered' && a.confidence !== null);
  const rows: CalibrationRow[] = [1, 2, 3, 4].map((c) => {
    const at = graded.filter((a) => a.confidence === c);
    return {
      confidence: c,
      n: at.length,
      correct_rate: at.length ? round(at.reduce((s, a) => s + outcome(a.grade), 0) / at.length, 3) : null,
      stated: CONFIDENCE_P[c]!,
    };
  });
  const brier = graded.length
    ? round(
        graded.reduce((s, a) => s + (CONFIDENCE_P[a.confidence!]! - outcome(a.grade)) ** 2, 0) /
          graded.length,
        4,
      )
    : null;
  return { rows, brier, n: graded.length };
}

/** A small computed SVG: observed rate per confidence level against the stated probability. */
export function calibrationSvg(rows: CalibrationRow[], title: string): string {
  const W = 420;
  const H = 260;
  const L = 56;
  const R = 16;
  const T = 30;
  const B = 44;
  const pw = W - L - R;
  const ph = H - T - B;
  const x = (c: number): number => L + ((c - 0.5) / 4) * pw;
  const y = (p: number): number => T + (1 - p) * ph;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`,
    `<title id="t">${title}</title>`,
    `<desc id="d">Bars: share of answers that were right at each confidence level. Dots: the probability that confidence level states. Bars below dots mean overconfidence.</desc>`,
    `<style>.ax{stroke:#8a877d;stroke-width:1}.lb{font:12px sans-serif;fill:#5f5e5a}.bar{fill:#4a78b0}.st{fill:#b34a3b}@media (prefers-color-scheme:dark){.lb{fill:#c2c0b6}.bar{fill:#8fb6ea}.st{fill:#f08a7a}}</style>`,
    `<line class="ax" x1="${L}" y1="${T + ph}" x2="${L + pw}" y2="${T + ph}"/>`,
    `<line class="ax" x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}"/>`,
  );
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(
      `<text class="lb" x="${L - 8}" y="${y(p) + 4}" text-anchor="end">${Math.round(p * 100)}%</text>`,
    );
  }
  for (const r of rows) {
    const cx = x(r.confidence);
    if (r.correct_rate !== null) {
      parts.push(
        `<rect class="bar" x="${cx - 22}" y="${y(r.correct_rate)}" width="44" height="${T + ph - y(r.correct_rate)}"/>`,
      );
    }
    parts.push(`<circle class="st" cx="${cx}" cy="${y(r.stated)}" r="5"/>`);
    parts.push(
      `<text class="lb" x="${cx}" y="${T + ph + 18}" text-anchor="middle">${r.confidence} (n=${r.n})</text>`,
    );
  }
  parts.push(
    `<text class="lb" x="${L + pw / 2}" y="${H - 6}" text-anchor="middle">Confidence (1 guess … 4 certain)</text>`,
  );
  parts.push(
    `<text class="lb" x="14" y="${T + ph / 2}" text-anchor="middle" transform="rotate(-90 14 ${T + ph / 2})">Right</text>`,
  );
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}

export function weeklyReport(
  sc: Scaffold,
  date: string,
  w: Warnings,
): { note: string; chart: string; brier: number | null } {
  const end = sc.now().getTime();
  const start = end - 7 * DAY_MS;
  const all = sc.events().filter((e): e is AttemptEvent => e.type === 'attempt');
  const week = all.filter((a) => ms(a.ts) > start && ms(a.ts) <= end);
  const prev = all.filter((a) => ms(a.ts) > start - 7 * DAY_MS && ms(a.ts) <= start);
  const cal = calibration(week);
  const prevCal = calibration(prev);
  const facts = sc.facts();
  const derived = sc.derived();
  const chartRel = `${FOLDERS.weekly}/${date}-calibration.svg`;
  sc.vault.writeText(chartRel, calibrationSvg(cal.rows, `Calibration, week ending ${date}`));
  const sessions = Object.values(facts.sessions).filter(
    (s) => ms(s.started_ts) > start && ms(s.started_ts) <= end,
  );
  const lines: string[] = [
    '---',
    `week_ending: ${date}`,
    `brier: ${cal.brier ?? 'null'}`,
    `answers: ${cal.n}`,
    'cssclasses: [scaffold]',
    '---',
    '',
    `# Week ending ${date}`,
    '',
    '## Calibration',
    '',
    `![[${chartRel}]]`,
    '',
    '| Confidence | Answers | Right | Stated |',
    '|---|---|---|---|',
    ...cal.rows.map(
      (r) =>
        `| ${r.confidence} | ${r.n} | ${r.correct_rate === null ? '–' : `${Math.round(r.correct_rate * 100)}%`} | ${Math.round(r.stated * 100)}% |`,
    ),
    '',
    `Brier score: **${cal.brier ?? 'n/a'}** (0 is perfect; lower is better)${prevCal.brier !== null && cal.brier !== null ? `, previous week ${prevCal.brier} (${cal.brier <= prevCal.brier ? 'better or equal' : 'worse'})` : ''}.`,
    '',
    '## Subjects',
    '',
    '| Subject | Sessions | Solid | Fragile | Forgotten | Active misconceptions |',
    '|---|---|---|---|---|---|',
  ];
  for (const s of Object.values(facts.subjects).filter((x) => x.fields.scope === 'active')) {
    const kcs = Object.values(derived.kcs).filter((k) => k.subject === s.fields.id);
    const n = (st: string): number => kcs.filter((k) => k.status === st).length;
    const sess = sessions.filter((x) => x.focus_history.some((f) => f.subject === s.fields.id)).length;
    lines.push(
      `| ${s.fields.title} | ${sess} | ${n('solid')} | ${n('fragile')} | ${n('forgotten')} | ${kcs.filter((k) => k.misconception_active).length} |`,
    );
  }
  lines.push('', '## Anki', '', '_Anki metrics appear after the first `scaffold anki sync` (ANK-10)._', '');
  const hook = (sc.deps as { weeklyAnki?: (sc: Scaffold) => string[] }).weeklyAnki;
  if (hook) lines.splice(lines.length - 2, 1, ...hook(sc));
  const rel = `${FOLDERS.weekly}/${date}.md`;
  sc.vault.writeText(rel, lines.join('\n'));
  w.add(`Weekly report written: ${rel}`);
  return { note: rel, chart: chartRel, brier: cal.brier };
}

/** Writes a weekly report if none exists for the last 7 days (called from end_session). */
export function maybeWeeklyReport(sc: Scaffold, w: Warnings): string | null {
  const today = localDate(sc.now(), sc.tz());
  const existing = sc.vault
    .listMarkdown(FOLDERS.weekly)
    .map((p) => /(\d{4}-\d{2}-\d{2})\.md$/.exec(p)?.[1])
    .filter((d): d is string => !!d)
    .sort();
  const last = existing[existing.length - 1];
  if (last && last > addDaysToDate(today, -7)) return null;
  if (!last) {
    // first report once the learner has a week of history
    const first = Object.values(sc.facts().sessions)
      .map((s) => localDate(new Date(ms(s.started_ts)), sc.tz()))
      .sort()[0];
    if (!first || first > addDaysToDate(today, -6)) return null;
  }
  return weeklyReport(sc, today, w).note;
}
