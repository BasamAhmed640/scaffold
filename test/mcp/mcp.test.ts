import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Warnings } from '../../src/core/envelope.js';
import { loadBank } from '../../src/core/service/bank.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import type { Scaffold } from '../../src/core/service/scaffold.js';
import { normalize } from '../helpers/cli.js';
import { MockAnki } from '../helpers/anki-mock.js';
import { ADMISSION, ankiLog, seedCard } from '../helpers/anki-vault.js';
import { connectMcp, type McpHandle } from '../helpers/mcp.js';
import { cleanupAll, tempDir, vaultFromEvents } from '../helpers/vault.js';
import { FIXTURE_NOW, standardFixture } from '../fixtures/standard.js';

// V-MCP: tool list and JSON Schemas validate; every tool is called through a real MCP client;
// path traversal and oversized inputs are rejected (IF-03); p95 latency < 500 ms; no key or hint
// text in next_questions (QB-05).

let mcp: McpHandle;
let vault = '';
let sc: Scaffold;
const latencies: number[] = [];

async function g(name: string, tool: string, args: Record<string, unknown> = {}) {
  const r = await mcp.call(tool, args);
  called.add(tool);
  latencies.push(r.ms);
  expect(Object.keys(r.env).sort()).toEqual(['data', 'errors', 'ok', 'warnings']);
  expect(r.isError).toBe(!r.env.ok);
  await expect(JSON.stringify(normalize(r.env, vault), null, 2)).toMatchFileSnapshot(
    `../golden/mcp/${name}.json`,
  );
  return r.env;
}

beforeAll(async () => {
  const v = vaultFromEvents(standardFixture().events, FIXTURE_NOW, { name: 'MCP Vault' });
  rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
  vault = v.root;
  sc = v.sc;
  mcp = await connectMcp({ vault });
}, 60_000);

afterAll(async () => {
  await mcp?.close();
  cleanupAll();
});

const EXPECTED_TOOLS = [
  'doctor',
  'get_briefing',
  'plan_session',
  'start_session',
  'end_session',
  'upsert_subject',
  'list_subjects',
  'get_concept',
  'upsert_concept',
  'next_questions',
  'add_question',
  'review_question',
  'get_grading_key',
  'get_hint',
  'record_attempt',
  'mark_taught',
  'save_teach_back',
  'override_grade',
  'list_misconceptions',
  'open_misconception',
  'validate',
  'anki_sync',
  'get_anki_load',
  'propose_cards',
  'propose_card_actions',
  'apply_card_actions',
  'list_card_actions',
  'flag_card',
  'set_subject_scope',
  'anki_stack',
  'register_visual',
  'check_visual',
  'get_visual',
];

/** Every tool name called through a real client in this file (V-MCP: all of them). */
const called = new Set<string>();

describe('V-MCP tool list', () => {
  it('lists the tools with valid JSON Schemas', async () => {
    const { tools } = await mcp.client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of EXPECTED_TOOLS) expect(names).toContain(n);
    expect(names).not.toContain('rebuild'); // CLI-only
    const ajv = new Ajv({ strict: false });
    for (const t of tools) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(() => ajv.compile(t.inputSchema), t.name).not.toThrow();
      expect(t.description!.length, t.name).toBeGreaterThan(20);
    }
    await expect(
      JSON.stringify(
        tools.map((t) => ({ name: t.name, readOnly: t.annotations?.readOnlyHint ?? false })),
        null,
        2,
      ),
    ).toMatchFileSnapshot('../golden/mcp/tools.json');
  });
});

