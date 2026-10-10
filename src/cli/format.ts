import type { Envelope } from '../core/envelope.js';

// Human-readable output (default). `--json` prints the raw envelope for agents (IF-02).

type Data = Record<string, unknown>;
const isObj = (v: unknown): v is Data => typeof v === 'object' && v !== null && !Array.isArray(v);

function yamlish(v: unknown, indent = ''): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    return v
      .map((x) =>
        isObj(x) || Array.isArray(x)
          ? `\n${indent}- ${yamlish(x, indent + '  ').trimStart()}`
          : `\n${indent}- ${String(x)}`,
      )
      .join('');
  }
  if (isObj(v)) {
    const entries = Object.entries(v);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, x]) => {
        const inner =
          isObj(x) || Array.isArray(x) ? yamlish(x, indent + '  ') : ` ${x === null ? '–' : String(x)}`;
        return `\n${indent}${k}:${inner.startsWith('\n') ? inner : inner}`;
      })
      .join('');
  }
  return String(v);
}

const formatters: Record<string, (d: Data) => string> = {
  doctor: (d) =>
    (d.checks as { ok: boolean; message: string; next_step?: string; warn?: boolean }[])
      .map(
        (c) =>
          `${c.ok ? '✓' : c.warn ? '!' : '✗'} ${c.message}${!c.ok && c.next_step ? `\n    → ${c.next_step}` : ''}`,
      )
      .join('\n'),
  plan: (d) => formatPlan((d.plan ?? d) as Data) + (d.change ? `\n${String(d.change)}` : ''),
  briefing: (d) => formatBriefing(d),
  'session start': (d) =>
    `Session ${String(d.session_id)}${d.resumed ? ' (resumed)' : ''}\n${formatBriefing(d.briefing as Data)}${d.next_step ? `\n→ ${String(d.next_step)}` : ''}`,
  'session end': (d) =>
    `Ended ${String(d.session_id)} · ${String(d.answers_recorded)} answers\n${String(d.calibration)}\nNext: ${String(d.next_preview)}\nLog: ${String(d.log)}`,
  'subject list': (d) =>
    table(
      ['id', 'title', 'scope', 'kcs', 'due', 'solid', 'forgotten', 'last'],
      (d.subjects as Data[]).map((s) => [
        s.id,
        s.title,
        s.scope,
        s.kcs,
        s.due,
        s.solid,
        s.forgotten,
        s.last_session ?? '–',
      ]),
    ),
  'kc list': (d) =>
    table(
      ['id', 'status', 'R', 'mis', 'check', 'title'],
      (d.concepts as Data[]).map((k) => [
        k.id,
        k.status,
        k.R === null ? '–' : Number(k.R).toFixed(2),
        k.misconception_active ? 'yes' : '',
        k.needs_check ? 'yes' : '',
        k.title,
      ]),
    ),
  'mc list': (d) =>
    table(
      ['id', 'state', 'since', 'kcs', 'belief'],
      (d.misconceptions as Data[]).map((m) => [
        m.id,
        m.state,
        m.since ?? '–',
        (m.kc_ids as string[]).join(','),
        m.belief,
      ]),
    ),
  'anki status': (d) => {
    const rows = (d.subjects as Data[]).map((s) => [
      s.subject,
      s.scope,
      `${String(s.measured_min_7d)}/${String(s.budget_min)}${s.over_budget ? ' !' : ''}`,
      s.estimated_min,
      s.active_cards,
      `${String((s.intake as Data).used)}/${String((s.intake as Data).budget)}`,
      s.recommended_new_per_day || '–',
    ]);
    const m = d.maintenance as Data;
    const limits = Object.entries(d.deck_limits as Record<string, Data>).map(
      ([deck, l]) =>
        `  ${deck}: ${String(l.new_per_day ?? l.new_per_day_this_deck)} new/day${l.max_reviews_per_day ? `, ${String(l.max_reviews_per_day)} reviews/day` : ''}`,
    );
    return [
      table(['subject', 'scope', 'min/day (7d)/budget', 'est', 'active', 'intake', 'new/day'], rows),
      `Maintenance (paused/closed subjects): ${String(m.estimated_min)} min/day, ${String(m.active_cards)} active cards`,
      `Total: ${String((d.total as Data).measured_min_7d)} of ${String(d.total_budget_min)} min/day · ${String(d.queued_operations)} queued · last sync ${String(d.synced_at ?? 'never')}`,
      'Recommended Anki deck limits:',
      ...limits,
    ].join('\n');
  },
  'anki stack': (d) =>
    `${String(d.search)}\n${String(d.matching_cards)} card(s) match now.\n${String(d.instructions)}`,
  'anki actions list': (d) =>
    (d.actions as Data[]).length
      ? table(
          ['id', 'kind', 'subject', 'notes', 'reason'],
          (d.actions as Data[]).map((a) => [
            a.action_id,
            a.kind,
            a.subject ?? '–',
            (a.note_ids as number[]).length || '',
            a.reason,
          ]),
        )
      : 'No card actions waiting for approval.',
  'q lint': (d) =>
    `${String(d.passing)}/${String(d.total)} questions pass QB-03.` +
    (d.failing as { id: string; errors: string[] }[])
      .map((f) => `\n✗ ${f.id}: ${f.errors.join(' | ')}`)
      .join(''),
};

