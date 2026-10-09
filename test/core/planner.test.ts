import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/core/config.js';
import { ScaffoldError } from '../../src/core/envelope.js';
import { deriveState } from '../../src/core/model/derive.js';
import { estimateTokens } from '../../src/core/planner/briefing.js';
import { rankedNeeds } from '../../src/core/planner/plan.js';
import type { Plan } from '../../src/core/schemas/plan.js';
import { LogBuilder, TZ } from '../helpers/builder.js';
import { briefingFor, planFor } from '../helpers/plan-helpers.js';
import { questionEvent, standardFixture } from '../fixtures/standard.js';

// V-CORE: planner (LM-10), focus (LM-15), subjects (LM-14), briefing (LM-11).

const kcsIn = (plan: Plan, step?: string): string[] =>
  plan.steps.filter((s) => !step || s.step === step).flatMap((s) => s.items.map((i) => i.kc));
const stepNames = (plan: Plan): string[] => plan.steps.map((s) => s.step);

describe('LM-10 planner golden plans', () => {
  it('si-pi focus, 30 minutes, carry-over 2', async () => {
    const plan = planFor(standardFixture(), { focus: 'SI/PI' });
    await expect(JSON.stringify(plan, null, 2)).toMatchFileSnapshot('../golden/plan-si-pi-30.json');
    expect(stepNames(plan)).toEqual(['warmup', 'carryover', 'repair', 'new', 'exit']);
    expect(plan.minutes_planned).toBeLessThanOrEqual(30);
  });

  it('mixed review day (focus: all) matches the golden mixed plan', async () => {
    const plan = planFor(standardFixture(), { focus: 'all' });
    await expect(JSON.stringify(plan, null, 2)).toMatchFileSnapshot('../golden/plan-all-30.json');
    expect(stepNames(plan)).not.toContain('pretest');
    expect(stepNames(plan)).not.toContain('carryover');
    expect(kcsIn(plan).some((k) => k.startsWith('kc-mt-'))).toBe(true);
    expect(kcsIn(plan).some((k) => k.startsWith('kc-es-'))).toBe(false);
  });

  it('short 12-minute session trims carry-over first, then new KCs, then warm-up; never repair or exit', async () => {
    const plan = planFor(standardFixture(), { focus: 'si-pi', minutes: 12 });
    await expect(JSON.stringify(plan, null, 2)).toMatchFileSnapshot('../golden/plan-si-pi-12.json');
    expect(stepNames(plan)).toContain('repair');
    expect(stepNames(plan)).toContain('exit');
    expect(stepNames(plan)).not.toContain('carryover');
    expect(stepNames(plan)).not.toContain('new');
    expect(kcsIn(plan, 'warmup')).toHaveLength(2);
    const order = plan.trimmed.map((t) => t.split(' ')[0]);
    const firstNew = order.indexOf('new');
    const lastCarry = order.lastIndexOf('carry-over');
    const firstWarm = order.indexOf('warm-up');
    expect(lastCarry).toBeLessThan(firstNew);
    expect(firstNew).toBeLessThan(firstWarm);
  });
});

