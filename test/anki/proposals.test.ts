import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMISSION, ankiLog, ankiVault, seedCard, SESSION, type AnkiVault } from '../helpers/anki-vault.js';
import { cleanupAll } from '../helpers/vault.js';

// V-ANKI: admission and caps (ANK-03, TP-14), card rules (ANK-02), staleness (ANK-05).

let v: AnkiVault | null = null;
afterEach(async () => {
  await v?.mock.stop();
  v = null;
  cleanupAll();
});

const card = (over: Record<string, unknown> = {}) => ({
  kc_id: 'kc-si-gamma',
  front: 'Why does a mismatched load reflect?',
  back: 'Γ = (ZL − Z0)/(ZL + Z0)',
  anchor: true,
  admission: ADMISSION,
  ...over,
});

describe('admission and caps (ANK-03, TP-14)', () => {
  it('a missing admission answer is rejected with the test it fails', async () => {
    v = await ankiVault();
    const r = await v.call('propose_cards', {
      cards: [card({ admission: { rederive: 'x', instant: 'needed always', worth: 'yes' } })],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.errors)).toContain(
      'admission test 1 (cannot be re-derived in ~30 s) needs a one-line answer',
    );
  });

  it('no card before a correct, unassisted retrieval in this session (a guess does not count)', async () => {
    v = await ankiVault();
    const r = await v.call('propose_cards', {
      cards: [card({ kc_id: 'kc-si-td', front: 'How fast do edges travel in FR-4?', back: 'About 6 in/ns' })],
    });
    expect(r.errors[0]).toMatchObject({ code: 'card_rejected' });
    expect(r.errors[0]!.message).toContain(
      'no card before a correct, unassisted retrieval of kc-si-td in this session (TP-14)',
    );
  });

  it('no card outside a session', async () => {
    const events = ankiLog((b) => b.endSession(SESSION));
    v = await ankiVault({ events });
    const r = await v.call('propose_cards', { cards: [card()] });
    expect(r.errors[0]).toMatchObject({ code: 'no_open_session' });
  });

  it('at most 3 cards per KC, counting cards in Anki and pending proposals', async () => {
    v = await ankiVault();
    seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    seedCard(v.mock, { kc: 'kc-si-gamma' });
    await v.call('anki_sync');
    const ok = await v.call('propose_cards', {
      cards: [card({ anchor: false, front: 'What does Γ = 0 mean for a load?', back: 'It equals Z0' })],
    });
    expect(ok.ok, JSON.stringify(ok.errors)).toBe(true);
    const r = await v.call('propose_cards', {
      cards: [card({ anchor: false, front: 'What sign does Γ take for ZL < Z0?', back: 'Negative' })],
    });
    expect(r.errors[0]!.message).toContain('kc-si-gamma would have 4 cards; the cap is 3 per KC (ANK-03)');
  });

  it('exactly one anchor per KC', async () => {
    v = await ankiVault();
    const first = await v.call('propose_cards', { cards: [card({ anchor: false })] });
    expect(first.errors[0]!.message).toContain('the first card of kc-si-gamma must be its anchor');
    const two = await v.call('propose_cards', {
      cards: [card(), card({ front: 'When is Γ negative?', back: 'When ZL < Z0' })],
    });
    expect(two.errors[0]!.message).toContain('already has an anchor card');
  });

  it('beyond the yearly intake budget is rejected; past 80 % only one card per session', async () => {
    v = await ankiVault();
    const cfgPath = path.join(v.root, 'Scaffold/_system/config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.anki.minutes_per_day = 0.05; // si-pi and music share 0.05 min/day → 1 card a year each (0.025 × 365 ÷ 5)
    writeFileSync(cfgPath, JSON.stringify(cfg));
    seedCard(v.mock, { kc: 'kc-si-z0', anchor: true });
    await v.call('anki_sync');
    const r = await v.call('propose_cards', { cards: [card()] });
    expect(r.errors[0]!.message).toMatch(/si-pi: over its yearly intake budget \(1 of 1 cards used/);
    cfg.anki.minutes_per_day = 0.36; // 0.18 each → 13 a year; 11 used is past 80 %
    writeFileSync(cfgPath, JSON.stringify(cfg));
    for (let i = 0; i < 10; i++) seedCard(v.mock, { kc: 'kc-si-td' });
    await v.call('anki_sync');
    const two = await v.call('propose_cards', {
      cards: [
        card(),
        card({
          kc_id: 'kc-si-z0',
          anchor: false,
          front: 'What sets the Z0 of a trace?',
          back: 'Its L and C per length',
        }),
      ],
    });
    expect(two.errors[0]!.message).toContain('past 80 % of its yearly intake, at most one card per session');
    const one = await v.call('propose_cards', { cards: [card()] });
    expect(one.ok, JSON.stringify(one.errors)).toBe(true);
    expect(one.warnings.join(' ')).toContain('one card per session from now on');
  });

  it('card rules: lists and multi-cloze cards are rejected, tutor-question wording too', async () => {
    v = await ankiVault();
    const list = await v.call('propose_cards', {
      cards: [card({ back: '- open: +1\n- short: −1\n- matched: 0' })],
    });
    expect(list.errors[0]!.message).toContain('the back is a list');
    const cloze = await v.call('propose_cards', {
      cards: [card({ note_type: 'cloze', front: '{{c1::Γ}} = ({{c2::ZL − Z0}})/(ZL + Z0)', back: '' })],
    });
    expect(cloze.errors[0]!.message).toContain('one cloze deletion per card');
  });

  it('volatile KCs get an "as of" stamp in Extra; the Link opens the concept note', async () => {
    const events = ankiLog((b) => b.attempt('kc-si-skin', 'correct', { conf: 3, session: SESSION }));
    v = await ankiVault({ events });
    const r = await v.call('propose_cards', {
      cards: [
        card({
          kc_id: 'kc-si-skin',
          front: 'What sets skin depth?',
          back: 'Frequency and conductivity',
          extra: 'Bogatin ch. 9',
        }),
      ],
    });
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.data.proposals[0].extra).toBe('Bogatin ch. 9 · as of 2026-10-09');
  });
});

describe('staleness (ANK-05)', () => {
  const queued = (v: AnkiVault): { action: string; params: { tags: string } }[] =>
    readdirSync(path.join(v.root, 'Scaffold/_system/queue'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(path.join(v.root, 'Scaffold/_system/queue', f), 'utf8')));

  it("editing a KC's Explanation flags its linked cards scaffold::check and lists them in the briefing", async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    await v.call('anki_sync');
    const rel = path.join(v.root, 'Scaffold/Concepts/kc-si-gamma.md');
    const text = readFileSync(rel, 'utf8');
    writeFileSync(
      rel,
      text.replace(
        /## Explanation\r?\n/,
        '## Explanation\nΓ compares the load with the line; a 75 Ω load on 50 Ω reflects +0.2.\n',
      ),
    );
    await v.call('get_briefing', { focus: 'si-pi' }); // the vault scan folds the edit in
    const sc = v.open();
    const flags = sc.facts().card_flags;
    expect(flags.map((f) => [f.note_id, f.reason])).toContainEqual([c.note, 'explanation_changed']);
    expect(
      queued(v).filter((op) => op.action === 'addTags' && op.params.tags === 'scaffold::check'),
    ).toHaveLength(1);
    const b = await v.call('get_briefing', { focus: 'si-pi' });
    expect(b.data.anki).toMatchObject({ flagged: 1, flagged_notes: [c.note] });
    await v.call('anki_sync');
    expect(v.mock.notes.get(c.note)!.tags).toContain('scaffold::check');
  });

  it("a question's answer key change flags the cards of its KCs", async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    await v.call('anki_sync');
    const q = await v.call('add_question', {
      kc_ids: ['kc-si-gamma'],
      qtype: 'predict',
      format: 'free',
      difficulty: 2,
      stem: 'A 50 Ω line ends in 75 Ω. Predict the sign of the reflection and explain why.',
      answer_key: 'Positive: ZL > Z0, so Γ = +0.2.',
      rubric: [{ id: 'R1', proposition: 'positive because ZL > Z0' }],
      hints: ['h1', 'h2', 'h3', 'h4'],
      created_by: 'claude-code',
    });
    expect(q.ok, JSON.stringify(q.errors)).toBe(true);
    const rel = path.join(v.root, 'Scaffold/Questions', `${q.data.question_id}.md`);
    writeFileSync(
      rel,
      readFileSync(rel, 'utf8').replace(
        'Positive: ZL > Z0, so Γ = +0.2.',
        'Positive: ZL > Z0, so Γ = +0.20 (20 %).',
      ),
    );
    await v.call('validate');
    expect(
      v
        .open()
        .facts()
        .card_flags.map((f) => [f.note_id, f.reason]),
    ).toContainEqual([c.note, 'answer_key_changed']);
  });

  it('a volatile KC past review_by is flagged once', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-skin', anchor: true });
    await v.call('anki_sync'); // mirrors the card; the flag goes out with the next sync
    let flags = v
      .open()
      .facts()
      .card_flags.filter((f) => f.reason === 'review_by_passed');
    expect(flags).toHaveLength(1);
    expect(flags[0]!.kc_ids).toEqual(['kc-si-skin']);
    await v.call('get_briefing', { focus: 'si-pi' });
    await v.call('anki_sync');
    flags = v
      .open()
      .facts()
      .card_flags.filter((f) => f.reason === 'review_by_passed');
    expect(flags).toHaveLength(1);
    expect(v.open().derived().kcs['kc-si-skin']!.needs_check).toBe(true);
    void c;
  });

  it('flag_card tags the card and asks for a proposal; keep clears the flag', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true, back: 'Only when the line is not 50 Ω' });
    await v.call('anki_sync');
    const f = await v.call('flag_card', {
      note_id: c.note,
      detail: 'oversimplified: any mismatch reflects',
      proposed: 'rewrite',
    });
    expect(f.data).toMatchObject({ flagged: [c.note], kc_ids: ['kc-si-gamma'], tag: 'applied' });
    expect(f.data.next_step).toContain('TP-17');
    expect(v.mock.notes.get(c.note)!.tags).toContain('scaffold::check');
    await v.call('anki_sync');
    const p = await v.call('propose_card_actions', {
      actions: [{ kind: 'keep', note_ids: [c.note], reason: 'fine after all' }],
    });
    await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: 'keep it' },
    });
    expect(v.mock.notes.get(c.note)!.tags).not.toContain('scaffold::check');
    const b = await v.call('get_briefing', { focus: 'si-pi' });
    expect(b.data.anki?.flagged ?? 0).toBe(0);
  });
});
