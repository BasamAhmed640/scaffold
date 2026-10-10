import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Warnings } from '../../src/core/envelope.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import { cli, normalize } from '../helpers/cli.js';
import { cleanupAll, tempDir, vaultFromEvents } from '../helpers/vault.js';
import { FIXTURE_NOW, standardFixture } from '../fixtures/standard.js';

// V-CLI: golden JSON for every command, with the {ok, data, warnings, errors} envelope (IF-02).

let vault = '';
let dir = '';
const golden = (name: string): string => `../golden/cli/${name}.json`;

async function g(name: string, args: string[], now = FIXTURE_NOW) {
  const r = await cli(vault, args, { now });
  expect(r.json, `${name}: not JSON: ${r.out}`).not.toBeNull();
  expect(Object.keys(r.json!).sort()).toEqual(['data', 'errors', 'ok', 'warnings']);
  await expect(JSON.stringify(normalize(r.json, vault), null, 2)).toMatchFileSnapshot(golden(name));
  return r;
}

beforeAll(() => {
  const v = vaultFromEvents(standardFixture().events, FIXTURE_NOW, { name: 'CLI Vault' });
  rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
  vault = v.root;
  dir = tempDir();
});
afterAll(() => cleanupAll());

describe('V-CLI golden JSON (IF-01, IF-02)', () => {
  it('init', async () => {
    const target = path.join(dir, 'New Vault');
    const r = await cli(vault, ['init', target]);
    expect(r.code).toBe(0);
    const data = normalize(r.json, target) as { data: { created: string[] } };
    expect(data.data.created).toContain('Scaffold/Home.md');
    await expect(
      JSON.stringify({ ...data, data: { ...data.data, user_config: '<USER_CONFIG>' } }, null, 2),
    ).toMatchFileSnapshot(golden('init'));
  });

  it('doctor', async () => {
    const r = await g('doctor', ['doctor']);
    expect(r.code).toBe(0);
  });

  it('subject list / get / dashboard', async () => {
    await g('subject-list', ['subject', 'list']);
    await g('subject-get', ['subject', 'get', 'music-theory']);
    await g('dashboard', ['dashboard']);
    const bad = await g('subject-get-unknown', ['subject', 'get', 'chess']);
    expect(bad.code).toBe(1);
  });

  it('kc get / list', async () => {
    await g('kc-get', ['kc', 'get', 'kc-si-reflection-coefficient']);
    await g('kc-list', ['kc', 'list', '--subject', 'music-theory']);
  });

  it('briefing / plan, including a focus that does not exist and a paused one', async () => {
    await g('briefing-si-pi', ['briefing', '--focus', 'SI/PI']);
    await g('plan-music-20', ['plan', '--focus', 'music', '--minutes', '20', '--carryover', '1']);
    const unknown = await g('plan-unknown-subject', ['plan', '--focus', 'chess']);
    expect(unknown.json!.errors[0]!.code).toBe('unknown_subject');
    const paused = await g('plan-paused-subject', ['plan', '--focus', 'Spanish']);
    expect(paused.json!.errors[0]!.code).toBe('subject_not_active');
  });

  it('mc list', async () => {
    await g('mc-list', ['mc', 'list']);
  });

  it('a full session: start → next → hint → key → record → taught → teach-back → end', async () => {
    const start = await g('session-start', ['session', 'start', '--focus', 'si-pi']);
    expect((start.json!.data as { session_id: string }).session_id).toBe('S-2026-10-09-1');
    const next = await g('q-next-repair', ['q', 'next', '--step', 'repair']);
    const text = JSON.stringify(next.json);
    expect(text).not.toContain('answer_key');
    expect(text).not.toContain('hints');
    await g('q-hint', ['q', 'hint', 'Q-0002', '1']);
    await g('q-key', ['q', 'key', 'Q-0002', '--answer', 'It reflects because the far end is open']);
    await g('attempt-record', [
      'attempt',
      'record',
      '--question',
      'Q-0002',
      '--answer',
      'It reflects because the far end is open, so Γ is +1',
      '--grade',
      'correct',
      '--confidence',
      '3',
      '--grader',
      'claude-code',
      '--hit',
      'R1',
      '--quote',
      'Γ is +1',
      '--step',
      'repair',
    ]);
    // same call again: idempotent (LM-04)
    const dup = await cli(vault, [
      'attempt',
      'record',
      '--question',
      'Q-0002',
      '--answer',
      'It reflects because the far end is open, so Γ is +1',
      '--grade',
      'correct',
      '--confidence',
      '3',
      '--grader',
      'claude-code',
      '--hit',
      'R1',
      '--quote',
      'Γ is +1',
      '--step',
      'repair',
    ]);
    expect((dup.json!.data as { duplicate: boolean }).duplicate).toBe(true);
    await g('attempt-record-improvised', [
      'attempt',
      'record',
      '--text',
      'What does the far end of a lattice diagram show at t = TD?',
      '--kc',
      'kc-si-lattice-diagram',
      '--qtype',
      'predict',
      '--answer',
      "I don't know",
      '--grader',
      'claude-code',
      '--step',
      'new',
    ]);
    await g('kc-taught', ['kc', 'taught', 'kc-si-lattice-diagram']);
    await g('kc-teachback', [
      'kc',
      'teachback',
      'kc-si-reflection-coefficient',
      '--text',
      'A wave reflects wherever the impedance changes; Γ = (ZL − Z0)/(ZL + Z0).',
    ]);
    await g('plan-replan', ['plan', '--minutes', '15']);
    await g('session-end', [
      'session',
      'end',
      '--summary',
      'Repaired the 50 Ω belief with an open-line case.',
      '--next',
      'Lattice diagrams with a real termination.',
      '--thread',
      'check Γ sign at a short',
    ]);
    const log = readFileSync(path.join(vault, 'Scaffold', 'Sessions', 'S-2026-10-09-1.md'), 'utf8');
    expect(log).toContain('Repaired the 50 Ω belief');
    expect(log).toContain('> [!question] Improvised');
  });

  it('q add / get / lint / review (cross-model) / pending', async () => {
    const file = path.join(dir, 'q.json');
    writeFileSync(
      file,
      JSON.stringify({
        kc_ids: ['kc-si-propagation-delay'],
        qtype: 'apply',
        format: 'numeric',
        difficulty: 2,
        stem: 'FR-4 has εr = 4. How long does an edge take to cross 12 inches of stripline?',
        answer_key: 'About 2 ns (6 in/ns).',
        numeric: { value: 2, unit: 'ns', tolerance: '5%' },
        rubric: [{ id: 'R1', proposition: 'v = c/√εr ≈ 6 in/ns, so TD = 12 in ÷ 6 in/ns' }],
        hints: ['Which speed matters?', 'Recall v = c/√εr.', 'v ≈ 6 in/ns.', 'TD = 12 / 6 = 2 ns.'],
        created_by: 'claude-desktop',
      }),
    );
    const add = await g('q-add', ['q', 'add', '--file', file]);
    expect((add.json!.data as { question_id: string }).question_id).toBe('Q-0008');
    await g('q-get', ['q', 'get', 'Q-0008']);
    await g('q-lint', ['q', 'lint']);
    const same = await g('q-review-same-family', [
      'q',
      'review',
      'Q-0008',
      '--verdict',
      'ok',
      '--by',
      'claude-code',
    ]);
    expect(same.json!.errors[0]!.code).toBe('same_model_review');
    await g('q-review-ok', ['q', 'review', 'Q-0008', '--verdict', 'ok', '--by', 'codex']);
    await g('q-review-pending', ['q', 'review', '--pending']);
  });

  it('numeric answers are graded by code (REL-02)', async () => {
    const r = await cli(vault, [
      'attempt',
      'record',
      '--question',
      'Q-0008',
      '--answer',
      '2.05 ns',
      '--grade',
      'incorrect',
      '--confidence',
      '4',
      '--grader',
      'claude-code',
    ]);
    expect(r.json!.ok).toBe(true);
    expect((r.json!.data as { grade: string; graded_by: string }).grade).toBe('correct');
    expect(r.json!.warnings.join(' ')).toMatch(/REL-02/);
  });

  it('attempt override, mc open, validate, rebuild, report weekly, call', async () => {
    const list = await cli(vault, ['call', 'list_misconceptions', '--input', '{"state":"open"}']);
    expect(list.json!.ok).toBe(true);
    await g('mc-open', [
      'mc',
      'open',
      '--kc',
      'kc-si-termination-strategies',
      '--belief',
      'A series resistor always removes every reflection',
      '--by',
      'owner',
    ]);
    const facts = (await cli(vault, ['kc', 'get', 'kc-si-reflection-coefficient'])).json!.data as {
      recent_attempts: unknown[];
    };
    expect(facts.recent_attempts.length).toBeGreaterThan(0);
    const bad = await g('attempt-override-unknown', [
      'attempt',
      'override',
      'A000000000000000',
      '--grade',
      'correct',
      '--reason',
      'test',
    ]);
    expect(bad.code).toBe(1);
    await g('validate', ['validate']);
    await g('rebuild', ['rebuild']);
    await g('report-weekly', ['report', 'weekly']);
    await g('call-get-concept', [
      'call',
      'get_concept',
      '--input',
      '{"kc_id":"kc-mt-intervals","include_text":false}',
    ]);
  });

  it('subject add / kc add / kc update', async () => {
    const add = await g('subject-add', [
      'subject',
      'add',
      'Linear algebra',
      '--alias',
      'linalg',
      '--goal',
      'eigenvalues for S-parameters',
    ]);
    expect((add.json!.data as { subject: { anki_deck: string } }).subject.anki_deck).toBe(
      'Scaffold::Linear algebra',
    );
    await g('kc-add', [
      'kc',
      'add',
      '--id',
      'kc-la-vectors',
      '--title',
      'Vectors',
      '--subject',
      'linear-algebra',
    ]);
    await g('kc-add-2', [
      'kc',
      'add',
      '--id',
      'kc-la-matrices',
      '--title',
      'Matrices',
      '--subject',
      'linear-algebra',
      '--prereq',
      'kc-la-vectors',
    ]);
    await g('kc-update', ['kc', 'update', 'kc-la-matrices', '--title', 'Matrices as linear maps']);
    await g('plan-pretest', ['plan', '--focus', 'linalg']);
  });

  it('anki sync (offline) / status / stack / actions / flag / propose, scope set (D8 Anki rows)', async () => {
    const sync = await g('anki-sync-offline', ['anki', 'sync']);
    expect((sync.json!.data as { online: boolean }).online).toBe(false);
    await g('anki-status', ['anki', 'status']);
    await g('anki-stack', ['anki', 'stack', 'Reflections', '--subject', 'si-pi', '--status', 'fragile']);
    await g('anki-actions-list', ['anki', 'actions', 'list']);
    const flag = await g('anki-flag-unknown', [
      'anki',
      'flag',
      '123',
      '--detail',
      'wrong sign',
      '--propose',
      'rewrite',
    ]);
    expect(flag.code).toBe(1);
    const file = path.join(dir, 'cards.json');
    writeFileSync(
      file,
      JSON.stringify({
        cards: [
          {
            kc_id: 'kc-si-reflection-coefficient',
            front: 'Why does a mismatched load reflect?',
            back: 'Γ = (ZL − Z0)/(ZL + Z0)',
            anchor: true,
            admission: { rederive: 'not from Z0 alone', instant: 'every reflection problem', worth: 'yes' },
          },
        ],
      }),
    );
    const propose = await g('anki-propose-no-session', ['anki', 'propose', '--file', file]);
    expect(propose.code).toBe(1);
    const apply = await g('anki-actions-apply-unknown', [
      'anki',
      'actions',
      'apply',
      'CA-0099',
      '--approval',
      'yes',
    ]);
    expect((apply.json!.data as { results: { result: string }[] }).results[0]!.result).toBe('skipped');
    const scope = await g('scope-set', ['scope', 'set', 'spanish', 'active']);
    expect(scope.json!.warnings.join(' ')).toContain('needs_check');
  });
});

describe('human output', () => {
  it('prints readable text by default and one line + next step on failure (REL-03)', async () => {
    const r = await cli(vault, ['plan', '--focus', 'chess'], { json: false });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^✗ No subject matches "chess"\.\n {2}→ Ask the learner once/);
    const d = await cli(vault, ['doctor'], { json: false });
    expect(d.out).toMatch(/^✓ Vault:/);
    const h = await cli(vault, ['--help'], { json: false });
    expect(h.code).toBe(0);
    expect(h.out).toContain('session');
  });

  it('a missing vault fails with a next step, never a hang', async () => {
    const r = await cli(path.join(dir, 'does-not-exist'), ['briefing']);
    expect(r.code).toBe(1);
    expect(r.json!.errors[0]!.code).toBe('vault_missing');
    expect(r.json!.errors[0]!.next_step).toBeTruthy();
  });
});