describe('LM-10 planner rules', () => {
  it('warm-up ranks forgotten > misconception > needs_check > R below target > solid without transfer', () => {
    const b = standardFixture();
    const d = deriveState(b.facts(), defaultConfig(), new Date(b.t), { timezone: TZ });
    const needs = rankedNeeds(
      Object.values(d.kcs).filter((k) => k.subject === 'si-pi'),
      defaultConfig(),
    );
    expect(needs.map((n) => n.category)).toEqual([...needs.map((n) => n.category)].sort());
    const cat = Object.fromEntries(needs.map((n) => [n.kc.id, n.category]));
    expect(cat['kc-si-transmission-coefficient']).toBe(1);
    expect(cat['kc-si-instantaneous-impedance']).toBe(3);
    expect(cat['kc-si-characteristic-impedance']).toBe(4);
    expect(cat['kc-si-propagation-delay']).toBe(5);
  });

  it('needs_check KCs rank right after active misconceptions', () => {
    const b = new LogBuilder().subject('s1');
    for (const k of ['kc-a', 'kc-b', 'kc-c']) b.kc(k, 's1');
    b.attempt('kc-a', 'correct', { conf: 3 });
    b.attempt('kc-b', 'correct', { conf: 3 });
    b.attempt('kc-c', 'correct', { conf: 3 });
    b.hours(1).attempt('kc-a', 'incorrect', { conf: 4, mid: 'M-0001', belief: 'wrong belief' });
    b.push({
      type: 'card_flagged',
      note_id: 9,
      kc_ids: ['kc-c'],
      reason: 'tutor_check',
      detail: '',
      proposed: 'check',
      by: 'tutor',
    });
    b.hours(2);
    const plan = planFor(b, { focus: 's1' });
    expect(plan.steps.find((s) => s.step === 'repair')?.items[0]?.kc).toBe('kc-a');
    expect(kcsIn(plan, 'warmup')[0]).toBe('kc-c');
  });

  it('interleaves confusable pairs next to each other', () => {
    const b = new LogBuilder().subject('s1');
    b.kc('kc-a', 's1')
      .kc('kc-b', 's1')
      .kc('kc-c', 's1', { confusable_with: ['kc-a'] });
    for (const k of ['kc-a', 'kc-b', 'kc-c']) b.attempt(k, 'correct', { conf: 3 });
    b.hours(1);
    b.attempt('kc-a', 'incorrect', { conf: 2 });
    b.days(4);
    b.attempt('kc-a', 'incorrect', { conf: 2 }); // kc-a forgotten (category 1)
    b.push({
      type: 'card_flagged',
      note_id: 1,
      kc_ids: ['kc-b'],
      reason: 'tutor_check',
      detail: '',
      proposed: 'check',
      by: 'tutor',
    });
    // kc-c ranks last (R below target), kc-b second (needs_check)
    b.days(3);
    const plan = planFor(b, { focus: 's1' });
    const w = kcsIn(plan, 'warmup');
    expect(w.indexOf('kc-c')).toBe(w.indexOf('kc-a') + 1);
  });

  it('a backlog over 8 means no new KCs', () => {
    const b = new LogBuilder().subject('s1');
    for (let i = 0; i < 10; i++) b.kc(`kc-r${i}`, 's1');
    b.kc('kc-new', 's1');
    for (let i = 0; i < 10; i++) b.attempt(`kc-r${i}`, 'correct', { conf: 3 });
    b.days(4);
    for (let i = 0; i < 9; i++) b.attempt(`kc-r${i}`, 'incorrect', { conf: 3 });
    const plan = planFor(b, { focus: 's1', minutes: 60 });
    expect(stepNames(plan)).not.toContain('new');
    expect(plan.notes.join(' ')).toMatch(/backlog in s1 is \d+ \(> 8\)/);
  });

  it('a forgotten prerequisite comes before its dependent, whatever subject it belongs to', () => {
    const b = new LogBuilder().subject('math').subject('si-pi');
    b.kc('kc-math-complex', 'math');
    b.kc('kc-si-impedance', 'si-pi', { prerequisites: ['kc-math-complex'] });
    b.kc('kc-si-warm', 'si-pi');
    b.attempt('kc-math-complex', 'correct', { conf: 3 });
    b.attempt('kc-si-warm', 'correct', { conf: 3 });
    b.days(4).attempt('kc-math-complex', 'incorrect', { conf: 3 }); // forgotten
    b.hours(1);
    const plan = planFor(b, { focus: 'si-pi', carryover: 0 });
    const items = plan.steps.find((s) => s.step === 'new')!.items;
    expect(items.map((i) => i.kc)).toEqual(['kc-math-complex', 'kc-si-impedance']);
    expect(items[0]!.prerequisite_for).toBe('kc-si-impedance');
  });

  it('chooses question variants not used in the KC’s last 2 attempts and not worded like its Anki cards', () => {
    const b = new LogBuilder().subject('s1').kc('kc-a', 's1');
    questionEvent(b, 'Q-0001', ['kc-a'], 'recall', 'What is the first stem about alpha?');
    questionEvent(b, 'Q-0002', ['kc-a'], 'recall', 'Second distinct stem regarding beta.');
    questionEvent(b, 'Q-0003', ['kc-a'], 'explain', 'Explain gamma delta epsilon relation.');
    b.attempt('kc-a', 'correct', { conf: 3, q: 'Q-0001' });
    b.hours(1).attempt('kc-a', 'correct', { conf: 3, q: 'Q-0002' });
    b.days(1).attempt('kc-a', 'incorrect', { conf: 2 });
    b.days(3).attempt('kc-a', 'incorrect', { conf: 2 }); // forgotten → in warm-up
    const pick = (ankiText?: Record<string, string[]>) =>
      planFor(b, { focus: 's1', ...(ankiText ? { ankiText } : {}) }).steps.find((s) => s.step === 'warmup')!
        .items[0]!;
    // the last 2 attempts were improvised, so Q-0001 (recall, preferred) is allowed again
    expect(pick().question_id).toBe('Q-0001');
    const b2 = new LogBuilder().subject('s1').kc('kc-a', 's1');
    questionEvent(b2, 'Q-0001', ['kc-a'], 'recall', 'What is the first stem about alpha?');
    questionEvent(b2, 'Q-0002', ['kc-a'], 'recall', 'Second distinct stem regarding beta.');
    questionEvent(b2, 'Q-0003', ['kc-a'], 'explain', 'Explain gamma delta epsilon relation.');
    b2.attempt('kc-a', 'correct', { conf: 3, q: 'Q-0001' });
    b2.days(4).attempt('kc-a', 'incorrect', { conf: 3, q: 'Q-0002' }); // forgotten; last 2 = Q-0001, Q-0002
    const pick2 = (ankiText?: Record<string, string[]>) =>
      planFor(b2, { focus: 's1', ...(ankiText ? { ankiText } : {}) }).steps.find((s) => s.step === 'warmup')!
        .items[0]!;
    expect(pick2().question_id).toBe('Q-0003');
    // an Anki card worded like Q-0003 rules it out: the tutor improvises instead
    expect(pick2({ 'kc-a': ['Explain the gamma delta epsilon relation'] }).question_id).toBeNull();
  });

  it('serves only questions with an `ok` cross-model verdict (QB-04)', () => {
    const plan = planFor(standardFixture(), { focus: 'si-pi' });
    const all = plan.steps.flatMap((s) => s.items);
    expect(all.some((i) => i.question_id === 'Q-0005')).toBe(false);
    expect(all.find((i) => i.kc === 'kc-si-characteristic-impedance')?.question_id).toBeNull();
  });

  it('repair uses a question that targets the misconception', () => {
    const plan = planFor(standardFixture(), { focus: 'si-pi' });
    const r = plan.steps.find((s) => s.step === 'repair')!.items[0]!;
    expect(r.misconception).toBe('M-0001');
    expect(r.question_id).toBe('Q-0002');
  });
});

