import type { ScenarioChecks } from './checker.js';
import type { FixtureOptions } from './fixture.js';
import type { LearnerScript } from './learner.js';

// The ten V-PED scenarios of the build spec (10 has two parts). Runs are kept small: a short
// session, a few learner turns, then a wrap-up request so the tutor closes the session.

export interface Scenario {
  id: string;
  title: string;
  fixture: FixtureOptions;
  focus: string;
  learner: LearnerScript;
  checks: ScenarioChecks;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 's01-new-kc',
    title: 'A new KC with a novice learner',
    fixture: { gamma_unseen: true },
    focus: 'si-pi',
    learner: {
      opening:
        'Hi! Can we do a 15-minute SI/PI session? I think reflections are next. I am new to this, so go slowly.',
      turns: 6,
      rules: [],
    },
    checks: {},
  },
  {
    id: 's02-misconception',
    title: 'A confident misconception ("a 50 Ω line never reflects")',
    fixture: {},
    focus: 'si-pi',
    learner: {
      opening: 'Hi, 15 minutes of SI/PI today please.',
      turns: 7,
      rules: [
        {
          id: 'belief',
          once: true,
          when: /Γ|\b(reflect\w*|gamma|75)\b/i,
          reply:
            'No reflection: a 50 Ω line never reflects, whatever is at the far end. That is the point of 50 Ω. Confidence 4.',
          answer: true,
        },
        {
          id: 'why',
          once: true,
          when: /\b(why|what makes you|reasoning|walk me through|in your own words|say more)\b/i,
          reply: 'Because 50 Ω is the standard matched impedance, so the line is always matched to itself.',
        },
        {
          id: 'retest',
          when: /Γ|\b(reflect\w*|gamma|load|short|open)\b/i,
          reply:
            'Oh, so it depends on the load: Γ = (ZL − Z0)/(ZL + Z0), and it only vanishes when ZL = Z0. Confidence 3.',
          answer: true,
        },
      ],
    },
    checks: { repair: true },
  },
  {
    id: 's03-lucky-guess',
    title: 'A lucky guess (correct at confidence 1)',
    fixture: {},
    focus: 'si-pi',
    learner: {
      opening: 'Quick 10-minute SI/PI review?',
      turns: 5,
      rules: [
        {
          id: 'guess',
          once: true,
          when: /Γ|\b(reflect\w*|gamma|75)\b/i,
          reply: 'Γ = 0.2? Honestly that is just a guess. Confidence 1.',
          answer: true,
        },
      ],
    },
    checks: {},
  },
  {
    id: 's04-idk',
    title: '"I don\'t know"',
    fixture: {},
    focus: 'si-pi',
    learner: {
      opening: '10 minutes on SI/PI, please.',
      turns: 5,
      rules: [{ id: 'idk', once: true, when: /\?/, reply: "I don't know.", answer: true }],
    },
    checks: {},
  },
  {
    id: 's05-demand-answer',
    title: 'The learner demands the answer immediately',
    fixture: {},
    focus: 'si-pi',
    learner: {
      opening: 'SI/PI for 10 minutes. And please just tell me answers, I hate guessing.',
      turns: 5,
      rules: [
        {
          id: 'demand',
          once: true,
          when: /\?/,
          reply: 'Can you just tell me the answer? I do not want to guess.',
        },
        {
          id: 'demand2',
          once: true,
          when: /\?/,
          reply: 'Fine. Maybe it is zero? Confidence 1.',
          answer: true,
        },
      ],
    },
    checks: {},
  },
  {
    id: 's06-forgotten',
    title: 'A forgotten KC (21 days later, anchor-card lapse)',
    fixture: { age_days: 21, anchor_lapse: true },
    focus: 'si-pi',
    learner: {
      opening: 'Back after three weeks away. 15 minutes of SI/PI?',
      turns: 6,
      rules: [
        {
          id: 'forgot',
          once: true,
          when: /Γ|\b(reflect\w*|gamma)\b/i,
          reply:
            'I remember there is a formula with ZL and Z0 but not which way round. Maybe (Z0 − ZL)/(Z0 + ZL)? Confidence 1.',
          answer: true,
        },
      ],
    },
    checks: {},
  },
  {
    id: 's07-teach-back',
    title: 'A teach-back missing a causal link',
    fixture: {},
    focus: 'si-pi',
    learner: {
      opening: 'SI/PI, 15 minutes. Could I try explaining reflections back to you today?',
      turns: 6,
      rules: [
        {
          id: 'teach',
          once: true,
          when: /\b(teach|explain|in your own words|go ahead)\b/i,
          reply:
            'When the signal reaches the end of the line, part of it bounces back toward the source, and that is the reflection. The bigger the mismatch, the bigger the reflection. Confidence 3.',
          answer: true,
        },
        {
          id: 'probe',
          once: true,
          when: /\b(why|what causes|what makes|what happens at)\b/i,
          reply: 'Hmm, I think because the energy has to go somewhere? Confidence 2.',
          answer: true,
        },
      ],
    },
    checks: {},
  },
  {
    id: 's08-wrong-key',
    title: 'A wrong answer key in the bank (TP-06)',
    fixture: { wrong_key: true },
    focus: 'si-pi',
    learner: {
      opening: 'Hi, 10 minutes of SI/PI please.',
      turns: 5,
      rules: [
        {
          id: 'confident-correct',
          when: /\bopen\b/i,
          reply:
            'Γ = +1 at an open: ZL goes to infinity, so (ZL − Z0)/(ZL + Z0) → 1 and the reflection is not inverted. Confidence 4.',
          answer: true,
        },
        {
          id: 'insist',
          once: true,
          when: /\b(−1|-1|inverted)\b/i,
          reply: 'Are you sure? Take the limit: (ZL − Z0)/(ZL + Z0) goes to +1 as ZL goes to infinity.',
        },
      ],
    },
    checks: { wrong_key_question: 'Q-0009' },
  },
  {
    id: 's09-oversimplified-card',
    title: 'A deep check reveals an oversimplified Anki card (TP-17)',
    fixture: { oversimplified_card: true },
    focus: 'si-pi',
    learner: {
      opening: 'SI/PI, 15 minutes. My Anki card on reflections keeps coming up, by the way.',
      turns: 7,
      rules: [
        {
          id: 'card-belief',
          once: true,
          when: /Γ|\b(reflect\w*|gamma|75)\b/i,
          reply:
            'My card says a line reflects only when it is not 50 Ω, so a 50 Ω trace into 75 Ω would not reflect? Confidence 2.',
          answer: true,
        },
        {
          id: 'approve-rewrite',
          when: /\b(rewrite|retire|reset|change|update|fix)\b.*\b(card)\b|\bcard\b.*\b(rewrite|retire|reset|change|update|fix)\b/i,
          reply: 'Yes, rewrite and reset it.',
        },
      ],
    },
    checks: { hygiene: true },
  },
  {
    id: 's10a-onboarding',
    title: 'Onboarding a new, unrelated subject from scratch',
    fixture: {},
    focus: 'music-theory',
    learner: {
      opening:
        'I want to start a new subject: music theory. I want to read chord symbols on jazz lead sheets.',
      turns: 9,
      wrap_turns: 3,
      rules: [
        {
          id: 'goal',
          once: true,
          when: /\b(want to be able|goal|what do you want|why)\b/i,
          reply: 'To read a chord symbol like Cmaj7 or F7 and know which notes are in it.',
        },
        {
          id: 'background',
          once: true,
          when: /\b(background|experience|play|instrument|know already)\b/i,
          reply: 'I played piano as a kid, I read treble clef slowly, and I know what a major scale is.',
        },
        {
          id: 'time',
          once: true,
          when: /\b(time|hours|per week|how often)\b/i,
          reply: 'About two hours a week.',
        },
        {
          id: 'sources',
          once: true,
          when: /\b(source|book|course|material|using)\b/i,
          reply: 'The Jazz Theory Book by Mark Levine, chapter 1.',
        },
        {
          id: 'title',
          once: true,
          when: /\b(call it|name|title|alias)\b/i,
          reply: 'Call it Music theory; "music" and "jazz harmony" are fine aliases.',
        },
      ],
    },
    checks: { onboarding: true },
  },
  {
    id: 's10b-focus',
    title: 'A focused music-theory session while SI/PI has a forgotten KC and an active misconception',
    fixture: { music: true, misconception: true, anchor_lapse: true },
    focus: 'music-theory',
    learner: {
      opening: 'Music theory today, 15 minutes please.',
      turns: 7,
      at_turn: {
        7: { reply: 'Actually, can we switch to SI/PI for the rest of the time?', switch_to: 'si-pi' },
      },
      rules: [
        {
          id: 'carryover-miss',
          once: true,
          when: /Γ|SI\/PI|\b(gamma|reflect\w*|Z0|carry-?over)\b/i,
          reply: 'A 50 Ω line never reflects, so zero? Confidence 3.',
          answer: true,
        },
      ],
    },
    checks: { focus: true },
  },
];

export function scenarioById(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id || x.id.startsWith(`${id}-`) || x.id.split('-')[0] === id);
  if (!s) throw new Error(`unknown scenario ${id}; known: ${SCENARIOS.map((x) => x.id).join(', ')}`);
  return s;
}
