import { afterAll, describe, expect, it } from 'vitest';
import { callTool } from '../../src/core/api/tools.js';
import { Warnings } from '../../src/core/envelope.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { reviewPrompt, runCrossReview } from '../../scripts/jobs/cross-review.js';
import type { Provider } from '../../scripts/ped/drivers.js';
import { questionEvent } from '../fixtures/standard.js';
import { LogBuilder } from '../helpers/builder.js';
import { cleanupAll, vaultFromEvents } from '../helpers/vault.js';

// QB-04 / AD-06: the headless cross-review job asks only the other model family, only for what is
// waiting, in one bounded turn, and reports what was and was not reviewed. No model is called here.

afterAll(cleanupAll);

function vault(open = false): string {
  const b = new LogBuilder('2026-09-01T10:00:00-04:00');
  b.subject('si-pi').kc('kc-a', 'si-pi');
  questionEvent(b, 'Q-0001', ['kc-a'], 'explain', 'Why does an open end reflect a step with the same sign?', {
    verdict: 'pending',
    by: 'claude-desktop',
  });
  questionEvent(b, 'Q-0002', ['kc-a'], 'predict', 'Predict the voltage at a shorted far end after one TD.', {
    verdict: 'pending',
    by: 'codex',
  });
  questionEvent(b, 'Q-0003', ['kc-a'], 'apply', 'A 75 Ω load on a 50 Ω line: compute Γ.');
  if (open) b.session('S-2026-09-01-1', 'si-pi');
  const v = vaultFromEvents(b.events, '2026-10-09T18:00:00-04:00');
  rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
  return v.root;
}

/** A front-end that reviews every id named in the prompt, as `by`, with the given verdict. */
function fake(by: string, verdict: string | null, seen: string[]): (v: string) => Provider {
  return (v) => ({
    name: 'stub',
    async turn(message: string) {
      seen.push(message);
      const ids = /these questions, one at a time: ([^.]+)\./.exec(message)![1]!.split(', ');
      const sc = Scaffold.open(v);
      for (const id of ids) {
        await callTool(sc, 'review_question', { question_id: id });
        if (verdict)
          await callTool(sc, 'review_question', {
            question_id: id,
            verdict,
            by,
            notes: 'solved it from the stem',
          });
      }
      return { text: ids.map((i) => `${i} ${verdict ?? 'skipped'}`).join('\n'), tools: [], session: null };
    },
  });
}

describe('cross-review job (QB-04, AD-06)', () => {
  it('Codex reviews only Claude-written questions, in one turn', async () => {
    const seen: string[] = [];
    const r = await runCrossReview({
      vault: vault(),
      provider: 'codex',
      makeProvider: fake('codex', 'ok', seen),
    });
    expect(r).toMatchObject({
      family: 'openai',
      asked: ['Q-0001'],
      reviewed: [{ question_id: 'Q-0001', verdict: 'ok' }],
      missing: [],
      error: null,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(reviewPrompt(['Q-0001'], 'codex', 'openai'));
  });

  it('Claude reviews only Codex-written questions', async () => {
    const r = await runCrossReview({
      vault: vault(),
      provider: 'claude',
      makeProvider: fake('claude-code', 'fix', []),
    });
    expect(r).toMatchObject({
      family: 'claude',
      asked: ['Q-0002'],
      reviewed: [{ question_id: 'Q-0002', verdict: 'fix' }],
    });
  });

  it('no model call when nothing is waiting for that family, or during a session (ARC-11, TP-08)', async () => {
    const v = vault();
    await runCrossReview({ vault: v, provider: 'codex', makeProvider: fake('codex', 'ok', []) });
    let built = 0;
    const none = await runCrossReview({
      vault: v,
      provider: 'codex',
      makeProvider: () => (built++, fake('codex', 'ok', [])(v)),
    });
    expect(none.skipped_reason).toBe('nothing is waiting for review by the openai family');
    expect(built).toBe(0);
    const open = await runCrossReview({
      vault: vault(true),
      provider: 'codex',
      makeProvider: () => (built++, fake('codex', 'ok', [])(v)),
    });
    expect(open.skipped_reason).toMatch(/session is open/);
    expect(built).toBe(0);
  });

  it('reports questions the model did not review; a same-family verdict is refused by Scaffold', async () => {
    const skipped = await runCrossReview({
      vault: vault(),
      provider: 'codex',
      makeProvider: fake('codex', null, []),
    });
    expect(skipped.missing).toEqual(['Q-0001']);
    // a model that tries to review its own family's question records nothing
    const own = await runCrossReview({
      vault: vault(),
      provider: 'codex',
      makeProvider: fake('claude-code', 'ok', []),
    });
    expect(own.missing).toEqual(['Q-0001']);
  });

  it('dry run lists what would be asked without a model', async () => {
    const r = await runCrossReview({
      vault: vault(),
      provider: 'codex',
      dryRun: true,
      makeProvider: () => {
        throw new Error('no model in a dry run');
      },
    });
    expect(r).toMatchObject({ asked: ['Q-0001'], skipped_reason: 'dry run' });
  });
});
