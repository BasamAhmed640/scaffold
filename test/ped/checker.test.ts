import { describe, expect, it } from 'vitest';
import {
  checkAnalogies,
  checkAskBeforeTell,
  checkCardHygiene,
  checkCardProposals,
  checkClose,
  checkConfidence,
  checkFocus,
  checkKeyEscrow,
  checkNoLeak,
  checkOnboarding,
  checkRecorded,
  checkRepair,
  checkSegments,
  checkTranscript,
  checkVisuals,
  checkWrongKey,
  explanationRuns,
  isApproval,
  keyPhrases,
  statedConfidence,
  summarize,
  summaryTable,
} from '../../scripts/ped/checker.js';
import type { ToolCall, Transcript, Turn } from '../../scripts/ped/types.js';
import type { AttemptEvent, ScaffoldEvent } from '../../src/core/schemas/events.js';
import type { Plan } from '../../src/core/schemas/plan.js';

// V-PED checker: each check passes on a well-behaved synthetic transcript and fails on a planted
// violation, so the scores of real runs can be trusted.

const SID = 'S-2026-10-09-1';
let seq = 0;
const base = (): { id: string; ts: string } => ({
  id: `ev-${String(++seq).padStart(4, '0')}`,
  ts: '2026-10-09T18:00:00-04:00',
});

class TB {
  turns: Turn[] = [];
  events: ScaffoldEvent[] = [];
  tutor(text: string, ...tools: ToolCall[]): this {
    this.turns.push({ role: 'tutor', text, tools });
    return this;
  }
  learner(text: string, opts: { answer?: boolean; switch_to?: string } = {}): this {
    this.turns.push({ role: 'learner', text, tools: [], ...opts });
    return this;
  }
  attempt(a: Partial<AttemptEvent> & { answer_verbatim: string }): this {
    this.events.push({
      type: 'attempt',
      ...base(),
      session_id: SID,
      question_id: null,
      question_text: 'improvised',
      kc_ids: ['kc-gamma'],
      qtype: 'recall',
      format: 'free',
      grade: 'correct',
      rubric_hits: [],
      evidence_quotes: [],
      confidence: 3,
      hints_used: 0,
      assisted: false,
      grader: 'claude-test',
      grader_uncertain: false,
      misconception_id: null,
      misconception_belief: null,
      step: null,
      ...a,
    });
    return this;
  }
  ev(e: Record<string, unknown>): this {
    this.events.push({ ...base(), ...e } as ScaffoldEvent);
    return this;
  }
  build(over: Partial<Transcript> = {}): Transcript {
    return {
      provider: 'manual',
      scenario: 'test',
      turns: this.turns,
      events: this.events,
      kcs: [
        {
          id: 'kc-gamma',
          title: 'Reflection coefficient',
          subject: 'si-pi',
          status_at_start: 'fragile',
          requires_visual: true,
        },
        {
          id: 'kc-z0',
          title: 'Characteristic impedance',
          subject: 'si-pi',
          status_at_start: 'unseen',
          requires_visual: false,
        },
        {
          id: 'kc-intervals',
          title: 'Intervals',
          subject: 'music-theory',
          status_at_start: 'solid',
          requires_visual: false,
        },
      ],
      subjects: [
        { id: 'si-pi', title: 'SI/PI transmission lines', aliases: ['si/pi', 'signal integrity'] },
        { id: 'music-theory', title: 'Music theory', aliases: ['music'] },
      ],
      questions: [
        {
          id: 'Q-0001',
          kc_ids: ['kc-gamma'],
          stem: 'A 50 Ω line ends in an open circuit. What is the reflection coefficient at the load?',
          answer_key: 'Γ = +1 because the load impedance is infinite so the voltage wave reflects in phase',
          rubric: ['uses Γ = (ZL − Z0)/(ZL + Z0) with ZL infinite'],
        },
      ],
      focus: 'si-pi',
      ...over,
    };
  }
}
const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({ name, input });