describe('LM-10 / LM-14 subject focus', () => {
  it('with music theory in focus, other-subject KCs appear only in carry-over (urgent, ≤ carryover)', () => {
    const plan = planFor(standardFixture(), { focus: 'music' });
    for (const s of plan.steps) {
      for (const i of s.items) {
        if (i.subject !== 'music-theory') {
          expect(s.step === 'carryover' || !!i.prerequisite_for).toBe(true);
        }
      }
    }
    const carry = plan.steps.find((s) => s.step === 'carryover')?.items ?? [];
    expect(carry.length).toBeLessThanOrEqual(2);
    expect(carry.every((i) => /forgotten|misconception|needs check/.test(i.why))).toBe(true);
  });

  it('carryover 0 plans nothing from other subjects, and paused subjects never appear', () => {
    const plan = planFor(standardFixture(), { focus: 'si-pi', carryover: 0 });
    expect(kcsIn(plan).every((k) => k.startsWith('kc-si-'))).toBe(true);
    const plan2 = planFor(standardFixture(), { focus: 'music-theory', carryover: 2 });
    expect(kcsIn(plan2).some((k) => k.startsWith('kc-es-'))).toBe(false);
  });

  it('a backlog over 8 in subject A does not block new KCs in B; it produces a briefing warning', () => {
    const b = new LogBuilder().subject('aaa').subject('bbb');
    for (let i = 0; i < 10; i++) b.kc(`kc-a${i}`, 'aaa');
    b.kc('kc-b-old', 'bbb').kc('kc-b-new', 'bbb');
    for (let i = 0; i < 10; i++) b.attempt(`kc-a${i}`, 'correct', { conf: 3 });
    b.attempt('kc-b-old', 'correct', { conf: 3 });
    b.days(4);
    for (let i = 0; i < 9; i++) b.attempt(`kc-a${i}`, 'incorrect', { conf: 3 });
    b.attempt('kc-b-old', 'correct', { conf: 3 });
    const plan = planFor(b, { focus: 'bbb' });
    expect(kcsIn(plan, 'new')).toContain('kc-b-new');
    const brief = briefingFor(b, { focus: 'bbb' });
    expect(brief.warnings.join(' ')).toMatch(/aaa: review backlog \d+ KCs/);
  });

  it('a subject with no KCs returns intake_required', () => {
    const b = standardFixture().subject('chess', { title: 'Chess' });
    const plan = planFor(b, { focus: 'chess' });
    expect(plan.status).toBe('intake_required');
    expect(plan.steps).toEqual([]);
  });

  it('a subject whose KCs have no attempts starts with a pretest in prerequisite order (at most 8)', () => {
    const b = standardFixture().subject('chess', { title: 'Chess' });
    b.kc('kc-ch-c', 'chess', { prerequisites: ['kc-ch-b'] });
    b.kc('kc-ch-b', 'chess', { prerequisites: ['kc-ch-a'] });
    b.kc('kc-ch-a', 'chess');
    for (let i = 0; i < 5; i++) b.kc(`kc-ch-x${i}`, 'chess');
    const plan = planFor(b, { focus: 'chess', minutes: 45 });
    const pre = kcsIn(plan, 'pretest');
    expect(plan.steps[0]!.step).toBe('pretest');
    expect(pre.length).toBe(8);
    expect(pre.indexOf('kc-ch-a')).toBeLessThan(pre.indexOf('kc-ch-b'));
    expect(pre.indexOf('kc-ch-b')).toBeLessThan(pre.indexOf('kc-ch-c'));
    // With 10 KCs, the 8-item cap keeps the first 8 in prerequisite order.
    b.kc('kc-ch-d', 'chess', { prerequisites: ['kc-ch-c'] }).kc('kc-ch-x9', 'chess');
    const pre2 = kcsIn(planFor(b, { focus: 'chess', minutes: 45 }), 'pretest');
    expect(pre2).toHaveLength(8);
    expect(pre2).not.toContain('kc-ch-d');
  });

  it('short pretest sessions trim pretest items down to 3 at most', () => {
    const b = standardFixture().subject('chess', { title: 'Chess' });
    for (let i = 0; i < 8; i++) b.kc(`kc-ch-x${i}`, 'chess');
    const plan = planFor(b, { focus: 'chess', minutes: 8, carryover: 0 });
    expect(kcsIn(plan, 'pretest')).toHaveLength(3);
    expect(plan.trimmed.some((t) => t.startsWith('pretest'))).toBe(true);
  });
});