describe('V-MCP every tool through a real client', () => {
  it('reads: doctor, list_subjects, get_concept, get_briefing, list_misconceptions, validate', async () => {
    expect((await g('doctor', 'doctor')).ok).toBe(true);
    await g('list_subjects', 'list_subjects');
    await g('get_concept', 'get_concept', { kc_id: 'kc-si-reflection-coefficient' });
    await g('get_briefing', 'get_briefing', { focus: 'signal integrity' });
    await g('list_misconceptions', 'list_misconceptions', { state: 'open' });
    await g('validate', 'validate');
  });

  it('a session: start, next_questions, get_hint, get_grading_key, record_attempt, mark_taught, plan_session, end_session', async () => {
    const start = await g('start_session', 'start_session', { focus: 'SI/PI' });
    expect((start.data as { session_id: string }).session_id).toBe('S-2026-10-09-1');
    const next = await g('next_questions', 'next_questions', { step: 'warmup' });
    // QB-05: no key or hint text anywhere in next_questions output
    const text = JSON.stringify(next);
    for (const { question } of loadBank(sc).entries) {
      for (const secret of [
        question.answer_key,
        ...question.hints,
        ...question.rubric.map((r) => r.proposition),
      ]) {
        if (secret.length >= 4) expect(text, `${question.id} leaks "${secret}"`).not.toContain(secret);
      }
    }
    await g('get_hint', 'get_hint', { question_id: 'Q-0004', level: 2 });
    await g('get_grading_key', 'get_grading_key', {
      question_id: 'Q-0004',
      answer_verbatim: 'About 1.5 ns for 30 cm',
    });
    await g('record_attempt', 'record_attempt', {
      question_id: 'Q-0004',
      answer_verbatim: 'About 1.5 ns for 30 cm',
      grade: 'correct',
      confidence: 3,
      grader: 'claude-desktop',
      rubric_hits: ['R1'],
      evidence_quotes: ['1.5 ns for 30 cm'],
      step: 'warmup',
    });
    await g('record_attempt_unanswered', 'record_attempt', {
      question_text: 'In one sentence: what does T measure?',
      kc_ids: ['kc-si-transmission-coefficient'],
      qtype: 'recall',
      answer_verbatim: 'no idea',
      grader: 'claude-desktop',
      step: 'warmup',
    });
    await g('record_attempt_misconception', 'record_attempt', {
      question_text: 'A 50 Ω line ends in a short. What is Γ at the far end?',
      kc_ids: ['kc-si-reflection-coefficient'],
      qtype: 'predict',
      answer_verbatim: 'Zero, because the line is 50 ohms',
      grade: 'incorrect',
      confidence: 4,
      grader: 'claude-desktop',
      misconception_id: 'M-0001',
      step: 'repair',
    });
    await g('mark_taught', 'mark_taught', { kc_ids: ['kc-si-lattice-diagram'] });
    await g('plan_session', 'plan_session', { focus: 'music theory', minutes: 20 });
    await g('end_session', 'end_session', {
      summary: 'Warm-up and a repair attempt; switched to music theory at the end.',
      next_preview: 'Intervals from scratch.',
      open_threads: ['still says a 50 Ω line never reflects'],
    });
  });

  it('writes: upsert_subject, upsert_concept, add_question, review_question, open_misconception, save_teach_back, override_grade', async () => {
    await g('upsert_subject', 'upsert_subject', { title: 'Jitter and BER', aliases: ['jitter'] });
    await g('upsert_concept', 'upsert_concept', {
      concepts: [
        { id: 'kc-jb-random-jitter', title: 'Random jitter', subject: 'jitter-and-ber' },
        {
          id: 'kc-jb-ber',
          title: 'Bit error ratio',
          subject: 'jitter-and-ber',
          prerequisites: ['kc-jb-random-jitter'],
        },
      ],
    });
    const add = await g('add_question', 'add_question', {
      kc_ids: ['kc-jb-ber'],
      qtype: 'discriminate',
      format: 'mc',
      difficulty: 2,
      stem: 'Which jitter component grows without bound as you wait for rarer events?',
      options: ['Random jitter', 'Periodic jitter', 'Data-dependent'],
      answer_key: 'A',
      rubric: [{ id: 'R1', proposition: 'RJ is unbounded (Gaussian tails)' }],
      hints: [
        'Bounded or unbounded?',
        'Think of a Gaussian.',
        'Which has tails?',
        'A: random jitter is unbounded.',
      ],
      misconception_targets: [
        { option_or_belief: 'Periodic jitter', misconception_id: 'M-0002' },
        { option_or_belief: 'Data-dependent', misconception_id: 'M-0003' },
      ],
      created_by: 'codex',
    });
    expect((add.data as { lint: { ok: boolean } }).lint.ok).toBe(true);
    await g('review_question', 'review_question', {
      question_id: 'Q-0008',
      verdict: 'ok',
      by: 'claude-desktop',
      notes: 'clear',
    });
    await g('open_misconception', 'open_misconception', {
      kc_ids: ['kc-jb-ber'],
      belief: 'Periodic jitter is unbounded',
      by: 'claude-desktop',
    });
    await g('save_teach_back', 'save_teach_back', {
      kc_id: 'kc-si-reflection-coefficient',
      text: 'A reflection happens wherever the impedance changes; Γ = (ZL − Z0)/(ZL + Z0).',
    });
    const attempts = sc.facts().attempts;
    const anyId = Object.keys(attempts).sort()[0]!;
    await g('override_grade', 'override_grade', {
      attempt_id: anyId,
      grade: 'partial',
      reason: 'owner relabel (V-GRADE)',
    });
  });

  it('visuals: register_visual (needs_fix, then the fix attempt), get_visual, check_visual (VIS-03, VIS-05)', async () => {
    const source = readFileSync('visual-kit/templates/diagram.svg', 'utf8');
    const input = {
      kc_ids: ['kc-si-reflection-coefficient'],
      kind: 'diagram',
      title: 'Signal path with a reflection',
      format: 'svg',
      purpose: 'Shows where the reflection comes from.',
      notice: 'A launches the step; C reflects half of it back toward A.',
      alt: 'Three boxes A, B, C joined by arrows, with a dashed arrow from C back to A.',
    };
    const first = await g('register_visual-needs-fix', 'register_visual', {
      ...input,
      source: source.replace(/<title>[^<]*<\/title>\s*<desc>[^<]*<\/desc>/, ''),
    });
    const id = (first.data as { visual_id: string; status: string }).visual_id;
    expect(first.data).toMatchObject({ status: 'needs_fix', attempt: 1 });
    const fixed = await g('register_visual', 'register_visual', { ...input, source, visual_id: id });
    expect(fixed.data).toMatchObject({ visual_id: id, status: 'accepted', attempt: 2 });
    const got = await g('get_visual', 'get_visual', { visual_id: id });
    expect((got.data as { source: string }).source).toBe(source.trim() + '\n');
    await g('check_visual', 'check_visual', { visual_id: id });
  });
});