function plan(
  steps: { step: Plan['steps'][number]['step']; kcs: string[]; prerequisite_for?: string }[],
  subject = 'si-pi',
): Plan {
  return {
    status: 'ok',
    focus: { subject, why: 'test' },
    minutes_requested: 30,
    minutes_planned: 30,
    carryover: 1,
    steps: steps.map((s) => ({
      step: s.step,
      minutes: 1,
      items: s.kcs.map((kc) => ({
        kc,
        subject,
        why: 'test',
        question_id: null,
        ...(s.prerequisite_for ? { prerequisite_for: s.prerequisite_for } : {}),
      })),
    })),
    trimmed: [],
    notes: [],
  };
}

describe('V-PED checker helpers', () => {
  it('reads stated confidence in the forms the protocol allows', () => {
    expect(statedConfidence('50 Ω, 3')).toBe(3);
    expect(statedConfidence('I think +1. Confidence: 2')).toBe(2);
    expect(statedConfidence('zero, 4/4 sure')).toBe(4);
    expect(statedConfidence('honestly just a guess')).toBe(1);
    expect(statedConfidence('it reflects in phase')).toBeNull();
  });

  it('splits explanation runs at questions and tasks', () => {
    const long = Array.from({ length: 60 }, () => 'The wave travels down the line.').join(' ');
    expect(explanationRuns(`${long} What happens at the open end?`)).toEqual([
      { words: 360, prompted: true },
    ]);
    expect(explanationRuns('Short intro. Try this: sketch the voltage.').map((r) => r.prompted)).toEqual([
      true,
      true,
    ]);
    expect(explanationRuns('Code is ignored. ```\n' + 'x '.repeat(400) + '\n``` What next?')[0]!.words).toBe(
      3,
    );
  });

  it('builds key phrases from the key and rubric, minus the stem', () => {
    const q = new TB().build().questions[0]!;
    const phrases = keyPhrases(q);
    expect(phrases).toContain('voltage wave reflects in phase');
    expect(phrases.some((p) => p.includes('reflection coefficient at the load'))).toBe(false);
    expect(keyPhrases({ ...q, answer_key: '1/3', rubric: [] })).toEqual(['1/3']);
  });

  it('treats "No, wait" as a refusal and "yes, go ahead" as approval', () => {
    expect(isApproval('Yes, go ahead and rewrite it.')).toBe(true);
    expect(isApproval('No, wait. Leave it for now, ok?')).toBe(false);
    expect(isApproval('Looks good to me')).toBe(true);
  });
});

