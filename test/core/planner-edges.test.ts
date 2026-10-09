import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { ScaffoldError } from '../../src/core/envelope.js';
import { deriveState } from '../../src/core/model/derive.js';
import { compactPlan, estimateTokens, fitBriefing, type Briefing } from '../../src/core/planner/briefing.js';
import { lastFocusedSubject, lastSessionOn, resolveFocus } from '../../src/core/planner/focus.js';
import { interleaveConfusables, rankedNeeds } from '../../src/core/planner/plan.js';
import { cmp, compareKeys, truncate } from '../../src/core/util.js';
import { LogBuilder, TZ } from '../helpers/builder.js';
import { briefingFor, planFor } from '../helpers/plan-helpers.js';
import { questionEvent, standardFixture } from '../fixtures/standard.js';

// V-CORE: planner edge cases (LM-10, LM-11, LM-15).

describe('deterministic ordering helpers', () => {
  it('cmp and compareKeys give a total order', () => {
    expect([cmp('a', 'b'), cmp('b', 'a'), cmp('a', 'a')]).toEqual([-1, 1, 0]);
    expect(compareKeys([1, 'b'], [1, 'a'])).toBeGreaterThan(0);
    expect(compareKeys([1], [1, 'a'])).toBeLessThan(0);
    expect(compareKeys([2], [10])).toBeLessThan(0);
    expect(compareKeys(['x', 1], ['x', 1])).toBe(0);
  });
  it('truncate keeps short strings and marks cuts', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('planner edges', () => {
  it('a forgotten prerequisite in a paused subject is never planned; its dependent waits', () => {
    const b = new LogBuilder().subject('math').subject('si-pi');
    b.kc('kc-math-complex', 'math');
    b.kc('kc-si-impedance', 'si-pi', { prerequisites: ['kc-math-complex'] });
    b.kc('kc-si-other', 'si-pi').kc('kc-si-seen', 'si-pi');
    b.attempt('kc-si-seen', 'correct', { conf: 3 }); // no pretest: si-pi already has attempts
    b.attempt('kc-math-complex', 'correct', { conf: 3 });
    b.days(4).attempt('kc-math-complex', 'incorrect', { conf: 3 });
    b.scope('math', 'active', 'paused');
    const plan = planFor(b, { focus: 'si-pi' });
    const kcs = plan.steps.flatMap((s) => s.items.map((i) => i.kc));
    expect(kcs).not.toContain('kc-math-complex');
    expect(kcs).not.toContain('kc-si-impedance');
    expect(kcs).toContain('kc-si-other');
    expect(plan.notes.join(' ')).toMatch(/kc-si-impedance waits/);
  });

  it('a forgotten prerequisite shared by two new KCs is listed once', () => {
    const b = new LogBuilder().subject('s1');
    b.kc('kc-base', 's1')
      .kc('kc-x', 's1', { prerequisites: ['kc-base'] })
      .kc('kc-y', 's1', { prerequisites: ['kc-base'] });
    b.attempt('kc-base', 'correct', { conf: 3 });
    b.days(4).attempt('kc-base', 'incorrect', { conf: 3 });
    const plan = planFor(b, { focus: 's1', minutes: 60 });
    const newStep = plan.steps.find((s) => s.step === 'new')!;
    // kc-base is already in the warm-up (forgotten), so it is not repeated as a prerequisite item
    expect(newStep.items.filter((i) => i.kc === 'kc-base')).toHaveLength(0);
    const b2 = new LogBuilder().subject('s1').subject('s2');
    b2.kc('kc-base', 's2')
      .kc('kc-x', 's1', { prerequisites: ['kc-base'] })
      .kc('kc-y', 's1', { prerequisites: ['kc-base'] });
    b2.attempt('kc-base', 'correct', { conf: 3 });
    b2.days(4).attempt('kc-base', 'incorrect', { conf: 3 });
    const plan2 = planFor(b2, { focus: 's1', minutes: 60, carryover: 0 });
    const items = plan2.steps.find((s) => s.step === 'new')!.items;
    expect(items.filter((i) => i.kc === 'kc-base')).toHaveLength(1);
    expect(items.map((i) => i.kc)).toEqual(['kc-base', 'kc-x', 'kc-y']);
  });

  it('KCs with no concept memory rank after those with one in the same category', () => {
    const b = new LogBuilder().subject('s1');
    b.kc('kc-a', 's1').kc('kc-b', 's1');
    b.taught('kc-a');
    b.attempt('kc-a', 'incorrect', { conf: 4, mid: 'M-0001', belief: 'belief one' }); // introduced, misconception, has memory
    b.attempt('kc-b', 'incorrect', { conf: 4, mid: 'M-0002', belief: 'belief two' }); // unseen, misconception, no memory
    const d = deriveState(b.facts(), defaultConfig(), new Date(b.t), { timezone: TZ });
    const needs = rankedNeeds(Object.values(d.kcs), defaultConfig());
    expect(needs.map((n) => n.kc.id)).toEqual(['kc-a', 'kc-b']);
  });

  it('repairs the oldest active misconception first; others wait in the warm-up', () => {
    const b = new LogBuilder().subject('s1');
    b.kc('kc-a', 's1').kc('kc-b', 's1');
    b.attempt('kc-b', 'incorrect', { conf: 4, mid: 'M-0002', belief: 'older belief' });
    b.hours(2).attempt('kc-a', 'incorrect', { conf: 4, mid: 'M-0001', belief: 'newer belief' });
    const plan = planFor(b, { focus: 's1' });
    expect(plan.steps.find((s) => s.step === 'repair')!.items[0]!.misconception).toBe('M-0002');
    expect(plan.steps.find((s) => s.step === 'warmup')!.items.map((i) => i.kc)).toEqual(['kc-a']);
  });

  it('frontier lists introduced KCs before unseen ones', () => {
    const b = new LogBuilder().subject('s1');
    b.kc('kc-a', 's1').kc('kc-b', 's1').kc('kc-c', 's1');
    b.attempt('kc-c', 'correct', { conf: 3 });
    b.taught('kc-b');
    const plan = planFor(b, { focus: 's1' });
    expect(plan.steps.find((s) => s.step === 'new')!.items.map((i) => i.kc)).toEqual(['kc-b', 'kc-a']);
  });

  it('pretest picks the easiest suitable bank question', () => {
    const b = new LogBuilder().subject('s1').kc('kc-a', 's1');
    questionEvent(b, 'Q-0001', ['kc-a'], 'predict', 'Hard predict stem number one');
    questionEvent(b, 'Q-0002', ['kc-a'], 'predict', 'Easy predict stem number two');
    questionEvent(b, 'Q-0003', ['kc-a'], 'teach-back', 'Explain to a peer');
    // make Q-0002 easier
    const added = b.events.find((e) => e.type === 'question_added' && e.question_id === 'Q-0001');
    if (added?.type === 'question_added') added.question.difficulty = 4;
    const plan = planFor(b, { focus: 's1' });
    expect(plan.steps[0]!.items[0]!.question_id).toBe('Q-0002');
  });

  it('interleaving works whichever KC lists the confusable', () => {
    const b = new LogBuilder().subject('s1');
    b.kc('kc-a', 's1', { confusable_with: ['kc-c'] })
      .kc('kc-b', 's1')
      .kc('kc-c', 's1');
    const d = deriveState(b.facts(), defaultConfig(), new Date(b.t), { timezone: TZ });
    const out = interleaveConfusables([{ kc: 'kc-c' }, { kc: 'kc-b' }, { kc: 'kc-a' }], d);
    expect(out.map((x) => x.kc)).toEqual(['kc-c', 'kc-a', 'kc-b']);
  });
});

describe('focus edges', () => {
  it('"all" with no active subjects fails loudly; no subjects at all → no_subjects', () => {
    const b = new LogBuilder().subject('xx', { scope: 'paused' });
    expect(() => planFor(b, { focus: 'all' })).toThrow(/paused or closed/);
    expect(() => planFor(b)).toThrow(ScaffoldError);
    const empty = new LogBuilder();
    try {
      planFor(empty);
      expect.unreachable();
    } catch (e) {
      expect((e as ScaffoldError).code).toBe('no_subjects');
    }
  });

  it('a blank focus means "not named"', () => {
    const b = new LogBuilder().subject('solo').kc('kc-x', 'solo');
    expect(planFor(b, { focus: '   ' }).focus.why).toBe('only active subject');
  });

  it('last focused subject ignores mixed days and is null without sessions', () => {
    const b = new LogBuilder().subject('aa').subject('bb');
    expect(lastFocusedSubject(b.facts())).toBeNull();
    b.session('S-2026-09-01-1', 'all');
    expect(lastFocusedSubject(b.facts())).toBeNull();
    b.hours(1).session('S-2026-09-01-2', 'aa');
    b.hours(1).session('S-2026-09-01-3', 'bb');
    expect(lastFocusedSubject(b.facts())?.subject).toBe('bb');
    expect(lastSessionOn(b.facts(), 'aa')?.id).toBe('S-2026-09-01-2');
    expect(lastSessionOn(b.facts(), 'aa', { endedOnly: true })).toBeNull();
  });

  it('the last-session subject is skipped when no longer active (rule 4 applies)', () => {
    const b = new LogBuilder().subject('aa').subject('bb').subject('cc');
    b.kc('kc-b1', 'bb').kc('kc-b2', 'bb').kc('kc-c1', 'cc');
    for (const k of ['kc-b1', 'kc-b2', 'kc-c1']) b.attempt(k, 'correct', { conf: 3 });
    b.days(4);
    for (const k of ['kc-b1', 'kc-b2', 'kc-c1']) b.attempt(k, 'incorrect', { conf: 3 });
    b.session('S-2026-09-05-1', 'aa');
    b.scope('aa', 'active', 'closed');
    const facts = b.facts();
    const r = resolveFocus(
      Object.values(facts.subjects).map((s) => s.fields),
      facts,
      { bb: 2, cc: 1 },
      null,
    );
    expect(r).toEqual({ subject: 'bb', why: 'most due KCs (2)' });
  });
});

describe('briefing edges', () => {
  it('carries the session id and intake status', () => {
    const b = standardFixture().subject('chess', { title: 'Chess' });
    const brief = briefingFor(b, { focus: 'chess' });
    expect(brief.status).toBe('intake_required');
    expect(brief.last_session).toBeNull();
  });

  it('mixed review day briefing covers every active subject and has no recap', () => {
    const brief = briefingFor(standardFixture(), { focus: 'all' });
    expect(brief.focus.subject).toBe('all');
    expect(brief.last_session).toBeNull();
    expect(brief.due.some((d) => d.kc.startsWith('kc-mt-'))).toBe(true);
    expect(brief.other_subjects.map((o) => o.subject).sort()).toEqual(['music-theory', 'si-pi']);
  });

  it('compaction trims long question lists and long texts in a fixed order', () => {
    const base = briefingFor(standardFixture(), { focus: 'si-pi' });
    const big: Briefing = {
      ...structuredClone(base),
      session_id: 'S-2026-10-09-1',
      plan: [
        {
          step: 'warmup',
          minutes: 5,
          kcs: Array(12).fill('kc-si-voltage-current'),
          questions: Array(12).fill('Q-0001'),
        },
      ],
      last_session: {
        date: '2026-10-01',
        summary: 'x'.repeat(900),
        open_threads: Array(8).fill('y'.repeat(200)),
      },
      misconceptions: Array(8).fill({ id: 'M-0001', belief: 'z'.repeat(300), since: '2026-10-01' }),
      warnings: Array(12).fill('w'.repeat(200)),
      due: Array(12).fill({ kc: 'kc-si-voltage-current', why: 'v'.repeat(100), R: 0.5 }),
    };
    const fitted = fitBriefing(big, 600);
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(600);
    expect(fitted.session_id).toBe('S-2026-10-09-1');
    expect(fitted.plan[0]!.kcs.length).toBeLessThanOrEqual(5);
  });

  it('compact plans name the misconception for the repair step', () => {
    const plan = planFor(standardFixture(), { focus: 'si-pi' });
    const c = compactPlan(plan).find((s) => s.step === 'repair')!;
    expect(c.misconception).toBe('M-0001');
    expect(c.questions).toEqual(['Q-0002']);
    const exit = compactPlan(plan).find((s) => s.step === 'exit')!;
    expect(exit.questions).toBeUndefined();
  });
});

describe('model edges', () => {
  it('deriving at an earlier instant ignores later events (time travel)', () => {
    const b = new LogBuilder().subject('s1').kc('kc-a', 's1');
    const before = new Date(b.t);
    b.hours(1).attempt('kc-a', 'incorrect', { conf: 4, mid: 'M-0001', belief: 'later belief' });
    b.push({
      type: 'misconception_opened',
      misconception_id: 'M-0002',
      kc_ids: ['kc-a'],
      belief: 'explicit later',
      session_id: null,
      attempt_id: null,
      by: 'tutor',
    });
    const d = deriveState(b.facts(), defaultConfig(), before, { timezone: TZ });
    expect(d.misconceptions.every((m) => m.state === 'candidate')).toBe(true);
    expect(d.kcs['kc-a']!.attempts).toBe(0);
  });

  it('attempts on questions missing from the bank are handled', () => {
    const b = new LogBuilder().subject('s1').kc('kc-a', 's1');
    b.attempt('kc-a', 'incorrect', { conf: 4, mid: 'M-0001', belief: 'belief', q: 'Q-0099' });
    b.hours(1).attempt('kc-a', 'correct', { conf: 3, q: 'Q-0098' });
    expect(b.derive().misconceptions[0]!.state).toBe('open');
  });

  it('derived frontmatter carries memory when present and null otherwise', async () => {
    const { derivedFrontmatter } = await import('../../src/core/model/derive.js');
    const b = new LogBuilder().subject('s1').kc('kc-a', 's1').kc('kc-b', 's1');
    b.attempt('kc-a', 'correct', { conf: 3 });
    const d = b.derive();
    const fa = derivedFrontmatter(d.kcs['kc-a']!, TZ);
    expect(fa.status).toBe('fragile');
    expect(fa.memory?.next_check).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(derivedFrontmatter(d.kcs['kc-b']!, TZ).memory).toBeNull();
  });

  it('briefing keeps the session id and compacts a briefing without a recap', async () => {
    const { buildBriefing } = await import('../../src/core/planner/briefing.js');
    const b = standardFixture();
    const cfg = defaultConfig();
    const facts = b.facts();
    const derived = deriveState(facts, cfg, new Date(b.t), { timezone: TZ });
    const plan = planFor(b, { focus: 'all' });
    const brief = buildBriefing({
      facts,
      derived,
      subjects: Object.values(facts.subjects).map((s) => s.fields),
      cfg,
      plan,
      now: new Date(b.t),
      timezone: TZ,
      anki: null,
      extraWarnings: Array(40).fill('a long warning that repeats to force the compaction path to run'),
      sessionId: 'S-2026-10-09-1',
    });
    expect(brief.session_id).toBe('S-2026-10-09-1');
    expect(brief.last_session).toBeNull();
    expect(estimateTokens(brief)).toBeLessThanOrEqual(600);
  });

  it('an empty focus string counts as not named', () => {
    const b = new LogBuilder().subject('solo').kc('kc-x', 'solo');
    expect(planFor(b, { focus: '' }).focus.why).toBe('only active subject');
  });
});
