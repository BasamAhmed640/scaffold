import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMISSION, ankiVault, seedCard, SESSION, type AnkiVault } from '../helpers/anki-vault.js';
import { cleanupAll } from '../helpers/vault.js';

// V-ANKI against the mock AnkiConnect: sync (ANK-08), offline queue (ANK-09), never overwrite
// Anki's text, reset on a changed answer, approval, never delete (ANK-04).

let v: AnkiVault | null = null;
afterEach(async () => {
  await v?.mock.stop();
  v = null;
  cleanupAll();
});

const mutating = [
  'addNotes',
  'updateNoteFields',
  'suspend',
  'unsuspend',
  'forgetCards',
  'addTags',
  'removeTags',
  'createDeck',
  'createModel',
];

describe('sync (ANK-08)', () => {
  it('creates note types and subject decks, mirrors cards and imports reviews once', async () => {
    v = await ankiVault({ structure: false });
    const a = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true, card: { type: 2, queue: 2, ivl: 12 } });
    v.mock.answer(a.card, 3);
    const r = await v.call('anki_sync');
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    expect(r.data.created.note_types).toEqual(['Scaffold Basic', 'Scaffold Cloze']);
    expect(r.data.created.decks).toEqual(['Scaffold', 'Scaffold::SI/PI', 'Scaffold::Music theory']);
    expect(r.data).toMatchObject({ online: true, api_version: 6, cards: 1, reviews_imported: 1, lapses: 0 });
    const mirror = JSON.parse(readFileSync(path.join(v.root, 'Scaffold/_system/anki-mirror.json'), 'utf8'));
    expect(mirror.cards[0]).toMatchObject({
      note_id: a.note,
      subject: 'si-pi',
      kc_ids: ['kc-si-gamma'],
      anchor: true,
      home_deck: 'Scaffold::SI/PI',
    });
    const again = await v.call('anki_sync');
    expect(again.data).toMatchObject({ reviews_imported: 0, created: { decks: [], note_types: [] } });
  });

  it('a lapse ("Again" on a review card) on the anchor makes the KC forgotten; on another card, needs_check', async () => {
    v = await ankiVault();
    const anchor = seedCard(v.mock, {
      kc: 'kc-si-gamma',
      anchor: true,
      card: { type: 2, queue: 2, ivl: 20 },
    });
    const detail = seedCard(v.mock, { kc: 'kc-si-td', card: { type: 2, queue: 2, ivl: 9 } });
    // after this session's correct retrieval of Γ (17:30), so the anchor lapse is the latest evidence
    v.mock.now = Date.parse('2026-10-09T17:45:00-04:00');
    v.mock.answer(anchor.card, 1);
    v.mock.answer(detail.card, 1);
    const r = await v.call('anki_sync');
    expect(r.data.lapses).toBe(2);
    const sc = v.open();
    const d = sc.derived();
    expect(d.kcs['kc-si-gamma']!.status).toBe('forgotten');
    expect(d.kcs['kc-si-td']!.needs_check).toBe(true);
    const ev = sc.events().find((e) => e.type === 'anki_reviews_imported')!;
    expect(
      ev.type === 'anki_reviews_imported' && ev.reviews.map((x) => [x.ease, x.revlog_type, x.lapse]),
    ).toEqual([
      [1, 1, true],
      [1, 1, true],
    ]);
  });

  it('a learning-step "Again" is not a lapse; a new leech tag flags the KC once', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-td' });
    v.mock.answer(c.card, 1); // new card: revlog type 0
    await v.call('anki_sync');
    v.mock.notes.get(c.note)!.tags.push('leech');
    const r = await v.call('anki_sync');
    expect(r.data).toMatchObject({ lapses: 0, flags: { leech: 1 } });
    expect((await v.call('anki_sync')).data.flags.leech).toBe(0);
    expect(v.open().derived().kcs['kc-si-td']!.needs_check).toBe(true);
  });

  it('a card in a filtered deck keeps its home deck (judged by its subject tag)', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    v.mock.decks.add('Cram');
    v.mock.cards.get(c.card)!.odeck = 'Scaffold::SI/PI';
    v.mock.cards.get(c.card)!.deck = 'Cram';
    await v.call('anki_sync');
    const mirror = JSON.parse(readFileSync(path.join(v.root, 'Scaffold/_system/anki-mirror.json'), 'utf8'));
    expect(mirror.cards[0]).toMatchObject({ deck: 'Cram', home_deck: 'Scaffold::SI/PI' });
    const doc = await v.call('doctor');
    expect(doc.data.checks.find((x: { id: string }) => x.id === 'anki_decks')).toMatchObject({ ok: true });
  });
});