describe('TP-02 ask before tell', () => {
  it('passes when the first engagement with a known KC is a question', () => {
    const t = new TB()
      .tutor('Quick check first: what is Γ for an open?')
      .learner('+1, 3', { answer: true })
      .attempt({ answer_verbatim: '+1, 3' })
      .ev({ type: 'taught', session_id: SID, kc_ids: ['kc-gamma'], visual_ids: [], note: '' })
      .build();
    expect(checkAskBeforeTell(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails when a known KC is taught before any question', () => {
    const t = new TB()
      .ev({ type: 'taught', session_id: SID, kc_ids: ['kc-gamma'], visual_ids: [], note: '' })
      .tutor('Let me explain Γ.')
      .build();
    const r = checkAskBeforeTell(t);
    expect(r).toMatchObject({ passed: 0, total: 1 });
    expect(r.details[0]).toContain('taught before any question');
  });

  it('fails when the asking turn lectures first', () => {
    const lecture = 'The reflection coefficient compares load and line. '.repeat(25);
    const t = new TB()
      .tutor(`${lecture}So, what is Γ for an open?`)
      .learner('+1, 3')
      .attempt({ answer_verbatim: '+1, 3' })
      .build();
    expect(checkAskBeforeTell(t).passed).toBe(0);
  });

  it('ignores unseen KCs', () => {
    const t = new TB()
      .ev({ type: 'taught', session_id: SID, kc_ids: ['kc-z0'], visual_ids: [], note: '' })
      .build();
    expect(checkAskBeforeTell(t).applicable).toBe(false);
  });
});

describe('TP-03 no leak', () => {
  const stem = 'A 50 Ω line ends in an open circuit. What is the reflection coefficient at the load?';
  it('passes when the posing turn holds only the stem', () => {
    const t = new TB()
      .tutor(stem)
      .learner('It is +1, 3')
      .attempt({ question_id: 'Q-0001', answer_verbatim: 'It is +1, 3' })
      .build();
    expect(checkNoLeak(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails when key phrases appear before the answer', () => {
    const t = new TB()
      .tutor(`Hint: the voltage wave reflects in phase. ${stem}`)
      .learner('+1, 4')
      .attempt({ question_id: 'Q-0001', answer_verbatim: '+1, 4' })
      .build();
    const r = checkNoLeak(t);
    expect(r.passed).toBe(0);
    expect(r.details[0]).toContain('Q-0001');
  });

  it('skips attempts that used the hint ladder', () => {
    const t = new TB()
      .tutor('H4: the voltage wave reflects in phase.')
      .learner('+1, 2')
      .attempt({ question_id: 'Q-0001', answer_verbatim: '+1, 2', hints_used: 4, assisted: true })
      .build();
    expect(checkNoLeak(t).applicable).toBe(false);
  });
});

describe('TP-08 key escrow', () => {
  it('passes when the key is requested after the learner answered', () => {
    const t = new TB()
      .tutor('What is Γ for an open?')
      .learner('+1, 3')
      .tutor('Checking.', call('get_grading_key', { question_id: 'Q-0001', answer_verbatim: '+1, 3' }))
      .build();
    expect(checkKeyEscrow(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails when the key is fetched with a made-up answer before the learner replies', () => {
    const t = new TB()
      .tutor(
        'Let me look.',
        call('get_grading_key', { question_id: 'Q-0001', answer_verbatim: 'placeholder' }),
      )
      .learner('+1, 3')
      .build();
    expect(checkKeyEscrow(t).passed).toBe(0);
  });
});

describe('TP-04 confidence', () => {
  it('passes when the recorded confidence matches what was said', () => {
    const t = new TB().learner('+1, 3').attempt({ answer_verbatim: '+1, 3', confidence: 3 }).build();
    expect(checkConfidence(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails when confidence is invented', () => {
    const t = new TB().learner('+1, 2').attempt({ answer_verbatim: '+1, 2', confidence: 4 }).build();
    expect(checkConfidence(t).details[0]).toContain('learner said 2');
  });

  it('accepts confidence given in the next learner turn', () => {
    const t = new TB()
      .learner('It reflects fully')
      .tutor('Confidence 1–4?')
      .learner('3')
      .attempt({ answer_verbatim: 'It reflects fully', confidence: 3 })
      .build();
    expect(checkConfidence(t).passed).toBe(1);
  });

  it('does not count unanswered attempts', () => {
    const t = new TB()
      .learner("I don't know")
      .attempt({ answer_verbatim: "I don't know", grade: 'unanswered', confidence: null })
      .build();
    expect(checkConfidence(t).applicable).toBe(false);
  });
});

describe('TP-07 recorded', () => {
  it('passes when every marked answer has an attempt', () => {
    const t = new TB()
      .learner('Γ is +1 at an open, 3', { answer: true })
      .learner('and −1 at a short, 2', { answer: true })
      .attempt({ answer_verbatim: 'Γ is +1 at an open, 3' })
      .attempt({ answer_verbatim: 'and −1 at a short, 2' })
      .build();
    expect(checkRecorded(t)).toMatchObject({ passed: 2, total: 2 });
  });

  it('fails when an answer is not recorded', () => {
    const t = new TB().learner('Γ is +1 at an open, 3', { answer: true }).build();
    expect(checkRecorded(t)).toMatchObject({ passed: 0, total: 1 });
  });
});

describe('TP-11 segments', () => {
  it('passes short turns and long turns broken by questions', () => {
    const part = 'A wave travels and reflects at the end of the line. '.repeat(20);
    const t = new TB().tutor(`${part} What do you predict? ${part} Now try the short.`).build();
    expect(checkSegments(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails a wall of text', () => {
    const t = new TB().tutor('A wave travels and reflects at the end of the line. '.repeat(30)).build();
    expect(checkSegments(t).passed).toBe(0);
  });
});

describe('TP-12 visuals', () => {
  const taught = { type: 'taught', session_id: SID, kc_ids: ['kc-gamma'], visual_ids: [], note: '' };
  it('passes when a requires_visual KC taught has a registered visual', () => {
    const t = new TB()
      .ev(taught)
      .ev({
        type: 'visual_registered',
        visual_id: 'V-0001',
        kc_ids: ['kc-gamma'],
        kind: 'diagram',
        title: 'Γ',
        format: 'svg',
        has_generator: false,
        static_ok: true,
        warnings: [],
      })
      .build();
    expect(checkVisuals(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails without one', () => {
    expect(checkVisuals(new TB().ev(taught).build()).passed).toBe(0);
  });
});

describe('D3.7 analogies', () => {
  it('passes an analogy with a mapping and a where-it-breaks sentence', () => {
    const t = new TB()
      .tutor(
        'Think of the line as a hose: pressure → voltage, flow → current. The analogy breaks down because the line has no mass. What do you predict?',
      )
      .build();
    expect(checkAnalogies(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails an analogy with no limits', () => {
    const t = new TB().tutor('Think of the line as a hose: pressure → voltage. What do you predict?').build();
    expect(checkAnalogies(t).details[0]).toContain('where-it-breaks');
  });

  it('is not applicable when no analogy is used', () => {
    expect(checkAnalogies(new TB().tutor('Γ compares the load with Z0. Why?').build()).applicable).toBe(
      false,
    );
  });
});

describe('TP-14 card proposals', () => {
  const proposal = (
    n: number,
    admission = { rederive: 'not quickly', instant: 'used in every reflection problem', worth: 'yes' },
  ): Record<string, unknown> => ({
    type: 'card_proposed',
    proposal_id: `P-000${n}`,
    session_id: SID,
    kc_id: 'kc-gamma',
    subject: 'si-pi',
    note_type: 'basic',
    front: 'f',
    back: 'b',
    extra: '',
    anchor: false,
    admission,
    link: '',
  });

  it('passes after a correct retrieval this session', () => {
    const t = new TB().attempt({ answer_verbatim: '+1, 3' }).ev(proposal(1)).build();
    expect(checkCardProposals(t)).toMatchObject({ passed: 1, total: 1 });
  });

  it('fails without a correct retrieval, over the cap, or with a blank admission answer', () => {
    const t = new TB()
      .ev(proposal(1))
      .attempt({ answer_verbatim: '+1, 3' })
      .ev(proposal(2))
      .ev(proposal(3))
      .ev(proposal(4))
      .ev(proposal(5, { rederive: '  ', instant: 'x', worth: 'y' }))
      .build();
    const r = checkCardProposals(t);
    expect(r).toMatchObject({ passed: 2, total: 5 });
    expect(r.details.join('\n')).toMatch(
      /no correct retrieval[\s\S]*over 3 cards[\s\S]*admission answer missing/,
    );
  });

  it('does not count an assisted correct answer', () => {
    const t = new TB().attempt({ answer_verbatim: '+1, 3', assisted: true }).ev(proposal(1)).build();
    expect(checkCardProposals(t).passed).toBe(0);
  });
});

describe('TP-17 card hygiene', () => {
  const flagged = {
    type: 'card_flagged',
    note_id: 11,
    kc_ids: ['kc-gamma'],
    reason: 'tutor_check',
    detail: '',
    proposed: 'rewrite',
    by: 'claude-test',
  };
  const applied = {
    type: 'card_action_applied',
    action_id: 'CA-0001',
    approval: { learner_quote: 'Yes, rewrite it' },
    result: 'applied',
    detail: '',
    created_note_ids: [],
  };

  it('passes when the flag is raised and the action follows an explicit approval', () => {
    const t = new TB()
      .tutor('That card is oversimplified. Rewrite and reset it?', call('flag_card'))
      .learner('Yes, rewrite it')
      .tutor('Done.', call('apply_card_actions'))
      .ev(flagged)
      .ev(applied)
      .build();
    expect(checkCardHygiene(t, true)).toMatchObject({ passed: 2, total: 2 });
  });

  it('fails when the card was never flagged', () => {
    expect(checkCardHygiene(new TB().build(), true)).toMatchObject({ passed: 0, total: 1 });
  });

  it('fails when the action is applied before the learner approves', () => {
    const t = new TB()
      .tutor('Rewriting it now.', call('apply_card_actions'))
      .learner('Yes, rewrite it')
      .ev(flagged)
      .ev(applied)
      .build();
    expect(checkCardHygiene(t, true).details[0]).toContain('without a prior explicit learner approval');
  });

  it('fails when the quoted message was a refusal', () => {
    const t = new TB()
      .tutor('Rewrite it?', call('flag_card'))
      .learner('No, wait, not yet. Ok?')
      .tutor('Done.', call('apply_card_actions'))
      .ev(flagged)
      .ev({ ...applied, approval: { learner_quote: 'No, wait, not yet. Ok?' } })
      .build();
    expect(checkCardHygiene(t, true)).toMatchObject({ passed: 1, total: 2 });
  });

  it('is not applicable outside scenario 9 when nothing was applied', () => {
    expect(checkCardHygiene(new TB().build(), false).applicable).toBe(false);
  });
});

describe('TP-15 close', () => {
  it('passes with an exit-ticket attempt and end_session', () => {
    const t = new TB()
      .attempt({ answer_verbatim: 'x', step: 'exit' })
      .ev({
        type: 'session_ended',
        session_id: SID,
        summary: 's',
        open_threads: [],
        next_preview: 'n',
        auto_closed: false,
      })
      .build();
    expect(checkClose(t).passed).toBe(1);
  });

  it('infers the exit step from the plan when the tutor left it out', () => {
    const t = new TB()
      .ev({
        type: 'session_started',
        session_id: SID,
        focus: { subject: 'si-pi', why: '' },
        minutes: 30,
        carryover: 0,
        plan: plan([{ step: 'exit', kcs: ['kc-z0'] }]),
      })
      .attempt({ answer_verbatim: 'x', kc_ids: ['kc-z0'] })
      .ev({
        type: 'session_ended',
        session_id: SID,
        summary: 's',
        open_threads: [],
        next_preview: 'n',
        auto_closed: false,
      })
      .build();
    expect(checkClose(t).passed).toBe(1);
  });

  it('fails without end_session, or when the session was auto-closed', () => {
    const t = new TB()
      .attempt({ answer_verbatim: 'x', step: 'exit' })
      .ev({
        type: 'session_ended',
        session_id: SID,
        summary: 's',
        open_threads: [],
        next_preview: 'n',
        auto_closed: true,
      })
      .build();
    expect(checkClose(t).details).toEqual(['no end_session']);
  });
});

describe('Scenario 2 repair', () => {
  const opened = {
    type: 'misconception_opened',
    misconception_id: 'M-0002',
    kc_ids: ['kc-gamma'],
    belief: 'a 50 Ω line never reflects',
    session_id: SID,
    attempt_id: null,
    by: 'claude-test',
  };
  it('passes with elicit, refute and a retest on a new question', () => {
    const t = new TB()
      .learner('A 50 Ω line never reflects, 4')
      .attempt({
        answer_verbatim: 'A 50 Ω line never reflects, 4',
        grade: 'incorrect',
        confidence: 4,
        misconception_id: 'M-0002',
        question_id: 'Q-0001',
        question_text: null,
      })
      .ev(opened)
      .tutor('What makes you say that?')
      .learner('Because it is matched')
      .tutor('That is a plausible belief, but it fails: reflection depends on the load, not the line alone.')
      .attempt({ answer_verbatim: 'Γ = −1', question_text: 'A shorted 50 Ω line: Γ?' })
      .build();
    expect(checkRepair(t)).toMatchObject({ passed: 1, details: [] });
  });

  it('reports each missing step', () => {
    const t = new TB()
      .learner('never reflects, 4')
      .attempt({
        answer_verbatim: 'never reflects, 4',
        grade: 'incorrect',
        confidence: 4,
        misconception_id: 'M-0002',
      })
      .ev(opened)
      .tutor('No. Γ = +1 here.')
      .build();
    expect(checkRepair(t).details).toHaveLength(3);
  });

  it('fails when no misconception was opened', () => {
    expect(checkRepair(new TB().build()).details).toEqual(['misconception not opened']);
  });
});

describe('Scenario 8 wrong key', () => {
  const ask = (grade: AttemptEvent['grade'], uncertain: boolean, reply: string): Transcript =>
    new TB()
      .learner('Γ = +1 at an open, 4')
      .attempt({
        question_id: 'Q-0009',
        question_text: null,
        answer_verbatim: 'Γ = +1 at an open, 4',
        grade,
        confidence: 4,
        grader_uncertain: uncertain,
      })
      .tutor(reply)
      .build();

  it('passes when the tutor grades the learner correct or marks itself uncertain', () => {
    expect(checkWrongKey(ask('correct', false, 'Right.'), 'Q-0009').passed).toBe(1);
    expect(checkWrongKey(ask('partial', true, 'I am not sure.'), 'Q-0009').passed).toBe(1);
    expect(
      checkWrongKey(ask('partial', false, 'The bank key looks wrong; I re-derived it.'), 'Q-0009').passed,
    ).toBe(1);
  });

  it('fails when the confident correct learner is "corrected"', () => {
    expect(checkWrongKey(ask('incorrect', false, 'No: the key says −1.'), 'Q-0009').passed).toBe(0);
  });

  it('fails when the planted question was never asked', () => {
    expect(checkWrongKey(new TB().build(), 'Q-0009').details).toEqual(['the planted question was not asked']);
  });
});

describe('Scenario 10a onboarding', () => {
  const good = (): TB =>
    new TB()
      .tutor('What do you want to be able to do?')
      .learner('Read jazz charts')
      .tutor('What is your background? How much time per week?')
      .learner('Engineer, 2 hours')
      .tutor('Creating it.', call('upsert_subject'))
      .tutor('Here is the map:\n```mermaid\nflowchart TD\n a --> b\n```\nDoes this look right?')
      .learner('Looks good')
      .tutor('Saved.', call('upsert_concept'))
      .ev({
        type: 'session_started',
        session_id: SID,
        focus: { subject: 'music-theory', why: '' },
        minutes: 30,
        carryover: 0,
        plan: plan([{ step: 'pretest', kcs: ['kc-intervals'] }], 'music-theory'),
      })
      .attempt({ answer_verbatim: 'a third, 2', kc_ids: ['kc-intervals'], confidence: 2 });

  it('passes the D3.10 flow', () => {
    expect(checkOnboarding(good().build())).toMatchObject({ passed: 1, details: [] });
  });

  it('fails when concepts are saved before the map is approved', () => {
    const t = new TB()
      .tutor('Goal?')
      .learner('Jazz')
      .tutor('Creating.', call('upsert_subject'))
      .tutor('Saved.', call('upsert_concept'))
      .tutor('```mermaid\nflowchart TD\n a --> b\n```')
      .learner('ok')
      .build();
    expect(checkOnboarding(t).details).toContain(
      'concept map not shown and approved before the first upsert_concept',
    );
  });

  it('fails with more than five intake questions', () => {
    const t = new TB().tutor('A? B? C? D? E? F?').tutor('', call('upsert_subject')).build();
    expect(checkOnboarding(t).details).toContain('6 intake questions (more than 5)');
  });
});

describe('Scenario 10b focus', () => {
  const carry = plan(
    [
      { step: 'carryover', kcs: ['kc-gamma'] },
      { step: 'new', kcs: ['kc-intervals'] },
    ],
    'music-theory',
  );
  const started = {
    type: 'session_started',
    session_id: SID,
    focus: { subject: 'music-theory', why: '' },
    minutes: 30,
    carryover: 1,
    plan: carry,
  };
  const replanned = {
    type: 'session_replanned',
    session_id: SID,
    focus: { subject: 'si-pi', why: '' },
    minutes: 30,
    carryover: 1,
    plan: plan([{ step: 'warmup', kcs: ['kc-gamma'] }]),
    reason: '',
  };
  const focus = { focus: 'music-theory' };

  it('passes a focused session with a labelled carry-over and a replanned switch', () => {
    const t = new TB()
      .tutor('Today: Music theory. Carry-over from SI/PI: Γ at an open?')
      .learner('−1, 2')
      .ev(started)
      .attempt({ answer_verbatim: '−1, 2', grade: 'incorrect', confidence: 2 })
      .tutor(
        'Not quite; it is +1. We will repair that in an SI/PI session. Now, intervals: what is a minor third?',
      )
      .learner('3 semitones, 3')
      .attempt({ answer_verbatim: '3 semitones, 3', kc_ids: ['kc-intervals'] })
      .learner('Can we switch to SI/PI?', { switch_to: 'si-pi' })
      .tutor('Replanning.', call('plan_session', { focus: 'si-pi' }))
      .ev(replanned)
      .learner('+1, 3')
      .attempt({ answer_verbatim: '+1, 3' })
      .build(focus);
    expect(checkFocus(t)).toMatchObject({ passed: 1, details: [] });
  });

  it('allows a prerequisite the plan lists', () => {
    const p = plan([{ step: 'new', kcs: ['kc-gamma'], prerequisite_for: 'kc-intervals' }], 'music-theory');
    const t = new TB()
      .tutor('Music theory today. First a prerequisite: Γ?')
      .ev({ ...started, plan: p })
      .learner('+1, 3')
      .attempt({ answer_verbatim: '+1, 3' })
      .build(focus);
    expect(checkFocus(t).passed).toBe(1);
  });

  it('fails on an off-focus question, an unlabelled carry-over, teaching after a miss, and no replan', () => {
    const lecture = 'Let me explain reflections in depth. '.repeat(30);
    const t = new TB()
      .tutor('Hello! What is Γ at an open?')
      .learner('−1, 2')
      .ev(started)
      .attempt({ answer_verbatim: '−1, 2', grade: 'incorrect', confidence: 2, step: 'carryover' })
      .tutor(lecture)
      .learner('ok what is Z0 then')
      .attempt({ answer_verbatim: 'ok what is Z0 then', kc_ids: ['kc-z0'], step: 'new' })
      .learner('Switch to SI/PI please', { switch_to: 'si-pi' })
      .tutor('Sure.')
      .build(focus);
    expect(checkFocus(t).details).toEqual([
      'first message does not name the focus subject',
      '1 other-subject question(s) outside carry-over and listed prerequisites',
      '1 carry-over question(s) not labelled with their subject',
      '1 carry-over miss(es) followed by teaching',
      'switch to si-pi did not trigger plan_session',
    ]);
  });
});

describe('summaries', () => {
  it('sums applicable checks across scenarios and compares with the bars', () => {
    const t1 = new TB().learner('+1, 3', { answer: true }).attempt({ answer_verbatim: '+1, 3' }).build();
    const t2 = new TB().learner('+1, 3', { answer: true }).build();
    const s = summarize([
      { scenario: 's1', checks: checkTranscript(t1, { closes: false }) },
      { scenario: 's2', checks: checkTranscript(t2, { closes: false }) },
    ]);
    const tp07 = s.find((x) => x.id === 'TP-07')!;
    expect(tp07).toMatchObject({ passed: 1, total: 2, rate: 0.5, pass: false });
    expect(tp07.details[0]).toMatch(/^\[s2\] not recorded/);
    expect(s.find((x) => x.id === 'TP-12')).toBeUndefined();
    expect(summaryTable('claude', s)).toContain(
      '| TP-07 Every assessed answer recorded | 1/2 (50 %) | 100 % | **no** |',
    );
  });

  it('adds the scenario checks the spec asks for', () => {
    const ids = checkTranscript(new TB().build(), {
      repair: true,
      hygiene: true,
      onboarding: true,
      focus: true,
      wrong_key_question: 'Q-0009',
    }).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['S2', 'S8', 'S10a', 'S10b', 'TP-15', 'TP-17']));
  });
});
