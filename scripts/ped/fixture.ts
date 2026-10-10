import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Warnings } from '../../src/core/envelope.js';
import { SeqIds } from '../../src/core/ids.js';
import type { QuestionInput } from '../../src/core/schemas/question.js';
import { parseEvent, type ScaffoldEvent } from '../../src/core/schemas/events.js';
import { keyHash } from '../../src/core/service/bank.js';
import { rebuildVault } from '../../src/core/service/ops/maintenance.js';
import type { AnkiMirror } from '../../src/core/anki/mirror.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { syncFromVault } from '../../src/core/service/sync.js';
import { DAY_MS, HOUR_MS, localDate, systemClock, systemTimeZone } from '../../src/core/time.js';
import { initVault } from '../../src/core/vault/init.js';
import type { Transcript } from './types.js';

// V-PED fixture vaults: the pilot SI/PI KCs (transmission-line foundations) and, for scenario 10,
// a small unrelated music-theory subject. Synthetic data only (C7). Timestamps are relative to the
// real "now", because the front-ends drive the MCP server on the system clock.

export const BELIEF_50 = 'A 50 Ω line never reflects, whatever terminates it';

export interface FixtureOptions {
  /** Scenario 6: shift all history back this many days (forgotten KCs). */
  age_days?: number;
  /** Scenario 6 and 10b: an anchor card lapse on Γ two days ago. */
  anchor_lapse?: boolean;
  /** Scenario 10b: an open misconception on Γ. */
  misconception?: boolean;
  /** Scenario 8: a bank question on Γ whose key is wrong. */
  wrong_key?: boolean;
  /** Scenario 9: an oversimplified Anki card linked to Γ. */
  oversimplified_card?: boolean;
  /** Scenario 10b: the music-theory subject with history. */
  music?: boolean;
  /** Scenario 1: Γ still unseen (the frontier KC). */
  gamma_unseen?: boolean;
}

interface KcSpec {
  id: string;
  title: string;
  subject: string;
  kind?: string;
  prerequisites?: string[];
  confusable_with?: string[];
  requires_visual?: boolean;
}

export const SI_KCS: KcSpec[] = [
  { id: 'kc-si-voltage-current', title: 'Voltage and current on a line', subject: 'si-pi', kind: 'fact' },
  {
    id: 'kc-si-characteristic-impedance',
    title: 'Characteristic impedance (Z0)',
    subject: 'si-pi',
    prerequisites: ['kc-si-voltage-current'],
  },
  {
    id: 'kc-si-propagation-delay',
    title: 'Propagation delay (TD)',
    subject: 'si-pi',
    prerequisites: ['kc-si-voltage-current'],
  },
  {
    id: 'kc-si-instantaneous-impedance',
    title: 'Instantaneous impedance',
    subject: 'si-pi',
    prerequisites: ['kc-si-characteristic-impedance'],
  },
  {
    id: 'kc-si-reflection-coefficient',
    title: 'Reflection coefficient (Γ)',
    subject: 'si-pi',
    kind: 'principle',
    prerequisites: ['kc-si-characteristic-impedance', 'kc-si-instantaneous-impedance'],
    confusable_with: ['kc-si-transmission-coefficient'],
    requires_visual: true,
  },
  {
    id: 'kc-si-transmission-coefficient',
    title: 'Transmission coefficient (T)',
    subject: 'si-pi',
    prerequisites: ['kc-si-characteristic-impedance'],
    confusable_with: ['kc-si-reflection-coefficient'],
  },
  {
    id: 'kc-si-open-short',
    title: 'Open and short terminations',
    subject: 'si-pi',
    prerequisites: ['kc-si-reflection-coefficient'],
  },
  {
    id: 'kc-si-termination-strategies',
    title: 'Termination strategies',
    subject: 'si-pi',
    kind: 'procedure',
    prerequisites: ['kc-si-reflection-coefficient'],
  },
  {
    id: 'kc-si-lattice-diagram',
    title: 'Lattice (bounce) diagram',
    subject: 'si-pi',
    kind: 'procedure',
    prerequisites: ['kc-si-reflection-coefficient', 'kc-si-propagation-delay'],
    requires_visual: true,
  },
  {
    id: 'kc-si-electrically-long',
    title: 'When a line is electrically long',
    subject: 'si-pi',
    prerequisites: ['kc-si-propagation-delay'],
  },
];