describe('offline queue (ANK-09)', () => {
  it('Anki closed: 3 operations are queued; after reopening, one sync applies each exactly once', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true, card: { type: 2, queue: 2, ivl: 9 } });
    await v.call('anki_sync');
    await v.mock.stop();
    const before = v.mock.requests.length;
    const s = await v.call('upsert_subject', { title: 'Spanish', aliases: ['español'] });
    expect(s.data.anki_deck.status).toBe('queued');
    const f = await v.call('flag_card', { note_id: c.note, detail: 'oversimplified', proposed: 'rewrite' });
    expect(f.data.tag).toBe('queued');
    const p = await v.call('propose_card_actions', {
      actions: [
        {
          kind: 'retire',
          note_ids: [c.note],
          reason: 'superseded by a better card',
          retire_reason: 'superseded',
        },
      ],
    });
    const ap = await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: 'Yes, retire it.' },
    });
    expect(ap.data.results[0].result).toBe('queued');
    expect(v.mock.requests.length).toBe(before); // nothing reached Anki
    expect(
      readdirSync(path.join(v.root, 'Scaffold/_system/queue')).filter((x) => x.endsWith('.json')),
    ).toHaveLength(4); // createDeck, addTags, suspend + addTags
    const offline = await v.call('anki_sync');
    expect(offline.data).toMatchObject({ online: false, replayed: { still_queued: 4 } });
    await v.mock.restart();
    const r = await v.call('anki_sync');
    expect(r.data.replayed).toEqual({ applied: 4, failed: 0, still_queued: 0 });
    const replayed = v.mock.requests.slice(before);
    expect(
      replayed.filter((x) => x.action === 'createDeck' && x.params.deck === 'Scaffold::Spanish'),
    ).toHaveLength(1);
    expect(replayed.filter((x) => x.action === 'suspend')).toHaveLength(1);
    expect(replayed.filter((x) => x.action === 'addTags')).toHaveLength(2);
    expect(v.mock.notes.get(c.note)!.tags).toEqual(
      expect.arrayContaining(['scaffold::check', 'retired::superseded']),
    );
    expect(v.mock.cards.get(c.card)!.queue).toBe(-1);
    const applied = v.open().facts().card_actions[p.data.actions[0].action_id]!;
    expect(applied.result).toBe('applied');
    const n = v.mock.requests.length;
    const again = await v.call('anki_sync');
    expect(again.data.replayed).toEqual({ applied: 0, failed: 0, still_queued: 0 });
    expect(v.mock.requests.slice(n).some((x) => mutating.includes(x.action))).toBe(false);
  });

  it('upsert_subject creates the deck right away when Anki answers', async () => {
    v = await ankiVault();
    const s = await v.call('upsert_subject', { title: 'Spanish' });
    expect(s.data.anki_deck).toEqual({ name: 'Scaffold::Spanish', status: 'created' });
    expect(v.mock.decks.has('Scaffold::Spanish')).toBe(true);
  });
});

