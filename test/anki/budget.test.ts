import fc from 'fast-check';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { budgetProposals, rankForDormancy, scopeProposals } from '../../src/core/anki/controller.js';
import { computeLoad, splitNewCards, type LoadReport } from '../../src/core/anki/load.js';
import type { AnkiMirror, MirrorCard } from '../../src/core/anki/mirror.js';
import { protectedSet } from '../../src/core/anki/protected.js';
import { defaultConfig } from '../../src/core/config.js';
import type { DerivedState, KcState } from '../../src/core/model/derive.js';
import { emptyFacts } from '../../src/core/model/reducer.js';
import type { SubjectFields } from '../../src/core/schemas/subject.js';
import { ankiLog, ankiVault, seedCard, type AnkiVault } from '../helpers/anki-vault.js';
import { cleanupAll } from '../helpers/vault.js';

// V-ANKI: budget split, over-budget sequence, goal scope (ANK-06, ANK-07) and the protected set.

let v: AnkiVault | null = null;
afterEach(async () => {
  await v?.mock.stop();
  v = null;
  cleanupAll();
});

const subject = (
  id: string,
  scope: 'active' | 'paused' | 'closed',
  anki_minutes: number | 'auto' = 'auto',
): SubjectFields =>
  ({
    id,
    title: id,
    aliases: [],
    goals: [],
    scope,
    anki_minutes,
    anki_deck: `Scaffold::${id}`,
  }) as SubjectFields;

const mcard = (
  o: Partial<MirrorCard> & { card_id: number; subject: string; kc_ids: string[] },
): MirrorCard => ({
  note_id: o.card_id + 1_000_000,
  deck: `Scaffold::${o.subject}`,
  home_deck: `Scaffold::${o.subject}`,
  anchor: false,
  tags: ['scaffold', `subj::${o.subject}`, ...o.kc_ids.map((k) => `kc::${k}`)],
  model: 'Scaffold Basic',
  fields: {},
  front: 'f',
  back: 'b',
  interval: 10,
  queue: 2,
  type: 2,
  lapses: 0,
  reps: 3,
  suspended: false,
  due: 0,
  note_mod: 0,
  ...o,
});