export const MT_KCS: KcSpec[] = [
  { id: 'kc-mt-intervals', title: 'Intervals', subject: 'music-theory' },
  {
    id: 'kc-mt-major-scale',
    title: 'Major scale',
    subject: 'music-theory',
    prerequisites: ['kc-mt-intervals'],
  },
  { id: 'kc-mt-triads', title: 'Triads', subject: 'music-theory', prerequisites: ['kc-mt-major-scale'] },
  {
    id: 'kc-mt-chord-symbols',
    title: 'Chord symbols',
    subject: 'music-theory',
    prerequisites: ['kc-mt-triads'],
  },
];

type Q = Omit<QuestionInput, 'created_by' | 'misconception_targets'> & {
  id: string;
  misconception_targets?: QuestionInput['misconception_targets'];
};

const H = (a: string, b: string, c: string, d: string): string[] => [a, b, c, d];

/** Bank questions with real keys (all reviewed `ok` unless noted). */
export const SI_QUESTIONS: Q[] = [
  {
    id: 'Q-0001',
    kc_ids: ['kc-si-voltage-current'],
    qtype: 'explain',
    format: 'free',
    difficulty: 2,
    stem: 'A 1 V step is launched into a uniform 50 Ω line. Before any reflection returns, what current flows into the line, and why does it not depend on what is at the far end?',
    answer_key:
      'I = V/Z0 = 1 V / 50 Ω = 20 mA. The source only sees the line’s instantaneous impedance until a reflection arrives, so the far-end load cannot affect the current yet.',
    rubric: [
      { id: 'R1', proposition: 'I = V/Z0 = 20 mA' },
      { id: 'R2', proposition: 'the far end is not seen until a reflection returns (round trip)' },
    ],
    hints: H(
      'What impedance does the step see as it enters the line?',
      'On a uniform line the step sees Z0 at every instant.',
      'Ohm’s law with Z0: I = V / Z0.',
      'I = 1 V / 50 Ω = 20 mA; the load matters only after 2 TD.',
    ),
  },
  {
    id: 'Q-0002',
    kc_ids: ['kc-si-reflection-coefficient'],
    qtype: 'diagnose',
    format: 'free',
    difficulty: 2,
    stem: 'A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident voltage comes back?',
    answer_key:
      'Yes. Γ = (75 − 50)/(75 + 50) = +0.2, so 20 % of the incident voltage reflects, in phase. A 50 Ω line reflects whenever the load differs from 50 Ω.',
    rubric: [
      { id: 'R1', proposition: 'it reflects because the load differs from Z0' },
      { id: 'R2', proposition: 'Γ = (ZL − Z0)/(ZL + Z0) = +0.2' },
    ],
    hints: H(
      'What decides whether a wave reflects: the line alone, or the line and the load?',
      'Reflection happens wherever the impedance the wave sees changes.',
      'Γ = (ZL − Z0)/(ZL + Z0) with ZL = 75 Ω and Z0 = 50 Ω.',
      'Γ = 25/125 = +0.2: 20 % reflects, in phase.',
    ),
    misconception_targets: [{ option_or_belief: BELIEF_50, misconception_id: null }],
  },
  {
    id: 'Q-0003',
    kc_ids: ['kc-si-transmission-coefficient'],
    qtype: 'predict',
    format: 'free',
    difficulty: 3,
    stem: 'A 1 V edge on a 50 Ω line meets a 75 Ω section. Predict the voltage of the edge that continues into the 75 Ω section, and say why it can exceed the incident 1 V.',
    answer_key:
      'T = 2·75/(75 + 50) = 1.2, so 1.2 V continues. Voltage is continuous at the junction: incident 1 V plus reflected +0.2 V equals the transmitted 1.2 V; energy is still conserved because the current drops.',
    rubric: [
      { id: 'R1', proposition: 'T = 2ZL/(ZL + Z0) = 1.2, so 1.2 V' },
      { id: 'R2', proposition: 'incident + reflected = transmitted (voltage continuity)' },
    ],
    hints: H(
      'What must be true of the voltage on both sides of the junction?',
      'The voltage just left of the junction equals the voltage just right of it.',
      'Transmitted = incident + reflected, with Γ = +0.2.',
      '1 V + 0.2 V = 1.2 V; T = 1 + Γ = 1.2.',
    ),
  },
  {
    id: 'Q-0004',
    kc_ids: ['kc-si-propagation-delay'],
    qtype: 'apply',
    format: 'numeric',
    difficulty: 2,
    stem: 'A stripline in FR4 has εr = 4. How long, in ns, does an edge take to travel 30 cm along it? Use c = 30 cm/ns.',
    answer_key: 'v = c/√εr = 15 cm/ns, so TD = 30 cm / 15 cm/ns = 2 ns.',
    numeric: { value: 2, unit: 'ns', tolerance: '5%' },
    rubric: [{ id: 'R1', proposition: 'v = c/√εr and TD = length/v = 2 ns' }],
    hints: H(
      'How fast does a signal travel in a dielectric compared with vacuum?',
      'v = c / √εr.',
      'v = 30/2 = 15 cm/ns.',
      'TD = 30 cm / 15 cm/ns = 2 ns.',
    ),
  },
  {
    id: 'Q-0005',
    kc_ids: ['kc-si-characteristic-impedance'],
    qtype: 'explain',
    format: 'free',
    difficulty: 3,
    stem: 'An ohmmeter across the two conductors of a 50 Ω coax (far end open) reads “open circuit”. Explain why that does not contradict Z0 = 50 Ω.',
    answer_key:
      'Z0 is the ratio of voltage to current for a wave travelling on the line, set by its capacitance and inductance per length. It is not a DC resistance: at DC the open end means no current flows once the line has charged.',
    rubric: [
      { id: 'R1', proposition: 'Z0 is the V/I ratio of a travelling wave (set by L and C per length)' },
      { id: 'R2', proposition: 'Z0 is not a DC resistance; at DC the open end draws no current' },
    ],
    hints: H(
      'What does an ohmmeter measure: a steady state or a travelling wave?',
      'Z0 describes the wave, not the steady state.',
      'Z0 = √(L/C) per unit length; the ohmmeter sees the open end once the line has charged.',
      'Z0 is the wave’s V/I; at DC an open line draws no current, so the meter reads open.',
    ),
  },
  {
    id: 'Q-0006',
    kc_ids: ['kc-si-instantaneous-impedance'],
    qtype: 'predict',
    format: 'free',
    difficulty: 2,
    stem: 'A uniform 50 Ω line is 1 m long. A step travels along it. What impedance does the step see at 10 cm, at 50 cm and at 90 cm, and why?',
    answer_key:
      '50 Ω at every point: on a uniform line the instantaneous impedance equals Z0 everywhere, because each new section has the same capacitance and inductance per length.',
    rubric: [{ id: 'R1', proposition: '50 Ω everywhere because the line is uniform' }],
    hints: H(
      'What does “uniform” say about each small section of the line?',
      'Each section has the same L and C per length.',
      'The impedance the step sees is set by the section it is charging.',
      'It sees 50 Ω at every point.',
    ),
  },
  {
    id: 'Q-0007',
    kc_ids: ['kc-mt-intervals'],
    qtype: 'recall',
    format: 'free',
    difficulty: 1,
    stem: 'Name the interval from C up to G, and say how many semitones it spans.',
    answer_key: 'A perfect fifth, 7 semitones.',
    rubric: [{ id: 'R1', proposition: 'perfect fifth, 7 semitones' }],
    hints: H(
      'Count letter names C to G.',
      'C D E F G is five letters.',
      'Count semitones C→G.',
      'Perfect fifth, 7 semitones.',
    ),
  },
  {
    id: 'Q-0008',
    kc_ids: ['kc-mt-major-scale'],
    qtype: 'apply',
    format: 'free',
    difficulty: 2,
    stem: 'Using the whole/half-step pattern of a major scale, spell the D major scale.',
    answer_key: 'D E F♯ G A B C♯ D (W W H W W W H).',
    rubric: [
      { id: 'R1', proposition: 'pattern W W H W W W H' },
      { id: 'R2', proposition: 'D E F♯ G A B C♯ D' },
    ],
    hints: H('Write the step pattern.', 'W W H W W W H.', 'Start on D and apply it.', 'D E F♯ G A B C♯ D.'),
  },
];

