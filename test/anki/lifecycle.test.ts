import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMISSION, ankiVault, seedCard, type AnkiVault } from '../helpers/anki-vault.js';
import { cleanupAll } from '../helpers/vault.js';

// V-ANKI: card lifecycle details (ANK-02, ANK-04, ANK-06, ANK-10).

let v: AnkiVault | null = null;
afterEach(async () => {
  await v?.mock.stop();
  v = null;
  cleanupAll();
});

const proposeGamma = (v: AnkiVault, over: Record<string, unknown> = {}) =>
  v.call('propose_cards', {
    cards: [
      {
        kc_id: 'kc-si-gamma',
        front: 'Why does a mismatched load reflect?',
        back: 'Γ = (ZL − Z0)/(ZL + Z0)',
        anchor: true,
        admission: ADMISSION,
        ...over,
      },
    ],
  });

describe('a fresh collection (found by the live smoke test, D-85)', () => {
  it('approving a card before any sync creates the note types and decks first (ANK-01)', async () => {
    v = await ankiVault({ structure: false });
    expect(v.mock.models.size).toBe(0);
    const p = await proposeGamma(v);
    const ids = (p.data.proposals as { action_id: string }[]).map((x) => x.action_id);
    const r = await v.call('apply_card_actions', {
      action_ids: ids,
      approval: { learner_quote: 'yes, add it' },
    });
    expect(r.data.results[0]).toMatchObject({ result: 'applied' });
    expect([...v.mock.models.keys()].sort()).toEqual(['Scaffold Basic', 'Scaffold Cloze']);
    expect(v.mock.decks.has('Scaffold::SI/PI')).toBe(true);
    expect(v.mock.notes.size).toBe(1);
  });

  it('an add queued while Anki was closed replays after the structure is created', async () => {
    v = await ankiVault({ structure: false, online: false });
    const p = await proposeGamma(v);
    const ids = (p.data.proposals as { action_id: string }[]).map((x) => x.action_id);
    const queued = await v.call('apply_card_actions', {
      action_ids: ids,
      approval: { learner_quote: 'yes' },
    });
    expect(queued.data.results[0]).toMatchObject({ result: 'queued' });
    await v.mock.restart();
    const sync = await v.call('anki_sync');
    expect(sync.data.replayed).toMatchObject({ applied: 1, failed: 0 });
    expect(v.mock.notes.size).toBe(1);
  });
});