describe('LM-15 focus resolution', () => {
  it('1. a named subject, matched case-insensitively on id, title or alias', () => {
    for (const name of ['si-pi', 'SI/PI', 'Signal Integrity', 'SIPI']) {
      expect(planFor(standardFixture(), { focus: name }).focus).toEqual({
        subject: 'si-pi',
        why: 'named by learner',
      });
    }
  });
  it('unknown name → unknown_subject; paused subject → subject_not_active', () => {
    expect(() => planFor(standardFixture(), { focus: 'chess' })).toThrow(ScaffoldError);
    try {
      planFor(standardFixture(), { focus: 'chess' });
    } catch (e) {
      expect((e as ScaffoldError).code).toBe('unknown_subject');
      expect((e as ScaffoldError).next_step).toMatch(/D3\.10/);
    }
    try {
      planFor(standardFixture(), { focus: 'Spanish' });
      expect.unreachable();
    } catch (e) {
      expect((e as ScaffoldError).code).toBe('subject_not_active');
      expect((e as ScaffoldError).next_step).toMatch(/ANK-07/);
    }
  });
  it('2. the only active subject', () => {
    const b = new LogBuilder().subject('solo').subject('old', { scope: 'paused' }).kc('kc-x', 'solo');
    expect(planFor(b).focus).toEqual({ subject: 'solo', why: 'only active subject' });
  });
  it('3. the focus of the most recent session (mixed days do not count), if still active', () => {
    const b = standardFixture();
    expect(planFor(b).focus.subject).toBe('music-theory');
    b.session('S-2026-10-09-1', 'all');
    expect(planFor(b).focus.subject).toBe('music-theory');
  });
  it('4. otherwise the active subject with the most due KCs (ties by id)', () => {
    const b = standardFixture();
    b.scope('music-theory', 'active', 'paused');
    b.subject('zeta').kc('kc-z1', 'zeta');
    b.session('S-2026-10-09-1', 'music-theory');
    b.scope('music-theory', 'paused', 'active');
    b.scope('music-theory', 'active', 'closed');
    const p = planFor(b);
    expect(p.focus.subject).toBe('si-pi');
    expect(p.focus.why).toMatch(/most due KCs/);
  });
});