describe('V-MCP rejections (IF-03)', () => {
  it('path traversal in ids is rejected', async () => {
    for (const [tool, args] of [
      ['get_concept', { kc_id: '../../Windows/win.ini' }],
      ['get_concept', { kc_id: 'kc-..\\..\\x' }],
      ['upsert_concept', { concepts: [{ id: '../evil', title: 'x', subject: 'si-pi' }] }],
      ['get_hint', { question_id: '../Q-0001', level: 1 }],
    ] as const) {
      const r = await mcp.call(tool, args as Record<string, unknown>);
      called.add(tool);
      expect(r.env.ok, `${tool} ${JSON.stringify(args)}`).toBe(false);
      expect(r.isError).toBe(true);
    }
  });

  it('oversized inputs are rejected', async () => {
    const long = await mcp.call('record_attempt', {
      question_text: 'q text',
      kc_ids: ['kc-si-voltage-current'],
      answer_verbatim: 'x'.repeat(5000),
      grade: 'correct',
      confidence: 3,
      grader: 'claude-desktop',
    });
    expect(long.env.ok).toBe(false);
    const huge = await mcp.call('end_session', { summary: 'y'.repeat(1_300_000), next_preview: 'n' });
    expect(huge.env.ok).toBe(false);
  });

  it('p95 latency is under 500 ms on the fixture vault', () => {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))]!;
    console.log(
      `MCP latency over ${sorted.length} calls: p50 ${sorted[Math.floor(sorted.length / 2)]!.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`,
    );
    expect(p95).toBeLessThan(500);
  });
});

describe('V-MCP never fails on load (REL-03)', () => {
  it('starts without a vault and answers with a next step', async () => {
    const empty = await connectMcp({ vault: tempDir() + '/missing' });
    try {
      const d = await empty.call('doctor');
      expect(d.env.ok).toBe(false);
      expect(d.env.errors[0]!.next_step).toBeTruthy();
      const b = await empty.call('start_session', {});
      expect(b.env.errors[0]!.code).toBe('vault_missing');
    } finally {
      await empty.close();
    }
  }, 60_000);
});

