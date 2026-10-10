import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { callTool } from '../../src/core/api/tools.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { systemClock, systemTimeZone } from '../../src/core/time.js';
import {
  ClaudeProvider,
  CodexProvider,
  parseClaudeStream,
  parseCodexJson,
  prepareWorkdir,
} from '../../scripts/ped/drivers.js';
import { createFixtureVault } from '../../scripts/ped/fixture.js';
import { Learner, WRAP_UP } from '../../scripts/ped/learner.js';
import { report, runScenario } from '../../scripts/ped/run.js';
import { SCENARIOS, scenarioById } from '../../scripts/ped/scenarios.js';
import { cleanupAll, tempDir } from '../helpers/vault.js';

// V-PED harness: the scripted learner, the front-end output normalizers, the scenario fixtures and
// the run loop (with the in-process stub tutor; no model is called).

afterAll(cleanupAll);

describe('scripted learner', () => {
  it('answers the last question asked, with confidence', () => {
    const l = new Learner({ opening: 'hi', turns: 5, rules: [] });
    l.opening();
    const r = l.reply('Nice. Now a new one: a line is shorted at the far end. What is Γ there?');
    expect(r).toEqual({ text: expect.stringContaining('Γ = −1 at a short'), answer: true });
    expect(Learner.lastQuestion('Intro.\n\nFirst this. Then that. What is B?\n\nTake your time.')).toBe(
      'Then that. What is B?',
    );
    expect(Learner.lastQuestion('Intro.\n\nPredict the voltage.\n\nAdd your confidence.')).toBe(
      'Predict the voltage.\n\nAdd your confidence.',
    );
  });

  it('applies scenario rules first, once when marked', () => {
    const l = new Learner({
      opening: 'hi',
      turns: 5,
      rules: [{ id: 'x', once: true, when: /\?/, reply: "I don't know.", answer: true }],
    });
    l.opening();
    expect(l.reply('What is Γ at an open?').text).toBe("I don't know.");
    expect(l.reply('What is Γ at an open?').text).toContain('+1');
  });

  it('answers content before logistics, and tasks without a question mark', () => {
    const l = new Learner({ opening: 'hi', turns: 9, rules: [] });
    l.opening();
    expect(l.reply('How long, in ns, does an edge take to travel 30 cm along it?').text).toContain('2 ns');
    expect(l.reply('How much time do you have today?').text).toBe('About 15 minutes.');
    const task = l.reply(
      'A 1 V edge meets a 75 Ω section. Predict the voltage of the edge that continues into it.\n\nAdd your confidence from 1 to 4.',
    );
    expect(task).toEqual({ text: expect.stringContaining('1.2 V'), answer: true });
    expect(l.reply('Thanks. And your confidence, 1–4?').text).toBe('3');
  });

  it('does not mark replies to non-questions as answers', () => {
    const l = new Learner({ opening: 'hi', turns: 5, rules: [] });
    l.opening();
    expect(l.reply('Here is how reflection works.').answer).toBeUndefined();
  });

  it('asks to wrap up after its turns, then stops', () => {
    const l = new Learner({ opening: 'hi', turns: 2, rules: [], wrap_turns: 1 });
    l.opening();
    expect(l.reply('Γ at an open?').text).not.toBe(WRAP_UP);
    expect(l.reply('Γ at a short?').text).toBe(WRAP_UP);
    expect(l.done).toBe(false);
    l.reply('Exit ticket: Γ for a matched load?');
    l.reply('Bye.');
    expect(l.done).toBe(true);
  });

  it('sends fixed turns, such as the switch request in 10b', () => {
    const s = scenarioById('s10b');
    const l = new Learner(s.learner);
    l.opening();
    for (let i = 2; i < 7; i++) l.reply('What is a triad?');
    expect(l.reply('What is a triad?')).toMatchObject({ switch_to: 'si-pi' });
  });
});