/** Scenario 8: the open-circuit key is deliberately wrong (Γ is +1 at an open, not −1). */
export const WRONG_KEY_QUESTION: Q = {
  id: 'Q-0009',
  kc_ids: ['kc-si-reflection-coefficient'],
  qtype: 'predict',
  format: 'free',
  difficulty: 2,
  stem: 'An ideal 50 Ω line is left open at its far end. What is the reflection coefficient at the open end, and is the reflected voltage inverted or not?',
  answer_key: 'Γ = −1 at an open, so the reflected voltage is inverted.',
  rubric: [{ id: 'R1', proposition: 'Γ = −1 at an open; the reflection is inverted' }],
  hints: H(
    'What is ZL for an open?',
    'An open is ZL → ∞.',
    'Take the limit of (ZL − Z0)/(ZL + Z0).',
    'Γ = −1 at an open (inverted).',
  ),
};

class Builder {
  readonly events: ScaffoldEvent[] = [];
  private n = 0;
  constructor(
    private readonly now: number,
    private readonly tz: string,
    private readonly age: number,
  ) {}
  /** A time `days` ago at local `hour` (approximately; synthetic). */
  ts(days: number, hour = 19): string {
    const d = new Date(this.now - (days + this.age) * DAY_MS);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }
  push(ts: string, e: Record<string, unknown>): ScaffoldEvent {
    this.n += 1;
    const ev = parseEvent({ id: `PED${String(this.n).padStart(7, '0')}`, ts, ...e });
    this.events.push(ev);
    return ev;
  }
  sessionId(ts: string): string {
    const date = localDate(new Date(ts), this.tz);
    const used = this.events.filter(
      (e) => e.type === 'session_started' && e.session_id.startsWith(`S-${date}-`),
    ).length;
    return `S-${date}-${used + 1}`;
  }
}