describe('card text (ANK-08) and resets (ANK-04)', () => {
  it('a card edited in Anki after the proposal is not overwritten', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true, front: 'Γ formula?', back: 'old' });
    await v.call('anki_sync');
    const p = await v.call('propose_card_actions', {
      actions: [{ kind: 'rewrite', note_ids: [c.note], reason: 'clearer', fields: { Back: 'new text' } }],
    });
    v.mock.now += 120_000;
    v.mock.notes.get(c.note)!.fields.Back = 'edited by the owner in Anki';
    v.mock.notes.get(c.note)!.mod += 50;
    const r = await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: 'yes' },
    });
    expect(r.data.results[0]).toMatchObject({ result: 'aborted' });
    expect(r.data.results[0].detail).toContain('ANK-08');
    expect(v.mock.notes.get(c.note)!.fields.Back).toBe('edited by the owner in Anki');
    expect(v.mock.requests.some((x) => x.action === 'updateNoteFields')).toBe(false);
  });

  it('sync never pushes text for existing notes', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    await v.call('anki_sync');
    v.mock.notes.get(c.note)!.fields.Front = 'changed in Anki';
    await v.call('anki_sync');
    expect(v.mock.requests.some((x) => x.action === 'updateNoteFields')).toBe(false);
    const mirror = JSON.parse(readFileSync(path.join(v.root, 'Scaffold/_system/anki-mirror.json'), 'utf8'));
    expect(mirror.cards[0].front).toBe('changed in Anki'); // Anki is the source of truth; Scaffold mirrors it
  });

  it('an approved rewrite with a changed answer calls forgetCards; the card is new and keeps its review history', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, {
      kc: 'kc-si-gamma',
      anchor: true,
      back: 'Γ = (Z0 − ZL)/(Z0 + ZL)',
      card: { type: 2, queue: 2, ivl: 30 },
    });
    v.mock.answer(c.card, 3);
    v.mock.answer(c.card, 3);
    await v.call('anki_sync');
    const p = await v.call('propose_card_actions', {
      actions: [
        {
          kind: 'rewrite',
          note_ids: [c.note],
          reason: 'the sign was wrong',
          fields: { Back: 'Γ = (ZL − Z0)/(ZL + Z0)' },
        },
      ],
    });
    const r = await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: 'Yes, fix it and reset it.' },
    });
    expect(r.data.results[0]).toMatchObject({ result: 'applied' });
    expect(v.mock.requests.filter((x) => x.action === 'forgetCards')).toEqual([
      { action: 'forgetCards', params: { cards: [c.card] } },
    ]);
    expect(v.mock.cards.get(c.card)).toMatchObject({ type: 0, queue: 0 });
    const reviews = await v.mock
      .client()
      .invoke<Record<string, unknown[]>>('getReviewsOfCards', { cards: [c.card] });
    expect(reviews[String(c.card)]).toHaveLength(2);
  });

  it('a rewrite that keeps the answer does not reset', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, {
      kc: 'kc-si-gamma',
      anchor: true,
      back: 'same',
      card: { type: 2, queue: 2, ivl: 30 },
    });
    await v.call('anki_sync');
    const p = await v.call('propose_card_actions', {
      actions: [
        {
          kind: 'rewrite',
          note_ids: [c.note],
          reason: 'wording',
          fields: { Front: 'Why does Γ depend on the load?' },
        },
      ],
    });
    await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: 'ok' },
    });
    expect(v.mock.requests.some((x) => x.action === 'forgetCards')).toBe(false);
    expect(v.mock.notes.get(c.note)!.fields.Front).toBe('Why does Γ depend on the load?');
  });
});

