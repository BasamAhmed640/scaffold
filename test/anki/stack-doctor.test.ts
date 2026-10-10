import { afterEach, describe, expect, it } from 'vitest';
import { ankiLog, ankiVault, seedCard, SESSION, type AnkiVault } from '../helpers/anki-vault.js';
import { cleanupAll } from '../helpers/vault.js';

// V-ANKI: custom stack search strings (golden, ANK-01) matching exactly the intended cards of a
// fixture collection, and doctor's Anki checks (version, closed, FSRS, structure).

let v: AnkiVault | null = null;
afterEach(async () => {
  await v?.mock.stop();
  v = null;
  cleanupAll();
});

describe('custom stacks (ANK-01)', () => {
  it('search strings select exactly the intended cards', async () => {
    const events = ankiLog((b) => {
      b.attempt('kc-si-open-short', 'incorrect', {
        conf: 4,
        session: SESSION,
        mid: 'M-0001',
        belief: 'An open end inverts the reflection',
      });
      b.push({
        type: 'misconception_opened',
        misconception_id: 'M-0001',
        kc_ids: ['kc-si-open-short'],
        belief: 'An open end inverts the reflection',
        session_id: SESSION,
        attempt_id: null,
        by: 'claude-code',
      });
    });
    v = await ankiVault({ events });
    const m = v.mock;
    const gammaA = seedCard(m, { kc: 'kc-si-gamma', anchor: true });
    const gammaD = seedCard(m, { kc: 'kc-si-gamma', tags: ['scaffold::check'] });
    const z0 = seedCard(m, { kc: 'kc-si-z0', anchor: true });
    const td = seedCard(m, { kc: 'kc-si-td', anchor: true, tags: ['scope::dormant'], card: { queue: -1 } });
    const os = seedCard(m, { kc: 'kc-si-open-short', anchor: true });
    const iv = seedCard(m, { kc: 'kc-mt-intervals', anchor: true });
    const sc = seedCard(m, { kc: 'kc-mt-scale', anchor: true, tags: ['topic::modes'] });
    m.seed({
      deck: 'Default',
      fields: { Front: 'not a Scaffold card', Back: 'x' },
      tags: ['kc::kc-si-gamma'],
    });
    await v.call('anki_sync');
    const cases: [Record<string, unknown>, number[]][] = [
      [{ name: 'SI/PI all', subject: 'si-pi' }, [gammaA.note, gammaD.note, z0.note, os.note]],
      [{ name: 'Check', status: 'check' }, [gammaD.note]],
      [
        { name: 'Fragile SI/PI', subject: 'signal integrity', status: 'fragile' },
        [gammaA.note, gammaD.note, z0.note],
      ],
      [{ name: 'Misconceptions', status: 'misconception' }, [os.note]],
      [{ name: 'Modes', kc_ids: ['kc-mt-scale'], tags: ['topic::modes'] }, [sc.note]],
      [{ name: 'Music', subject: 'Music theory' }, [iv.note, sc.note]],
    ];
    const golden: Record<string, string> = {};
    for (const [input, want] of cases) {
      const r = await v.call('anki_stack', input);
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      golden[String(input.name)] = r.data.search;
      const notes = (s: string): number[] => [...new Set(m.find(s).map((c) => c.note))].sort();
      expect(notes(r.data.search), String(input.name)).toEqual([...want].sort());
      expect(r.data.matching_cards).toBe(want.length);
    }
    await expect(JSON.stringify(golden, null, 2)).toMatchFileSnapshot('../golden/anki/stacks.json');
    const empty = await v.call('anki_stack', { name: 'x', status: 'forgotten' });
    expect(empty.errors[0]).toMatchObject({ code: 'empty_stack' });
    void td;
  });
});

describe('doctor: Anki (ANK-01, ANK-09)', () => {
  const check = async (v: AnkiVault, id: string) =>
    (await v.call('doctor')).data.checks.find((c: { id: string }) => c.id === id);

  it('Anki closed: one specific message with the add-on code', async () => {
    v = await ankiVault({ online: false });
    const c = await check(v, 'anki');
    expect(c.ok).toBe(false);
    expect(c.message).toContain('Anki is closed or AnkiConnect is missing');
    expect(c.next_step).toContain('2055492159');
  });

  it('wrong AnkiConnect version', async () => {
    v = await ankiVault();
    v.mock.version = 5;
    const c = await check(v, 'anki');
    expect(c).toMatchObject({ ok: false, message: 'AnkiConnect API version 5; expected 6.' });
    expect(c.next_step).toContain('Check for Updates');
  });

  it('FSRS off, a card outside its subject deck, and a subject deck with subdecks', async () => {
    v = await ankiVault();
    v.mock.fsrs = false;
    v.mock.seed({
      deck: 'Scaffold::Music theory',
      fields: { Front: 'Γ?', Back: 'x' },
      tags: ['scaffold', 'subj::si-pi', 'kc::kc-si-gamma'],
    });
    v.mock.decks.add('Scaffold::SI/PI::Reflections');
    const sync = await v.call('anki_sync');
    expect(sync.warnings.join(' ')).toContain('FSRS is off');
    expect(await check(v, 'anki_fsrs')).toMatchObject({ ok: false });
    const decks = await check(v, 'anki_decks');
    expect(decks.ok).toBe(false);
    expect(decks.message).toMatch(
      /1 card\(s\) sit outside their subject's deck, e\.g\. note \d+ in "Scaffold::Music theory" tagged subj::si-pi/,
    );
    expect(await check(v, 'anki_subdecks')).toMatchObject({
      ok: false,
      message: 'Subject deck "Scaffold::SI/PI" has subdecks; topics are tags, not subdecks.',
    });
  });

  it('a healthy collection passes', async () => {
    v = await ankiVault();
    seedCard(v.mock, { kc: 'kc-si-gamma', anchor: true });
    await v.call('anki_sync');
    const checks = (await v.call('doctor')).data.checks.filter((c: { id: string }) =>
      c.id.startsWith('anki'),
    );
    expect(checks.map((c: { id: string; ok: boolean }) => [c.id, c.ok])).toEqual([
      ['anki', true],
      ['anki_fsrs', true],
      ['anki_decks', true],
      ['anki_subdecks', true],
      ['anki_budgets', true],
    ]);
  });
});