function table(head: string[], rows: unknown[][]): string {
  const cells = [head, ...rows.map((r) => r.map((c) => String(c ?? '')))];
  const widths = head.map((_, i) => Math.min(48, Math.max(...cells.map((r) => (r[i] ?? '').length))));
  return cells
    .map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.slice(0, 48).padEnd(widths[i]!))).join('  '))
    .join('\n');
}

function formatPlan(p: Data): string {
  const focus = p.focus as Data;
  const lines = [
    `Plan: ${String(focus.subject)} (${String(focus.why)}) · ${String(p.minutes_planned)}/${String(p.minutes_requested)} min${p.status === 'intake_required' ? ' · INTAKE REQUIRED' : ''}`,
  ];
  for (const s of (p.steps as Data[]) ?? []) {
    lines.push(`  ${String(s.step)} (${String(s.minutes)} min)`);
    for (const i of s.items as Data[])
      lines.push(
        `    - ${String(i.kc)}${i.question_id ? ` [${String(i.question_id)}]` : ' [improvise]'}: ${String(i.why)}`,
      );
  }
  for (const t of (p.trimmed as string[]) ?? []) lines.push(`  trimmed: ${t}`);
  for (const n of (p.notes as string[]) ?? []) lines.push(`  note: ${n}`);
  return lines.join('\n');
}

function formatBriefing(b: Data): string {
  const f = b.focus as Data;
  const lines = [`Focus: ${String(f.subject)} (${String(f.why)})`];
  const last = b.last_session as Data | null;
  if (last)
    lines.push(
      `Last time (${String(last.date)}): ${String(last.summary)}${(last.open_threads as string[]).length ? ` · open: ${(last.open_threads as string[]).join('; ')}` : ''}`,
    );
  const due = b.due as Data[];
  if (due.length) lines.push(`Due: ${due.map((d) => `${String(d.kc)} (${String(d.why)})`).join(', ')}`);
  const mis = b.misconceptions as Data[];
  if (mis.length)
    lines.push(`Misconceptions: ${mis.map((m) => `${String(m.id)} "${String(m.belief)}"`).join('; ')}`);
  for (const s of b.plan as Data[])
    lines.push(`  ${String(s.step)} ${String(s.minutes)} min: ${(s.kcs as string[]).join(', ')}`);
  for (const o of b.other_subjects as Data[])
    lines.push(
      `Other: ${String(o.subject)} · due ${String(o.due)} · forgotten ${String(o.forgotten)} · last ${String(o.last_session ?? '–')}`,
    );
  const anki = b.anki as Data | null;
  if (anki?.subject) {
    const s = anki.subject as Data;
    lines.push(
      `Anki: ${String(s.min_7d)}/${String(s.budget_min)} min/day · ${String(s.active_cards)} active · intake ${String(s.intake_year)}`,
    );
  }
  for (const w of b.warnings as string[]) lines.push(`! ${w}`);
  return lines.join('\n');
}

export function formatHuman(command: string, env: Envelope<unknown>): string {
  const out: string[] = [];
  if (env.ok) {
    const fmt = formatters[command];
    out.push(fmt && isObj(env.data) ? fmt(env.data) : yamlish(env.data).replace(/^\n/, ''));
  } else {
    for (const e of env.errors)
      out.push(`✗ ${e.message}${e.next_step ? `\n  → ${e.next_step}` : ''} [${e.code}]`);
  }
  for (const w of env.warnings) out.push(`! ${w}`);
  return out.join('\n');
}