function emptyPlan(subject: string): Record<string, unknown> {
  return {
    status: 'ok',
    focus: { subject, why: 'fixture' },
    minutes_requested: 30,
    minutes_planned: 0,
    carryover: 0,
    steps: [],
    trimmed: [],
    notes: [],
  };
}

const attempt = (
  session: string | null,
  kc: string,
  grade: 'correct' | 'partial' | 'incorrect',
  conf: number,
  opts: { qtype?: string; q?: string; mid?: string; belief?: string } = {},
): Record<string, unknown> => ({
  type: 'attempt',
  session_id: session,
  question_id: opts.q ?? null,
  question_text: opts.q ? null : `Fixture question on ${kc}`,
  kc_ids: [kc],
  qtype: opts.qtype ?? 'recall',
  format: 'free',
  answer_verbatim: 'fixture answer',
  grade,
  rubric_hits: [],
  evidence_quotes: [],
  confidence: conf,
  hints_used: 0,
  assisted: false,
  grader: 'fixture',
  grader_uncertain: false,
  misconception_id: opts.mid ?? null,
  misconception_belief: opts.belief ?? null,
  step: null,
});

/** The fixture event log for a scenario. */
export function pilotEvents(opts: FixtureOptions, now = Date.now(), tz = systemTimeZone()): ScaffoldEvent[] {
  const b = new Builder(now, tz, opts.age_days ?? 0);
  const t0 = b.ts(20, 9);
  b.push(t0, {
    type: 'subject_created',
    subject: {
      id: 'si-pi',
      title: 'SI/PI',
      aliases: ['signal integrity', 'sipi', 'transmission lines'],
      goals: ['understand reflections on PCB traces'],
      scope: 'active',
      anki_minutes: 'auto',
    },
  });
  const kcs = [...SI_KCS, ...(opts.music ? MT_KCS : [])];
  if (opts.music)
    b.push(t0, {
      type: 'subject_created',
      subject: {
        id: 'music-theory',
        title: 'Music theory',
        aliases: ['music', 'theory', 'jazz harmony'],
        goals: ['read chord symbols on lead sheets'],
        scope: 'active',
        anki_minutes: 'auto',
      },
    });
  for (const k of kcs)
    b.push(t0, {
      type: 'kc_created',
      kc: {
        id: k.id,
        title: k.title,
        subject: k.subject,
        kind: k.kind ?? 'concept',
        prerequisites: k.prerequisites ?? [],
        confusable_with: k.confusable_with ?? [],
        requires_visual: k.requires_visual ?? false,
        volatility: 'stable',
        review_by: null,
        anki_note_ids:
          opts.oversimplified_card && k.id === 'kc-si-reflection-coefficient' ? [1700000000101] : [],
        visuals: [],
        sources: [],
      },
    });
  const questions = [
    ...SI_QUESTIONS.filter((q) => opts.music || !q.kc_ids[0]!.startsWith('kc-mt-')),
    ...(opts.wrong_key ? [WRONG_KEY_QUESTION] : []),
  ].filter((q) => !(opts.wrong_key && q.id === 'Q-0002')); // scenario 8: the wrong key is the only Γ question
  for (const q of questions) {
    const { id, ...rest } = q;
    const question = { misconception_targets: [], created_by: 'claude-code', ...rest };
    b.push(t0, { type: 'question_added', question_id: id, key_hash: keyHash(question as never), question });
    b.push(t0, { type: 'question_reviewed', question_id: id, verdict: 'ok', by: 'codex', notes: '' });
  }

  // Session 1 (12 days ago): V/I, Z0, TD.
  let ts = b.ts(12);
  let s = b.sessionId(ts);
  b.push(ts, {
    type: 'session_started',
    session_id: s,
    focus: { subject: 'si-pi', why: 'fixture' },
    minutes: 30,
    carryover: 0,
    plan: emptyPlan('si-pi'),
  });
  for (const k of ['kc-si-voltage-current', 'kc-si-characteristic-impedance', 'kc-si-propagation-delay']) {
    b.push(ts, { type: 'taught', session_id: s, kc_ids: [k] });
    b.push(ts, attempt(s, k, 'correct', 3));
  }
  b.push(ts, {
    type: 'session_ended',
    session_id: s,
    summary: 'V/I on a line, Z0 and TD.',
    open_threads: ['Z0 vs. DC resistance'],
    next_preview: 'Instantaneous impedance.',
  });

  // Session 2 (9 days ago): reviews; instantaneous impedance.
  ts = b.ts(9);
  s = b.sessionId(ts);
  b.push(ts, {
    type: 'session_started',
    session_id: s,
    focus: { subject: 'si-pi', why: 'fixture' },
    minutes: 30,
    carryover: 0,
    plan: emptyPlan('si-pi'),
  });
  b.push(ts, attempt(s, 'kc-si-voltage-current', 'correct', 4, { qtype: 'explain' }));
  b.push(ts, attempt(s, 'kc-si-characteristic-impedance', 'correct', 3, { qtype: 'explain' }));
  b.push(ts, attempt(s, 'kc-si-propagation-delay', 'correct', 3, { qtype: 'apply' }));
  b.push(ts, { type: 'taught', session_id: s, kc_ids: ['kc-si-instantaneous-impedance'] });
  b.push(ts, attempt(s, 'kc-si-instantaneous-impedance', 'correct', 3));
  b.push(ts, {
    type: 'session_ended',
    session_id: s,
    summary: 'Instantaneous impedance; reviews held.',
    open_threads: [],
    next_preview: 'Reflections.',
  });

  // Session 3 (5 days ago): Γ and T introduced (unless scenario 1 keeps Γ for today).
  ts = b.ts(5);
  s = b.sessionId(ts);
  b.push(ts, {
    type: 'session_started',
    session_id: s,
    focus: { subject: 'si-pi', why: 'fixture' },
    minutes: 30,
    carryover: 0,
    plan: emptyPlan('si-pi'),
  });
  b.push(ts, attempt(s, 'kc-si-instantaneous-impedance', 'correct', 3, { qtype: 'predict' }));
  if (opts.gamma_unseen) {
    // Scenario 1: everything else on the frontier is learned, so Γ (requires_visual) is the new KC.
    for (const k of ['kc-si-transmission-coefficient', 'kc-si-electrically-long']) {
      b.push(ts, { type: 'taught', session_id: s, kc_ids: [k] });
      b.push(ts, attempt(s, k, 'correct', 3));
    }
  } else {
    b.push(ts, { type: 'taught', session_id: s, kc_ids: ['kc-si-reflection-coefficient'] });
    b.push(ts, attempt(s, 'kc-si-reflection-coefficient', 'correct', 2));
    b.push(ts, { type: 'taught', session_id: s, kc_ids: ['kc-si-transmission-coefficient'] });
    b.push(ts, attempt(s, 'kc-si-transmission-coefficient', 'partial', 2));
  }
  if (opts.misconception) {
    const at = b.push(
      ts,
      attempt(s, 'kc-si-reflection-coefficient', 'incorrect', 4, {
        qtype: 'diagnose',
        mid: 'M-0001',
        belief: BELIEF_50,
      }),
    );
    b.push(ts, {
      type: 'misconception_opened',
      misconception_id: 'M-0001',
      kc_ids: ['kc-si-reflection-coefficient'],
      belief: BELIEF_50,
      session_id: s,
      attempt_id: at.id,
      by: 'claude-code',
    });
  }
  b.push(ts, {
    type: 'session_ended',
    session_id: s,
    summary: opts.gamma_unseen ? 'T and electrical length; Γ next.' : 'Γ and T introduced; T still shaky.',
    open_threads: opts.misconception ? ['believes a 50 Ω line never reflects'] : [],
    next_preview: opts.gamma_unseen ? 'Reflections (Γ).' : 'Open and short terminations.',
  });

  if (opts.music) {
    // Music theory (3 days ago): intervals and the major scale.
    ts = b.ts(3, 20);
    s = b.sessionId(ts);
    b.push(ts, {
      type: 'session_started',
      session_id: s,
      focus: { subject: 'music-theory', why: 'fixture' },
      minutes: 30,
      carryover: 0,
      plan: emptyPlan('music-theory'),
    });
    for (const k of ['kc-mt-intervals', 'kc-mt-major-scale']) {
      b.push(ts, { type: 'taught', session_id: s, kc_ids: [k] });
      b.push(ts, attempt(s, k, 'correct', 3));
    }
    b.push(ts, {
      type: 'session_ended',
      session_id: s,
      summary: 'Intervals and the major scale.',
      open_threads: [],
      next_preview: 'Triads.',
    });
  }

  if (opts.anchor_lapse || opts.oversimplified_card) {
    const lapse = b.ts(2 - (opts.age_days ?? 0), 7);
    b.push(lapse, {
      type: 'anki_reviews_imported',
      since: null,
      reviews: [
        {
          review_id: 1790000000001,
          card_id: 1700000000201,
          note_id: 1700000000101,
          kc_ids: ['kc-si-reflection-coefficient'],
          subject: 'si-pi',
          anchor: !!opts.anchor_lapse,
          ease: opts.anchor_lapse ? 1 : 3,
          revlog_type: 1,
          ivl: opts.anchor_lapse ? 1 : 9,
          last_ivl: 6,
          time_ms: 8000,
          ts: lapse,
          lapse: !!opts.anchor_lapse,
        },
      ],
      flags: [],
    });
  }
  return b.events;
}