describe('LM-11 briefing', () => {
  it('stays within 600 tokens and recaps the last session on the focus subject', () => {
    const brief = briefingFor(standardFixture(), { focus: 'si-pi' });
    expect(estimateTokens(brief)).toBeLessThanOrEqual(600);
    expect(brief.last_session?.date).toBe('2026-09-20');
    expect(brief.last_session?.summary).toMatch(/Γ predicted wrong/);
    expect(brief.misconceptions[0]?.id).toBe('M-0001');
    expect(brief.other_subjects.map((o) => o.subject)).toEqual(['music-theory']);
  });

  it('recap comes from the last session on that subject, not the most recent session overall', () => {
    const brief = briefingFor(standardFixture(), { focus: 'si-pi' });
    expect(brief.last_session?.summary).not.toMatch(/Intervals/);
    const brief2 = briefingFor(standardFixture(), { focus: 'music' });
    expect(brief2.last_session?.date).toBe('2026-09-25');
  });

  it('warns about a stale subject with no session in 14 days', () => {
    const b = standardFixture();
    b.days(10);
    const brief = briefingFor(b, { focus: 'si-pi' });
    expect(brief.warnings.join(' ')).toMatch(/music-theory: no session in 14\+ days/);
  });

  it('compacts large briefings below the budget', () => {
    const b = standardFixture();
    const huge = Array.from(
      { length: 30 },
      (_, i) => `warning number ${i} with a fairly long explanation attached to it`,
    );
    const brief = briefingFor(b, { focus: 'si-pi', warnings: huge });
    expect(estimateTokens(brief)).toBeLessThanOrEqual(600);
  });
});