describe('front-end output normalizers', () => {
  it('reads Claude Code stream-json: text, scaffold tool calls and results, session id', () => {
    const lines = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'abc',
        mcp_servers: [{ name: 'scaffold', status: 'connected' }],
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Quick check first.' },
            { type: 'tool_use', id: 't1', name: 'mcp__scaffold__start_session', input: { focus: 'si-pi' } },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"ok":true}' }] },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't2', name: 'Read', input: {} },
            { type: 'text', text: 'What is Γ at an open?' },
          ],
        },
      },
      { type: 'result', subtype: 'success', result: 'What is Γ at an open?', session_id: 'abc' },
    ].map((l) => JSON.stringify(l));
    const r = parseClaudeStream(['not json', ...lines].join('\n'));
    expect(r).toEqual({
      text: 'Quick check first.\n\nWhat is Γ at an open?',
      tools: [{ name: 'start_session', input: { focus: 'si-pi' }, ok: true }],
      session: 'abc',
    });
  });

  it('reports a failed Claude run and a disconnected MCP server', () => {
    const out = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 's',
        mcp_servers: [{ name: 'scaffold', status: 'failed' }],
      },
      { type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's' },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    expect(parseClaudeStream(out).error).toContain('error_max_turns');
  });

  it('reads codex exec --json: thread id, agent messages and MCP tool calls', () => {
    const out = [
      { type: 'thread.started', thread_id: 'th-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking' } },
      {
        type: 'item.completed',
        item: {
          id: 'i1',
          type: 'mcp_tool_call',
          server: 'scaffold',
          tool: 'get_grading_key',
          arguments: { question_id: 'Q-0002', answer_verbatim: '+1, 3' },
          status: 'completed',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'i2',
          type: 'mcp_tool_call',
          server: 'scaffold',
          tool: 'record_attempt',
          arguments: '{"answer_verbatim":"x"}',
          status: 'failed',
          error: { message: 'bad' },
        },
      },
      { type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Right. Why?' } },
      { type: 'turn.completed', usage: {} },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    expect(parseCodexJson(out)).toEqual({
      text: 'Right. Why?',
      tools: [
        { name: 'get_grading_key', input: { question_id: 'Q-0002', answer_verbatim: '+1, 3' }, ok: true },
        { name: 'record_attempt', input: { answer_verbatim: 'x' }, ok: false },
      ],
      session: 'th-1',
    });
    expect(
      parseCodexJson(JSON.stringify({ type: 'turn.failed', error: { message: 'usage limit' } })).error,
    ).toBe('codex: usage limit');
  });
});