describe('budget split (ANK-06)', () => {
  it('fixed budgets are used as set; auto subjects split what is left after maintenance equally', () => {
    const cfg = defaultConfig();
    const mirror: AnkiMirror = {
      synced_at: '',
      api_version: 6,
      avg_seconds_per_review: 6,
      fsrs_enabled: true,
      decks: [],
      // paused subject: one active anchor reviewed daily → 6 s/day = 0.1 min of maintenance
      cards: [mcard({ card_id: 1, subject: 'old', kc_ids: ['kc-o'], anchor: true, interval: 1 })],
    };
    const load = computeLoad(
      [subject('a', 'active', 5), subject('b', 'active'), subject('c', 'active'), subject('old', 'paused')],
      mirror,
      emptyFacts(),
      cfg,
      new Date('2026-10-09T12:00:00Z'),
    );
    const by = Object.fromEntries(load.subjects.map((r) => [r.subject, r]));
    expect(load.maintenance).toMatchObject({ active_cards: 1, estimated_min: 0.1 });
    expect(by.a!.budget_min).toBe(5);
    expect(by.b!.budget_min).toBe(4.95); // (15 − 0.1 − 5) ÷ 2
    expect(by.c!.budget_min).toBe(4.95);
    expect(by.old!.budget_min).toBe(0);
    expect(by.a!.intake.budget).toBe(365); // 5 × 365 ÷ 5
    expect(load.warnings).toEqual([]);
  });

  it('fixed budgets above the total produce a doctor warning', async () => {
    const events = ankiLog((b) => {
      b.push({
        type: 'subject_updated',
        subject: {
          id: 'si-pi',
          title: 'SI/PI',
          aliases: ['signal integrity'],
          goals: [],
          scope: 'active',
          anki_minutes: 12,
          anki_deck: 'Scaffold::SI/PI',
        },
        changed: ['anki_minutes'],
      });
      b.push({
        type: 'subject_updated',
        subject: {
          id: 'music-theory',
          title: 'Music theory',
          aliases: ['music'],
          goals: [],
          scope: 'active',
          anki_minutes: 8,
          anki_deck: 'Scaffold::Music theory',
        },
        changed: ['anki_minutes'],
      });
    });
    v = await ankiVault({ events });
    for (const s of ['si-pi', 'music-theory']) {
      const rel = path.join(v.root, 'Scaffold/Subjects', `${s}.md`);
      writeFileSync(
        rel,
        readFileSync(rel, 'utf8').replace(/anki_minutes: auto/, `anki_minutes: ${s === 'si-pi' ? 12 : 8}`),
      );
    }
    const d = await v.call('doctor');
    const check = d.data.checks.find((c: { id: string }) => c.id === 'anki_budgets');
    expect(check).toMatchObject({ ok: false });
    expect(check.message).toContain('Fixed Anki budgets add up to 20 min/day, more than the total of 15');
  });

  it('recommended new-card limits split the total in proportion to budgets, at least 1 each', () => {
    expect(splitNewCards(4, [5, 5])).toEqual([2, 2]);
    expect(splitNewCards(4, [10, 2.5, 2.5])).toEqual([2, 1, 1]);
    expect(splitNewCards(4, [1, 1, 1, 1, 1])).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('over budget (ANK-06)', () => {
  /** Puts `minutes` per day of measured review time on a subject for the past 7 days. */
  async function heavyReviews(v: AnkiVault, cardId: number, minutesPerDay: number): Promise<void> {
    const end = v.clock.now().getTime() - 3_600_000;
    for (let d = 0; d < 7; d++) {
      v.mock.now = end - d * 86_400_000;
      v.mock.answer(cardId, 3, minutesPerDay * 60_000);
    }
    await v.call('anki_sync');
  }

  it('first pauses new cards, then after 14 days proposes dormancy by cost-to-value, mature last; other subjects untouched', async () => {
    v = await ankiVault();
    const anchor = seedCard(v.mock, { kc: 'kc-si-z0', anchor: true, card: { type: 2, queue: 2, ivl: 3 } });
    const fresh = seedCard(v.mock, { kc: 'kc-si-gamma' }); // new, unstudied
    const costly = seedCard(v.mock, {
      kc: 'kc-si-open-short',
      card: { type: 2, queue: 2, ivl: 2, lapses: 4 },
    });
    const cheap = seedCard(v.mock, { kc: 'kc-si-open-short', card: { type: 2, queue: 2, ivl: 40 } });
    const mature = seedCard(v.mock, { kc: 'kc-si-open-short', card: { type: 2, queue: 2, ivl: 120 } });
    const music = seedCard(v.mock, { kc: 'kc-mt-scale', card: { type: 2, queue: 2, ivl: 1 } });
    await heavyReviews(v, anchor.card, 12); // si-pi: 12 min/day against 7.5
    let pending = (await v.call('list_card_actions')).data.actions;
    expect(pending.map((a: { kind: string; subject: string }) => [a.kind, a.subject])).toEqual([
      ['pause_new', 'si-pi'],
    ]);
    expect(pending[0].note_ids).toEqual([fresh.note]);
    const ap = await v.call('apply_card_actions', {
      action_ids: [pending[0].action_id],
      approval: { learner_quote: 'Yes, pause new SI/PI cards.' },
    });
    expect(ap.data.results[0].result).toBe('applied');
    expect(v.mock.cards.get(fresh.card)!.queue).toBe(-1);
    expect(v.mock.notes.get(fresh.note)!.tags).toContain('scaffold::new-paused');

    v.clock.advanceDays(7);
    await heavyReviews(v, anchor.card, 12);
    pending = (await v.call('list_card_actions')).data.actions;
    expect(pending).toEqual([]); // still within 14 days of the pause

    v.clock.advanceDays(8);
    await heavyReviews(v, anchor.card, 12);
    pending = (await v.call('list_card_actions')).data.actions;
    expect(pending).toHaveLength(1);
    const dormant = pending[0];
    expect(dormant).toMatchObject({ kind: 'dormant', subject: 'si-pi' });
    const facts = v.open().facts();
    const ranking = facts.card_actions[dormant.action_id]!.payload.ranking as {
      card_id: number;
      mature: boolean;
    }[];
    expect(ranking[0]!.card_id).toBe(costly.card);
    const order = ranking.map((r) => r.card_id);
    if (order.includes(mature.card)) expect(order.indexOf(mature.card)).toBe(order.length - 1);
    expect(order).not.toContain(anchor.card); // anchors are protected
    expect(order).not.toContain(music.card);
    expect(order.indexOf(costly.card)).toBeLessThan(
      order.includes(cheap.card) ? order.indexOf(cheap.card) : Infinity,
    );
    for (const a of Object.values(facts.card_actions)) expect(a.note_ids).not.toContain(music.note);
  });

  it('ranks unprotected cards by cost-to-value with mature cards last', () => {
    const cfg = defaultConfig();
    const derived = {
      now: '',
      misconceptions: [],
      kcs: {
        'kc-a': { id: 'kc-a', subject: 's', status: 'solid', prerequisites: [] },
        'kc-b': { id: 'kc-b', subject: 's', status: 'solid', prerequisites: ['kc-a'] },
      },
    } as unknown as DerivedState;
    const protect = protectedSet(derived, [subject('s', 'active')]);
    const cards = [
      mcard({ card_id: 1, subject: 's', kc_ids: ['kc-b'], interval: 30 }),
      mcard({ card_id: 2, subject: 's', kc_ids: ['kc-b'], interval: 2 }),
      mcard({ card_id: 3, subject: 's', kc_ids: ['kc-b'], interval: 1, anchor: true }),
      mcard({ card_id: 4, subject: 's', kc_ids: ['kc-b'], interval: 200 }), // mature
      mcard({ card_id: 5, subject: 's', kc_ids: ['kc-a'], interval: 2 }), // same cost as 2, but kc-b depends on kc-a
      mcard({ card_id: 6, subject: 's', kc_ids: ['kc-b'], interval: 0.5, type: 1 }), // learning: costliest
    ];
    const order = rankForDormancy(cards, protect, derived, cfg, 8).map((r) => r.card.card_id);
    expect(order).toEqual([6, 2, 5, 1, 4]);
  });

  it('back under budget while paused: proposes unpausing', async () => {
    v = await ankiVault();
    const anchor = seedCard(v.mock, { kc: 'kc-si-z0', anchor: true, card: { type: 2, queue: 2, ivl: 3 } });
    seedCard(v.mock, { kc: 'kc-si-gamma' });
    await heavyReviews(v, anchor.card, 12);
    const pause = (await v.call('list_card_actions')).data.actions[0];
    await v.call('apply_card_actions', { action_ids: [pause.action_id], approval: { learner_quote: 'ok' } });
    v.clock.advanceDays(9);
    await heavyReviews(v, anchor.card, 1);
    const pending = (await v.call('list_card_actions')).data.actions;
    expect(pending.map((a: { kind: string }) => a.kind)).toEqual(['unpause_new']);
  });
});

describe('goal scope (ANK-07)', () => {
  it('closing a subject proposes dormancy for non-anchor, unprotected cards; reopening proposes unsuspension and needs_check', async () => {
    v = await ankiVault();
    const anchor = seedCard(v.mock, { kc: 'kc-mt-intervals', anchor: true });
    const detail = seedCard(v.mock, { kc: 'kc-mt-scale', card: { type: 2, queue: 2, ivl: 15 } });
    const si = seedCard(v.mock, { kc: 'kc-si-td', card: { type: 2, queue: 2, ivl: 15 } });
    await v.call('anki_sync');
    const r = await v.call('set_subject_scope', { subject: 'music', scope: 'closed' });
    expect(r.data).toMatchObject({ subject: 'music-theory', from: 'active', to: 'closed', changed: true });
    const [p] = (await v.call('list_card_actions')).data.actions;
    expect(p).toMatchObject({ kind: 'dormant', subject: 'music-theory', note_ids: [detail.note] });
    expect(readFileSync(path.join(v.root, 'Scaffold/Subjects/music-theory.md'), 'utf8')).toMatch(
      /^scope: closed$/m,
    );
    await v.call('apply_card_actions', {
      action_ids: [p.action_id],
      approval: { learner_quote: 'yes, park them' },
    });
    await v.call('anki_sync');
    expect(v.mock.cards.get(detail.card)!.queue).toBe(-1);
    expect(v.mock.cards.get(anchor.card)!.queue).not.toBe(-1);
    expect(v.mock.cards.get(si.card)!.queue).not.toBe(-1);
    const back = await v.call('set_subject_scope', { subject: 'music-theory', scope: 'active' });
    expect(back.warnings.join(' ')).toContain('needs_check');
    const [u] = (await v.call('list_card_actions')).data.actions;
    expect(u).toMatchObject({ kind: 'unsuspend', note_ids: [detail.note] });
    const d = v.open().derived();
    expect(d.kcs['kc-mt-intervals']!.needs_check).toBe(true);
    expect(d.kcs['kc-mt-scale']!.needs_check).toBe(true);
  });
});

describe('protected set (ANK-06): 1,000 random graphs and scopes', () => {
  const STATUSES = ['unseen', 'introduced', 'fragile', 'solid', 'forgotten'] as const;
  const world = fc
    .record({
      n: fc.integer({ min: 2, max: 12 }),
      subjects: fc.array(fc.constantFrom('active', 'paused', 'closed'), { minLength: 1, maxLength: 3 }),
      seed: fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 80, maxLength: 80 }),
    })
    .map(({ n, subjects, seed }) => {
      let i = 0;
      const r = (m: number): number => seed[i++ % seed.length]! % m;
      const subs = subjects.map((scope, k) => subject(`s${k}`, scope as 'active'));
      const kcs: Record<string, KcState> = {};
      for (let k = 0; k < n; k++) {
        const prereqs = Array.from({ length: k }, (_, j) => `kc-${j}`).filter(() => r(3) === 0);
        kcs[`kc-${k}`] = {
          id: `kc-${k}`,
          subject: subs[r(subs.length)]!.id,
          status: STATUSES[r(5)]!,
          prerequisites: prereqs,
          tested_transfer: r(2) === 0,
          misconception_active: false,
        } as unknown as KcState;
      }
      const cards: MirrorCard[] = [];
      let id = 1;
      for (const k of Object.values(kcs)) {
        const count = r(4);
        for (let c = 0; c < count; c++)
          cards.push(
            mcard({
              card_id: id++,
              subject: k.subject,
              kc_ids: [k.id],
              anchor: c === 0,
              interval: 1 + r(200),
              type: r(4) === 0 ? 0 : 2,
              lapses: r(5),
            }),
          );
      }
      const derived = { now: '', kcs, misconceptions: [] } as DerivedState;
      return { subs, derived, cards };
    });

  it('no protected card is ever proposed for dormancy or compression', () => {
    const cfg = defaultConfig();
    let judged = 0;
    fc.assert(
      fc.property(world, fc.integer({ min: 0, max: 2 }), ({ subs, derived, cards }, pick) => {
        const mirror: AnkiMirror = {
          synced_at: '',
          api_version: 6,
          avg_seconds_per_review: 8,
          fsrs_enabled: true,
          decks: [],
          cards,
        };
        const facts = emptyFacts();
        const now = new Date('2026-10-09T12:00:00Z');
        // every active subject is over budget and paused 20 days ago, the worst case for dormancy
        for (const s of subs)
          facts.card_actions[`CA-${s.id}`] = {
            action_id: `CA-${s.id}`,
            ts: '2026-09-19T12:00:00Z',
            kind: 'pause_new',
            subject: s.id,
            kc_ids: [],
            note_ids: [],
            card_ids: [],
            reason: 'x',
            payload: {},
            applied_ts: '2026-09-19T12:00:00Z',
            result: 'applied',
            approval_quote: 'ok',
            created_note_ids: [],
          };
        const load = computeLoad(subs, mirror, facts, cfg, now) as LoadReport;
        for (const row of load.subjects)
          if (row.scope === 'active')
            Object.assign(row, {
              over_budget: true,
              measured_min_7d: 99,
              estimated_min: 99,
              budget_min: 0.01,
            });
        const protect = protectedSet(derived, subs);
        const props = budgetProposals({ subjects: subs, load, mirror, protect, derived, facts, cfg, now });
        // a scope change of one subject, judged with the scopes after the change
        const target = subs[pick % subs.length]!;
        const to = target.scope === 'active' ? 'closed' : 'active';
        const after = subs.map((s) => (s.id === target.id ? { ...s, scope: to } : s)) as SubjectFields[];
        props.push(
          ...scopeProposals(target.id, target.scope, to, { mirror, protect: protectedSet(derived, after) }),
        );
        const protAfter = protectedSet(derived, after);
        for (const p of props) {
          if (p.kind !== 'dormant' && p.kind !== 'compress') continue;
          const prot = p.reason.includes('is now') ? protAfter : protect;
          for (const id of p.card_ids) {
            const c = cards.find((x) => x.card_id === id)!;
            judged++;
            if (prot.isProtected(c)) return false;
            if (c.subject !== p.subject) return false;
          }
        }
        return true;
      }),
      { numRuns: 1000 },
    );
    expect(judged).toBeGreaterThan(500); // the property is not vacuous: many cards were proposed
  });
});
