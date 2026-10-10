import { afterAll, describe, expect, it } from 'vitest';
import { callTool } from '../../src/core/api/tools.js';
import { Warnings } from '../../src/core/envelope.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import { FIXTURE_NOW, standardFixture } from '../fixtures/standard.js';
import { cleanupAll, vaultFromEvents } from '../helpers/vault.js';

// Tool inputs as real tutors send them (V-PED full run, 2026-10-10): rubric points named by their
// text instead of their id, and a wrap-up replan of a few minutes (D-92).

afterAll(cleanupAll);

function vault() {
  const v = vaultFromEvents(standardFixture().events, FIXTURE_NOW);
  rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
  return v;
}

const attempt = (rubric_hits: string[]) => ({
  question_id: 'Q-0001',
  answer_verbatim: 'It states the key relation: V and I travel together.',
  grade: 'correct',
  rubric_hits,
  evidence_quotes: ['It states the key relation'],
  confidence: 3,
  grader: 'codex',
});

describe('TP-07 rubric points by id or by text', () => {
  it('maps the rubric text, "R1: …" and "r1" to the id that is stored', async () => {
    const v = vault();
    expect((await callTool(v.sc, 'start_session', { focus: 'si-pi' })).ok).toBe(true);
    for (const [i, hits] of [
      ['states the key relation'],
      ['R1: states the key relation.'],
      ['r1'],
    ].entries()) {
      const env = await callTool(v.sc, 'record_attempt', {
        ...attempt(hits),
        answer_verbatim: `It states the key relation: V and I travel together (${i}).`,
      });
      expect(env.ok, JSON.stringify(env.errors)).toBe(true);
      const last = v.sc.vault.log
        .read()
        .events.filter((e) => e.type === 'attempt')
        .at(-1)!;
      expect((last as { rubric_hits: string[] }).rubric_hits).toEqual(['R1']);
    }
  });

  it('an unknown point is rejected with the valid ids', async () => {
    const v = vault();
    await callTool(v.sc, 'start_session', { focus: 'si-pi' });
    const env = await callTool(v.sc, 'record_attempt', attempt(['mentions the skin effect']));
    expect(env.errors[0]).toMatchObject({
      code: 'unknown_rubric_point',
      next_step: 'Use its rubric ids: R1.',
    });
  });
});

describe('TP-09 a short wrap-up replan', () => {
  it('plan_session accepts 2 minutes (the tutor replans the last minutes before the exit ticket)', async () => {
    const v = vault();
    await callTool(v.sc, 'start_session', { focus: 'si-pi', minutes: 20 });
    const env = await callTool(v.sc, 'plan_session', { minutes: 2 });
    expect(env.ok, JSON.stringify(env.errors)).toBe(true);
    expect(env.data).toMatchObject({ plan: { minutes_requested: 2 } });
  });
});