/** Scenario 9: the oversimplified card, as the Anki mirror holds it. */
export function oversimplifiedMirror(now = Date.now()): AnkiMirror {
  return {
    synced_at: new Date(now - HOUR_MS).toISOString(),
    api_version: 6,
    avg_seconds_per_review: 8,
    fsrs_enabled: true,
    decks: ['Scaffold::SI/PI'],
    cards: [
      {
        card_id: 1700000000201,
        note_id: 1700000000101,
        deck: 'Scaffold::SI/PI',
        home_deck: 'Scaffold::SI/PI',
        subject: 'si-pi',
        kc_ids: ['kc-si-reflection-coefficient'],
        anchor: false,
        tags: ['scaffold', 'kc::kc-si-reflection-coefficient'],
        model: 'Scaffold Basic',
        fields: {
          Front: 'When does a signal reflect on a transmission line?',
          Back: 'Only when the line is not 50 Ω.',
          KC_ID: 'kc-si-reflection-coefficient',
          Link: '',
          Extra: '',
        },
        front: 'When does a signal reflect on a transmission line?',
        back: 'Only when the line is not 50 Ω.',
        note_mod: 1700000000,
        interval: 9,
        queue: 2,
        type: 2,
        lapses: 0,
        reps: 3,
        suspended: false,
        due: 0,
      },
    ],
  };
}