describe('V-MCP Anki tools against a mock AnkiConnect (ANK-01 … ANK-10)', () => {
  let anki: McpHandle;
  let mock: MockAnki;
  let avault = '';
  async function ga(name: string, tool: string, args: Record<string, unknown> = {}) {
    const r = await anki.call(tool, args);
    called.add(tool);
    expect(Object.keys(r.env).sort()).toEqual(['data', 'errors', 'ok', 'warnings']);
    expect(r.isError).toBe(!r.env.ok);
    if (tool === 'anki_sync') expect(r.ms).toBeLessThan(5000); // sync is excluded from p95 but bounded
    await expect(JSON.stringify(normalize(r.env, avault), null, 2)).toMatchFileSnapshot(
      `../golden/mcp/${name}.json`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary tool output
    return r.env as { ok: boolean; data: any; warnings: string[]; errors: { code: string }[] };
  }

  beforeAll(async () => {
    mock = await new MockAnki().start();
    for (const d of ['Scaffold', 'Scaffold::SI/PI', 'Scaffold::Music theory']) mock.decks.add(d);
    seedCard(mock, {
      kc: 'kc-si-z0',
      anchor: true,
      front: 'What sets the Z0 of a uniform line?',
      back: 'Its L and C per length',
      card: { type: 2, queue: 2, ivl: 12 },
    });
    seedCard(mock, {
      kc: 'kc-mt-intervals',
      anchor: true,
      front: 'Semitones in a perfect fifth?',
      back: '7',
      card: { type: 2, queue: 2, ivl: 30 },
    });
    const v = vaultFromEvents(ankiLog(), '2026-10-09T18:00:00-04:00', { name: 'MCP Anki Vault' });
    rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
    avault = v.root;
    anki = await connectMcp({ vault: avault, env: { SCAFFOLD_ANKI_URL: mock.url } });
  }, 60_000);

  afterAll(async () => {
    await anki?.close();
    await mock?.stop();
  });

  it('sync, load, propose, approve, flag, rewrite, scope and stack through a real client', async () => {
    const sync = await ga('anki_sync', 'anki_sync');
    expect(sync.data).toMatchObject({
      online: true,
      cards: 2,
      created: { note_types: ['Scaffold Basic', 'Scaffold Cloze'] },
    });
    await ga('get_anki_load', 'get_anki_load');
    const prop = await ga('propose_cards', 'propose_cards', {
      cards: [
        {
          kc_id: 'kc-si-gamma',
          front: 'Why does a mismatched load reflect?',
          back: 'Γ = (ZL − Z0)/(ZL + Z0)',
          anchor: true,
          admission: ADMISSION,
        },
      ],
    });
    const listed = await ga('list_card_actions', 'list_card_actions');
    expect(listed.data.actions).toHaveLength(1);
    const applied = await ga('apply_card_actions', 'apply_card_actions', {
      action_ids: [prop.data.proposals[0].action_id],
      approval: { learner_quote: 'Yes, add that card.' },
    });
    expect(applied.data.results[0].result).toBe('applied');
    await anki.call('anki_sync');
    const note = [...mock.notes.values()].find((n) => n.tags.includes('kc::kc-si-gamma'))!;
    const flag = await ga('flag_card', 'flag_card', {
      note_id: note.id,
      detail: 'oversimplified',
      proposed: 'rewrite',
      by: 'claude-code',
    });
    expect(flag.data.tag).toBe('applied');
    const rw = await ga('propose_card_actions', 'propose_card_actions', {
      actions: [
        {
          kind: 'rewrite_reset',
          note_ids: [note.id],
          reason: 'answer corrected',
          fields: { Back: 'Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltage that reflects' },
        },
      ],
    });
    await anki.call('apply_card_actions', {
      action_ids: [rw.data.actions[0].action_id],
      approval: { learner_quote: 'ok, rewrite and reset' },
    });
    expect(mock.requests.filter((r) => r.action === 'forgetCards')).toHaveLength(1);
    await ga('set_subject_scope', 'set_subject_scope', { subject: 'music', scope: 'paused' });
    await ga('anki_stack', 'anki_stack', { name: 'SI/PI review', subject: 'si-pi' });
    expect(mock.actions().some((a) => /delete/i.test(a))).toBe(false);
  });
});

describe('V-MCP coverage', () => {
  it('every listed tool was called through a real client', async () => {
    const { tools } = await mcp.client.listTools();
    expect(tools.map((t) => t.name).filter((n) => !called.has(n))).toEqual([]);
  });
});