describe('approval (ANK-04, TP-17)', () => {
  it('proposals do not touch Anki; applying needs the learner’s quoted approval', async () => {
    v = await ankiVault();
    const c = seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    await v.call('anki_sync');
    const n = v.mock.requests.length;
    const p = await v.call('propose_card_actions', {
      actions: [{ kind: 'retire', note_ids: [c.note], reason: 'outdated' }],
    });
    await v.call('propose_cards', {
      cards: [
        {
          kc_id: 'kc-si-z0',
          front: 'What sets Z0 of a line?',
          back: 'Its L and C per length',
          anchor: true,
          admission: ADMISSION,
        },
      ],
    });
    expect(v.mock.requests.slice(n).some((x) => mutating.includes(x.action))).toBe(false);
    const bad = await v.call('apply_card_actions', {
      action_ids: [p.data.actions[0].action_id],
      approval: { learner_quote: '' },
    });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.errors)).toContain('quote the learner’s explicit approval');
    expect(v.mock.requests.slice(n).some((x) => mutating.includes(x.action))).toBe(false);
  });

  it('every state change in Anki follows a card_action_applied event with the quote', async () => {
    v = await ankiVault();
    await v.call('propose_cards', {
      session_id: SESSION,
      cards: [
        {
          kc_id: 'kc-si-gamma',
          front: 'Why does a mismatch reflect?',
          back: 'Γ = (ZL − Z0)/(ZL + Z0)',
          anchor: true,
          admission: ADMISSION,
        },
      ],
    });
    const pending = (await v.call('list_card_actions')).data.actions;
    expect(pending).toHaveLength(1);
    const r = await v.call('apply_card_actions', {
      action_ids: [pending[0].action_id],
      approval: { learner_quote: 'Looks good, add it.' },
    });
    expect(r.data.results[0]).toMatchObject({ result: 'applied', created_note_ids: [expect.any(Number)] });
    const applied = v
      .open()
      .events()
      .filter((e) => e.type === 'card_action_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.type === 'card_action_applied' && applied[0]!.approval.learner_quote).toBe(
      'Looks good, add it.',
    );
    const added = v.mock.requests.find((x) => x.action === 'addNotes')!;
    const note = (
      added.params.notes as { deckName: string; tags: string[]; fields: Record<string, string> }[]
    )[0]!;
    expect(note.deckName).toBe('Scaffold::SI/PI');
    expect(note.tags).toEqual(['scaffold', 'subj::si-pi', 'kc::kc-si-gamma', 'anchor']);
    expect(note.fields.Link).toMatch(
      /^obsidian:\/\/open\?vault=Vault&file=Scaffold%2FConcepts%2Fkc-si-gamma$/,
    );
    const again = await v.call('apply_card_actions', {
      action_ids: [pending[0].action_id],
      approval: { learner_quote: 'again' },
    });
    expect(again.data.results[0]).toMatchObject({ result: 'skipped' });
  });
});

describe('never deletes (ANK-04)', () => {
  it('no deleteNotes or deleteDecks anywhere in the source', () => {
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(f)) files.push(p);
      }
    };
    walk('src');
    walk('scripts');
    const hits = files.filter((f) => /deleteNotes|deleteDecks/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('retirement and dormancy only suspend and tag', async () => {
    v = await ankiVault();
    const a = seedCard(v.mock, { kc: 'kc-mt-intervals', anchor: true });
    const b = seedCard(v.mock, { kc: 'kc-mt-intervals' });
    await v.call('anki_sync');
    const p = await v.call('propose_card_actions', {
      actions: [
        { kind: 'retire', note_ids: [a.note], reason: 'duplicate', retire_reason: 'duplicate' },
        { kind: 'dormant', note_ids: [b.note], reason: 'goal finished' },
      ],
    });
    await v.call('apply_card_actions', {
      action_ids: p.data.actions.map((x: { action_id: string }) => x.action_id),
      approval: { learner_quote: 'yes to both' },
    });
    expect(v.mock.notes.size).toBe(2);
    expect(v.mock.cards.get(a.card)!.queue).toBe(-1);
    expect(v.mock.cards.get(b.card)!.queue).toBe(-1);
    expect(v.mock.notes.get(a.note)!.tags).toContain('retired::duplicate');
    expect(v.mock.notes.get(b.note)!.tags).toEqual(
      expect.arrayContaining(['scope::dormant', 'scope::dormant::2026-10-09::goal-finished']),
    );
    const actions = new Set(v.mock.actions());
    expect([...actions].filter((x) => /delete/i.test(x))).toEqual([]);
  });
});