describe('working directories and command lines', () => {
  const repo = tempDir('ped-repo-');
  mkdirSync(path.join(repo, 'dist', 'mcp'), { recursive: true });
  writeFileSync(path.join(repo, 'dist', 'mcp', 'index.js'), '');
  mkdirSync(path.join(repo, 'skills', 'scaffold-tutor', 'references'), { recursive: true });
  writeFileSync(path.join(repo, 'skills', 'scaffold-tutor', 'SKILL.md'), '---\nname: scaffold-tutor\n---\n');
  writeFileSync(path.join(repo, 'CLAUDE.md'), '# Claude adapter');
  writeFileSync(path.join(repo, 'AGENTS.md'), '# Codex adapter');

  it('Claude: skill under .claude/skills, CLAUDE.md, a strict MCP config, resume after the first turn', () => {
    const dir = path.join(tempDir(), 'w');
    const wd = prepareWorkdir(dir, 'C:/v', 'claude', repo);
    expect(existsSync(path.join(dir, '.claude', 'skills', 'scaffold-tutor', 'SKILL.md'))).toBe(true);
    expect(readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe('# Claude adapter');
    const cfg = JSON.parse(readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    expect(cfg.mcpServers.scaffold.args.slice(1)).toEqual(['--vault', 'C:/v']);
    const p = new ClaudeProvider('claude', wd);
    const args = p.args();
    expect(args).toEqual(
      expect.arrayContaining(['-p', '--strict-mcp-config', '--setting-sources', 'project', '--session-id']),
    );
    expect(args).not.toContain('--resume');
    expect(args.slice(args.indexOf('--disallowedTools'))).toContain('Bash');
  });

  it('Codex: skill under .agents/skills, AGENTS.md, a git root, MCP server via -c, read-only sandbox', () => {
    const dir = path.join(tempDir(), 'w');
    const wd = prepareWorkdir(dir, 'C:\\vault dir', 'codex', repo);
    expect(existsSync(path.join(dir, '.agents', 'skills', 'scaffold-tutor', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
    const args = new CodexProvider('codex', wd).args();
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('sandbox_mode="read-only"');
    const mcpArgs = args.find((a) => a.startsWith('mcp_servers.scaffold.args='))!;
    expect(JSON.parse(mcpArgs.slice('mcp_servers.scaffold.args='.length)).slice(1)).toEqual([
      '--vault',
      'C:\\vault dir',
    ]);
    expect(args.at(-1)).toBe('-');
  });
});

describe('scenario fixtures', () => {
  const plan = async (
    id: string,
    minutes = 15,
  ): Promise<{
    steps: { step: string; items: { kc: string; question_id: string | null; subject: string }[] }[];
  }> => {
    const s = scenarioById(id);
    const root = path.join(tempDir(), 'vault');
    createFixtureVault(root, s.fixture, path.join(root, '..', 'uc.json'));
    const sc = Scaffold.open(root, { clock: systemClock, timezone: systemTimeZone() });
    const r = await callTool(sc, 'plan_session', { focus: s.focus, minutes });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    return (r.data as { plan: never }).plan;
  };
  const items = (p: Awaited<ReturnType<typeof plan>>, step: string) =>
    p.steps.find((s) => s.step === step)?.items ?? [];

  it('covers the ten scenarios of the spec (10 in two parts)', () => {
    expect(SCENARIOS.map((s) => s.id.split('-')[0])).toEqual([
      's01',
      's02',
      's03',
      's04',
      's05',
      's06',
      's07',
      's08',
      's09',
      's10a',
      's10b',
    ]);
  });

  it('s01: Γ (requires_visual) is the new KC', async () => {
    expect(items(await plan('s01'), 'new').map((i) => i.kc)).toEqual(['kc-si-reflection-coefficient']);
  });

  it('s02: the warm-up asks the misconception-targeting question on Γ', async () => {
    expect(items(await plan('s02'), 'warmup')[0]).toMatchObject({
      kc: 'kc-si-reflection-coefficient',
      question_id: 'Q-0002',
    });
  });

  it('s06: Γ is forgotten after 21 days and an anchor lapse', async () => {
    const s = scenarioById('s06');
    const root = path.join(tempDir(), 'vault');
    const fx = createFixtureVault(root, s.fixture, path.join(root, '..', 'uc.json'));
    expect(fx.kcs.find((k) => k.id === 'kc-si-reflection-coefficient')?.status_at_start).toBe('forgotten');
  });

  it('s08: the planted wrong-key question is served', async () => {
    expect(items(await plan('s08', 10), 'warmup')[0]).toMatchObject({ question_id: 'Q-0009' });
  });

  it('s09: the oversimplified card is in the Anki mirror and linked to Γ', () => {
    const s = scenarioById('s09');
    const root = path.join(tempDir(), 'vault');
    createFixtureVault(root, s.fixture, path.join(root, '..', 'uc.json'));
    const mirror = JSON.parse(
      readFileSync(path.join(root, 'Scaffold', '_system', 'anki-mirror.json'), 'utf8'),
    );
    expect(mirror.cards[0]).toMatchObject({
      kc_ids: ['kc-si-reflection-coefficient'],
      back: 'Only when the line is not 50 Ω.',
    });
  });

  it('s10a: music theory does not exist yet', () => {
    const root = path.join(tempDir(), 'vault');
    const fx = createFixtureVault(root, scenarioById('s10a').fixture, path.join(root, '..', 'uc.json'));
    expect(fx.subjects.map((s) => s.id)).toEqual(['si-pi']);
  });

  it('s10b: a music-theory plan whose only SI/PI item is the carry-over', async () => {
    const p = await plan('s10b');
    const other = p.steps.flatMap((s) =>
      s.items.filter((i) => i.subject !== 'music-theory').map(() => s.step),
    );
    expect(other).toEqual(['carryover']);
    expect(items(p, 'carryover')[0]).toMatchObject({ kc: 'kc-si-reflection-coefficient' });
  });

  it('starts every run from a stable baseline: a second vault scan adds no events', async () => {
    const root = path.join(tempDir(), 'vault');
    const fx = createFixtureVault(root, scenarioById('s02').fixture, path.join(root, '..', 'uc.json'));
    const sc = Scaffold.open(root, { clock: systemClock, timezone: systemTimeZone() });
    await callTool(sc, 'get_briefing', { focus: 'si-pi' });
    expect(sc.events().length).toBe(fx.events.length);
  });
});

describe('run loop with the stub tutor', () => {
  it('scores mechanical checks as passing and pedagogy the stub lacks as failing', async () => {
    const work = tempDir('ped-run-');
    const runs = [];
    for (const id of ['s04', 's02']) {
      const r = await runScenario(scenarioById(id), 'stub', work);
      expect(r.error).toBeUndefined();
      runs.push({ scenario: r.transcript.scenario, checks: r.checks });
      const ended = r.transcript.events.filter((e) => e.type === 'session_ended');
      expect(ended).toHaveLength(1);
      expect(
        r.transcript.turns.filter((t) => t.role === 'tutor').every((t) => t.events_after !== undefined),
      ).toBe(true);
    }
    const { summary, text } = report('stub', runs);
    const by = Object.fromEntries(summary.map((s) => [s.id, s]));
    for (const id of ['TP-03', 'TP-07', 'TP-08', 'TP-15'])
      expect(by[id]?.pass, `${id}: ${by[id]?.details.join('; ')}`).toBe(true);
    expect(by['S2']).toMatchObject({
      pass: false,
      details: ['[s02-misconception] misconception not opened'],
    });
    expect(text).toContain('Overall: FAIL');
  }, 120_000);
});
