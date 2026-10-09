import { describe, expect, it } from 'vitest';
import { applyEvent, emptyFacts } from '../../src/core/model/reducer.js';
import { EVENT_TYPES, parseEvent } from '../../src/core/schemas/events.js';
import { validateGraph, topoOrder, ancestors } from '../../src/core/model/graph.js';
import { LogBuilder } from '../helpers/builder.js';

// V-CORE: LM-03 event validation, LM-04 idempotency, LM-12 DAG validation.

const specAttempt = {
  type: 'attempt',
  id: '01J9ZK3Q8M2V7W5X',
  ts: '2026-10-05T19:42:10-04:00',
  session_id: 'S-2026-10-05-1',
  question_id: 'Q-0041',
  question_text: null,
  kc_ids: ['kc-si-reflection-coefficient'],
  qtype: 'predict',
  format: 'free',
  answer_verbatim: 'It reflects nothing because the line is 50 ohm',
  grade: 'incorrect',
  rubric_hits: [],
  evidence_quotes: ['reflects nothing because the line is 50 ohm'],
  confidence: 3,
  hints_used: 0,
  assisted: false,
  grader: 'claude-desktop',
  grader_uncertain: false,
  misconception_id: 'M-0003',
  misconception_belief: 'A 50 Ω line never reflects, whatever terminates it',
};

describe('LM-03 event log schema', () => {
  it('accepts the example attempt from the spec', () => {
    expect(parseEvent(specAttempt).type).toBe('attempt');
  });

  it('covers every event type named in D2 (plus the escrow and question_updated additions)', () => {
    for (const t of [
      'session_started',
      'session_ended',
      'taught',
      'attempt',
      'misconception_opened',
      'anki_reviews_imported',
      'grade_overridden',
      'kc_created',
      'kc_updated',
      'question_added',
      'question_reviewed',
      'visual_registered',
      'card_proposed',
      'card_flagged',
      'card_action_proposed',
      'card_action_applied',
      'subject_created',
      'subject_updated',
      'subject_scope_changed',
      'session_replanned',
    ]) {
      expect(EVENT_TYPES).toContain(t);
    }
  });

  const malformed: [string, Record<string, unknown>][] = [
    ['unknown type', { ...specAttempt, type: 'attemptt' }],
    ['missing grade', { ...specAttempt, grade: undefined }],
    ['bad grade', { ...specAttempt, grade: 'wrong' }],
    ['confidence 5', { ...specAttempt, confidence: 5 }],
    ['bad timestamp', { ...specAttempt, ts: 'yesterday' }],
    ['improvised without question_text', { ...specAttempt, question_id: null, question_text: null }],
    ['missing confidence on a graded answer', { ...specAttempt, confidence: null }],
    ['bad kc id', { ...specAttempt, kc_ids: ['Reflection'] }],
    ['bad qtype', { ...specAttempt, qtype: 'quiz' }],
  ];
  for (const [name, obj] of malformed) {
    it(`rejects a malformed event: ${name}`, () => {
      expect(() => parseEvent(obj)).toThrow();
    });
  }

  it('allows null confidence for "I don\'t know" (LM-07)', () => {
    expect(() =>
      parseEvent({
        ...specAttempt,
        grade: 'unanswered',
        confidence: null,
        misconception_id: null,
        misconception_belief: null,
      }),
    ).not.toThrow();
  });
});

describe('LM-04 idempotency', () => {
  it('applying the same attempt twice changes nothing', () => {
    const b = new LogBuilder().subject('si-pi').kc('kc-si-reflection-coefficient', 'si-pi');
    const e = parseEvent(specAttempt);
    const f = emptyFacts();
    for (const ev of b.events) applyEvent(f, ev);
    applyEvent(f, e);
    const once = JSON.stringify(f);
    applyEvent(f, e);
    expect(JSON.stringify(f)).toBe(once);
    expect(f.kcs['kc-si-reflection-coefficient']!.attempt_ids).toEqual([specAttempt.id]);
  });
});

describe('LM-12 prerequisite DAG', () => {
  it('rejects cycles', () => {
    const issues = validateGraph([
      { id: 'kc-a', prerequisites: ['kc-c'] },
      { id: 'kc-b', prerequisites: ['kc-a'] },
      { id: 'kc-c', prerequisites: ['kc-b'] },
    ]);
    expect(issues.some((i) => i.code === 'cycle')).toBe(true);
  });
  it('rejects dangling ids and self references', () => {
    const issues = validateGraph([
      { id: 'kc-a', prerequisites: ['kc-missing'], confusable_with: ['kc-nope'] },
      { id: 'kc-b', prerequisites: ['kc-b'] },
    ]);
    expect(issues.map((i) => i.code).sort()).toEqual([
      'dangling_confusable',
      'dangling_prerequisite',
      'self_reference',
    ]);
  });
  it('accepts a DAG with edges across subjects', () => {
    expect(
      validateGraph([
        { id: 'kc-math-complex-numbers', prerequisites: [] },
        { id: 'kc-si-impedance', prerequisites: ['kc-math-complex-numbers'] },
        { id: 'kc-si-gamma', prerequisites: ['kc-si-impedance', 'kc-math-complex-numbers'] },
      ]),
    ).toEqual([]);
  });
  it('orders prerequisites first and finds ancestors', () => {
    const nodes = [
      { id: 'kc-c', prerequisites: ['kc-b'] },
      { id: 'kc-b', prerequisites: ['kc-a'] },
      { id: 'kc-a', prerequisites: [] },
      { id: 'kc-d', prerequisites: [] },
    ];
    expect(topoOrder(nodes)).toEqual(['kc-a', 'kc-d', 'kc-b', 'kc-c']);
    expect([...ancestors(nodes, ['kc-c'])].sort()).toEqual(['kc-a', 'kc-b']);
  });
});
