import { keyHash } from '../../src/core/service/bank.js';
import { LogBuilder } from '../helpers/builder.js';

// Synthetic fixture: two unrelated active subjects (SI/PI, music theory) and one paused (Spanish).
// Used by planner, briefing, CLI and MCP tests. Times are America/New_York.

export const FIXTURE_NOW = '2026-10-09T18:00:00-04:00';

export const BELIEF_50 = 'A 50 Ω line never reflects, whatever terminates it';

export function questionEvent(
  b: LogBuilder,
  id: string,
  kc: string[],
  qtype: string,
  stem: string,
  opts: { verdict?: 'ok' | 'pending' | 'fix'; misconception?: string; by?: string; reviewer?: string } = {},
): void {
  const question = {
    kc_ids: kc,
    qtype,
    format: 'free',
    difficulty: 2,
    stem,
    answer_key: 'see rubric',
    rubric: [{ id: 'R1', proposition: 'states the key relation' }],
    hints: ['H1', 'H2', 'H3', 'H4'],
    misconception_targets: opts.misconception ? [{ option_or_belief: BELIEF_50, misconception_id: opts.misconception }] : [],
    created_by: opts.by ?? 'claude-desktop',
  };
  b.push({ type: 'question_added', question_id: id, key_hash: keyHash(question), question });
  if ((opts.verdict ?? 'ok') !== 'pending') {
    b.push({
      type: 'question_reviewed',
      question_id: id,
      verdict: opts.verdict ?? 'ok',
      by: opts.reviewer ?? 'codex',
      notes: '',
    });
  }
}