export interface FixtureVault {
  root: string;
  events: ScaffoldEvent[];
  kcs: Transcript['kcs'];
  subjects: Transcript['subjects'];
  questions: Transcript['questions'];
}

/** Creates the vault for a scenario under `root` (which must not exist yet) and fills its notes. */
export function createFixtureVault(
  root: string,
  opts: FixtureOptions,
  userConfig: string,
  now = Date.now(),
): FixtureVault {
  mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  initVault(root, { userConfig });
  const seed = pilotEvents(opts, now);
  writeFileSync(
    path.join(root, 'Scaffold', '_system', 'events.jsonl'),
    seed.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
  if (opts.oversimplified_card)
    writeFileSync(
      path.join(root, 'Scaffold', '_system', 'anki-mirror.json'),
      JSON.stringify(oversimplifiedMirror(now), null, 2),
    );
  const sc = Scaffold.open(root, { clock: systemClock, ids: new SeqIds(), timezone: systemTimeZone() });
  const w = new Warnings();
  rebuildVault(sc, { restoreMissing: true }, w);
  // The first vault scan records note hashes (kc_updated, subject_updated). Run it here so the
  // baseline includes them and the run's events are only what the tutor caused.
  syncFromVault(sc, w);
  const events = sc.events();
  const derived = sc.derived();
  const facts = sc.facts();
  return {
    root,
    events,
    kcs: Object.values(facts.kcs).map((k) => ({
      id: k.fields.id,
      title: k.fields.title,
      subject: k.fields.subject,
      status_at_start: derived.kcs[k.fields.id]?.status ?? 'unseen',
      requires_visual: k.fields.requires_visual,
    })),
    subjects: Object.values(facts.subjects).map((s) => ({
      id: s.fields.id,
      title: s.fields.title,
      aliases: s.fields.aliases,
    })),
    questions: events.flatMap((e) =>
      e.type === 'question_added'
        ? [
            {
              id: e.question_id,
              kc_ids: e.question.kc_ids,
              stem: e.question.stem,
              answer_key: e.question.answer_key,
              rubric: e.question.rubric.map((r) => r.proposition),
            },
          ]
        : [],
    ),
  };
}