describe('card lifecycle', () => {
  it('the learner edits a proposed card before approving it', async () => {
    v = await ankiVault();
    const p = await proposeGamma(v);
    const id = p.data.proposals[0].action_id;
    await v.call('apply_card_actions', {
      action_ids: [id],
      approval: { learner_quote: 'Yes, but say "fraction of the incident voltage" on the back.' },
      edits: {
        [id]: { back: 'Γ = (ZL − Z0)/(ZL + Z0): the fraction of the incident voltage that reflects' },
      },
    });
    const note = [...v.mock.notes.values()][0]!;
    expect(note.fields.Back).toBe(
      'Γ = (ZL − Z0)/(ZL + Z0): the fraction of the incident voltage that reflects',
    );
  });

  it('a cloze card uses the Scaffold Cloze note type', async () => {
    v = await ankiVault();
    const p = await proposeGamma(v, {
      note_type: 'cloze',
      front: 'Γ = {{c1::(ZL − Z0)/(ZL + Z0)}}',
      back: '',
    });
    expect(p.ok, JSON.stringify(p.errors)).toBe(true);
    await v.call('apply_card_actions', {
      action_ids: [p.data.proposals[0].action_id],
      approval: { learner_quote: 'ok' },
    });
    const note = [...v.mock.notes.values()][0]!;
    expect(note.model).toBe('Scaffold Cloze');
    expect(note.fields.Text).toBe('Γ = {{c1::(ZL − Z0)/(ZL + Z0)}}');
  });

  it('a card added while new cards are paused starts paused (suspended on the next sync)', async () => {
    v = await ankiVault();
    seedCard(v.mock, { kc: 'kc-si-z0', anchor: true });
    await v.call('anki_sync');
    const pause = await v.call('propose_card_actions', {
      actions: [{ kind: 'pause_new', subject: 'si-pi', reason: 'over budget' }],
    });
    const ap = await v.call('apply_card_actions', {
      action_ids: [pause.data.actions[0].action_id],
      approval: { learner_quote: 'pause them' },
    });
    expect(ap.data.results[0]).toMatchObject({ result: 'applied' });
    const p = await proposeGamma(v);
    const add = await v.call('apply_card_actions', {
      action_ids: [p.data.proposals[0].action_id],
      approval: { learner_quote: 'add it' },
    });
    expect(add.data.results[0].detail).toContain('new cards paused');
    const note = [...v.mock.notes.values()].find((n) => n.tags.includes('kc::kc-si-gamma'))!;
    expect(note.tags).toContain('scaffold::new-paused');
    const sync = await v.call('anki_sync');
    expect(sync.data.budget.paused_new).toBe(1);
    const card = [...v.mock.cards.values()].find((c) => c.note === note.id)!;
    expect(card.queue).toBe(-1);
    const unpause = await v.call('propose_card_actions', {
      actions: [{ kind: 'unpause_new', subject: 'si-pi', reason: 'under budget' }],
    });
    await v.call('apply_card_actions', {
      action_ids: [unpause.data.actions[0].action_id],
      approval: { learner_quote: 'yes' },
    });
    expect(card.queue).toBe(0);
    expect(note.tags).not.toContain('scaffold::new-paused');
  });

  it('compression folds detail cards into the anchor and retires them (superseded)', async () => {
    v = await ankiVault();
    const anchor = seedCard(v.mock, { kc: 'kc-mt-intervals', anchor: true, back: 'C–G is a perfect fifth' });
    const d1 = seedCard(v.mock, { kc: 'kc-mt-intervals', back: 'a fifth is 7 semitones' });
    const d2 = seedCard(v.mock, { kc: 'kc-mt-intervals', back: 'a fourth is 5 semitones' });
    await v.call('anki_sync');
    const p = await v.call('propose_card_actions', {
      actions: [
        {
          kind: 'compress',
          note_ids: [anchor.note, d1.note, d2.note],
          reason: 'solid and passed transfer',
          fields: { Back: 'C–G is a perfect fifth (7 semitones); a fourth is 5' },
        },
      ],
    });
    const r = await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: 'yes, compress' },
    });
    expect(r.data.results[0]).toMatchObject({ result: 'applied' });
    expect(v.mock.notes.get(anchor.note)!.fields.Back).toBe(
      'C–G is a perfect fifth (7 semitones); a fourth is 5',
    );
    for (const d of [d1, d2]) {
      expect(v.mock.cards.get(d.card)!.queue).toBe(-1);
      expect(v.mock.notes.get(d.note)!.tags).toContain('retired::superseded');
    }
    expect(v.mock.cards.get(anchor.card)!.queue).not.toBe(-1);
  });

  it('the weekly report shows Anki minutes against budget, active cards, reviews, intake and cards per solid KC (ANK-10)', async () => {
    v = await ankiVault();
    const a = seedCard(v.mock, { kc: 'kc-si-z0', anchor: true, card: { type: 2, queue: 2, ivl: 4 } });
    v.mock.now = Date.parse('2026-10-08T12:00:00Z');
    v.mock.answer(a.card, 3, 12_000);
    await v.call('anki_sync');
    const { weeklyReport } = await import('../../src/core/service/ops/reports.js');
    const { Warnings } = await import('../../src/core/envelope.js');
    weeklyReport(v.open(), '2026-10-09', new Warnings());
    const text = readFileSync(path.join(v.root, 'Scaffold/Learner/Weekly/2026-10-09.md'), 'utf8');
    expect(text).toContain(
      '| Subject | Anki min/day (7 d) | Budget | Active cards | Est. reviews/day | Intake (year) | Cards per solid KC |',
    );
    expect(text).toMatch(/\| si-pi \| 0\.03 \| 7\.5 \| 1 \| 0\.\d+ \| 1\/547 \| – \|/);
    expect(text).toContain('| **Total** |');
    expect(text).toContain('deck size is a cost, not an achievement');
  });
});