export function standardFixture(): LogBuilder {
  const b = new LogBuilder('2026-09-01T09:00:00-04:00');
  b.subject('si-pi', { title: 'SI/PI', aliases: ['signal integrity', 'sipi'], goals: ['read Bogatin ch. 7'] });
  b.subject('music-theory', { title: 'Music theory', aliases: ['music'] });
  b.subject('spanish', { title: 'Spanish', aliases: ['español'] });

  b.kc('kc-si-voltage-current', 'si-pi', { title: 'Voltage and current on a line', kind: 'fact' });
  b.kc('kc-si-characteristic-impedance', 'si-pi', {
    title: 'Characteristic impedance (Z0)',
    prerequisites: ['kc-si-voltage-current'],
  });
  b.kc('kc-si-propagation-delay', 'si-pi', { title: 'Propagation delay (TD)', prerequisites: ['kc-si-voltage-current'] });
  b.kc('kc-si-instantaneous-impedance', 'si-pi', {
    title: 'Instantaneous impedance',
    prerequisites: ['kc-si-characteristic-impedance'],
  });
  b.kc('kc-si-reflection-coefficient', 'si-pi', {
    title: 'Reflection coefficient (Γ)',
    kind: 'principle',
    prerequisites: ['kc-si-characteristic-impedance', 'kc-si-instantaneous-impedance'],
    confusable_with: ['kc-si-transmission-coefficient'],
    requires_visual: true,
  });
  b.kc('kc-si-transmission-coefficient', 'si-pi', {
    title: 'Transmission coefficient (T)',
    prerequisites: ['kc-si-characteristic-impedance'],
    confusable_with: ['kc-si-reflection-coefficient'],
  });
  b.kc('kc-si-termination-strategies', 'si-pi', {
    title: 'Termination strategies',
    kind: 'procedure',
    prerequisites: ['kc-si-reflection-coefficient'],
  });
  b.kc('kc-si-lattice-diagram', 'si-pi', {
    title: 'Lattice (bounce) diagram',
    prerequisites: ['kc-si-reflection-coefficient', 'kc-si-propagation-delay'],
    requires_visual: true,
  });

  b.kc('kc-mt-intervals', 'music-theory', { title: 'Intervals' });
  b.kc('kc-mt-major-scale', 'music-theory', { title: 'Major scale', prerequisites: ['kc-mt-intervals'] });
  b.kc('kc-mt-triads', 'music-theory', { title: 'Triads', prerequisites: ['kc-mt-major-scale'] });
  b.kc('kc-mt-key-signatures', 'music-theory', { title: 'Key signatures', prerequisites: ['kc-mt-major-scale'] });

  b.kc('kc-es-ser-estar', 'spanish', { title: 'Ser vs. estar' });
  b.kc('kc-es-preterite', 'spanish', { title: 'Preterite' });

  questionEvent(b, 'Q-0001', ['kc-si-voltage-current'], 'recall', 'State how voltage and current relate on an ideal line.');
  questionEvent(b, 'Q-0002', ['kc-si-reflection-coefficient'], 'diagnose', 'Find the error: "a 50 Ω trace never reflects".', {
    misconception: 'M-0001',
  });
  questionEvent(b, 'Q-0003', ['kc-si-transmission-coefficient'], 'predict', 'Predict the transmitted step into 75 Ω from 50 Ω.');
  questionEvent(b, 'Q-0004', ['kc-si-propagation-delay'], 'transfer', 'Estimate TD for a 30 cm coax cable with εr = 2.3.');
  questionEvent(b, 'Q-0005', ['kc-si-characteristic-impedance'], 'explain', 'Why is Z0 not a DC resistance?', {
    verdict: 'pending',
  });
  questionEvent(b, 'Q-0006', ['kc-mt-intervals'], 'recall', 'Name the interval from C up to G.');
  questionEvent(b, 'Q-0007', ['kc-si-voltage-current'], 'explain', 'Explain why the current is V/Z0 on a launched edge.');

  // Session 1 on SI/PI.
  b.at('2026-09-01T19:00:00-04:00').session('S-2026-09-01-1', 'si-pi');
  const s1 = { session: 'S-2026-09-01-1' };
  b.taught('kc-si-voltage-current', 'S-2026-09-01-1');
  b.attempt('kc-si-voltage-current', 'correct', { conf: 3, qtype: 'recall', ...s1, q: 'Q-0001' });
  b.hours(0.1).attempt('kc-si-voltage-current', 'correct', { conf: 4, qtype: 'explain', ...s1, q: 'Q-0007' });
  b.taught('kc-si-characteristic-impedance', 'S-2026-09-01-1');
  b.hours(0.1).attempt('kc-si-characteristic-impedance', 'correct', { conf: 3, qtype: 'recall', ...s1 });
  b.taught('kc-si-propagation-delay', 'S-2026-09-01-1');
  b.hours(0.1).attempt('kc-si-propagation-delay', 'correct', { conf: 3, qtype: 'recall', ...s1 });
  b.hours(0.1).attempt('kc-si-propagation-delay', 'correct', { conf: 3, qtype: 'apply', ...s1 });
  b.hours(0.2).endSession('S-2026-09-01-1', 'Built V/I on a line and Z0; TD by example.', ['Z0 vs. DC resistance']);

  // Session 2 on SI/PI.
  b.at('2026-09-03T19:00:00-04:00').session('S-2026-09-03-1', 'si-pi');
  const s2 = { session: 'S-2026-09-03-1' };
  b.attempt('kc-si-voltage-current', 'correct', { conf: 3, qtype: 'predict', ...s2 });
  b.hours(0.1).attempt('kc-si-propagation-delay', 'correct', { conf: 4, qtype: 'explain', ...s2 });
  for (const k of ['kc-si-instantaneous-impedance', 'kc-si-reflection-coefficient', 'kc-si-transmission-coefficient']) {
    b.taught(k, 'S-2026-09-03-1');
    b.hours(0.1).attempt(k, 'correct', { conf: 3, qtype: 'recall', ...s2 });
  }
  b.hours(0.2).endSession('S-2026-09-03-1', 'Instantaneous impedance; Γ and T introduced.', []);

  // A quick ad hoc check on Z0 (not in a session), unsure but right.
  b.at('2026-09-08T12:00:00-04:00').attempt('kc-si-characteristic-impedance', 'correct', { conf: 2, qtype: 'recall' });

  // Spanish, before it was paused.
  b.at('2026-09-05T10:00:00-04:00').session('S-2026-09-05-1', 'spanish');
  b.taught('kc-es-ser-estar', 'S-2026-09-05-1');
  b.attempt('kc-es-ser-estar', 'correct', { conf: 3, session: 'S-2026-09-05-1' });
  b.hours(0.5).endSession('S-2026-09-05-1', 'ser vs. estar', []);

  // Music theory.
  b.at('2026-09-10T20:00:00-04:00').session('S-2026-09-10-1', 'music-theory');
  for (const k of ['kc-mt-intervals', 'kc-mt-major-scale']) {
    b.taught(k, 'S-2026-09-10-1');
    b.hours(0.1).attempt(k, 'correct', { conf: 3, session: 'S-2026-09-10-1' });
  }
  b.hours(0.3).endSession('S-2026-09-10-1', 'Intervals and the major scale.', []);

  b.at('2026-09-15T08:00:00-04:00').scope('spanish', 'active', 'paused');

  // Session 3 on SI/PI.
  b.at('2026-09-20T19:00:00-04:00').session('S-2026-09-20-1', 'si-pi');
  const s3 = { session: 'S-2026-09-20-1' };
  b.attempt('kc-si-transmission-coefficient', 'incorrect', { conf: 3, qtype: 'predict', ...s3, q: 'Q-0003' });
  b.hours(0.1).attempt('kc-si-reflection-coefficient', 'incorrect', {
    conf: 4,
    qtype: 'predict',
    ...s3,
    mid: 'M-0001',
    belief: BELIEF_50,
  });
  b.hours(0.1).attempt('kc-si-voltage-current', 'correct', { conf: 4, qtype: 'recall', ...s3 });
  b.hours(0.1).attempt('kc-si-propagation-delay', 'correct', { conf: 4, qtype: 'recall', ...s3 });
  b.hours(0.1).attempt('kc-si-instantaneous-impedance', 'correct', { conf: 4, qtype: 'explain', ...s3 });
  b.hours(0.2).endSession(
    'S-2026-09-20-1',
    'Z0 vs. termination; Γ predicted wrong with high confidence.',
    ['believes a 50 Ω line never reflects'],
  );

  // Music theory again: intervals forgotten.
  b.at('2026-09-25T20:00:00-04:00').session('S-2026-09-25-1', 'music-theory');
  b.attempt('kc-mt-intervals', 'incorrect', { conf: 3, session: 'S-2026-09-25-1', q: 'Q-0006' });
  b.hours(0.1).attempt('kc-mt-major-scale', 'correct', { conf: 3, session: 'S-2026-09-25-1', qtype: 'explain' });
  b.hours(0.3).endSession('S-2026-09-25-1', 'Intervals slipped; scale steps held.', ['interval naming']);

  // Anki: a lapse on a non-anchor card for instantaneous impedance, a leech on the major scale.
  b.at('2026-10-05T07:30:00-04:00').push({
    type: 'anki_reviews_imported',
    since: null,
    reviews: [
      {
        review_id: 1790000000001,
        card_id: 501,
        note_id: 401,
        kc_ids: ['kc-si-instantaneous-impedance'],
        subject: 'si-pi',
        anchor: false,
        ease: 1,
        revlog_type: 1,
        ivl: 1,
        last_ivl: 12,
        time_ms: 9000,
        ts: '2026-10-05T07:20:00-04:00',
        lapse: true,
      },
    ],
    flags: [{ note_id: 402, card_id: 502, kc_ids: ['kc-mt-major-scale'], kind: 'leech' }],
  });
  b.at(FIXTURE_NOW);
  return b;
}
