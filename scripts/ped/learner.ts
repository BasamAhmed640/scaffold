// Scripted learner for V-PED. Replies come from rules matched against the tutor's last question, so
// the script follows the tutor's order without a second model. Answers carry their confidence the way
// TP-04 allows ("50 Ω, 3").

export interface Rule {
  id: string;
  /** Matched against the tutor's last question sentence first, then the whole message. */
  when: RegExp;
  reply: string;
  /** The reply answers an assessed question (scored by TP-07). */
  answer?: boolean;
  /** Use at most once. */
  once?: boolean;
  /** The learner asks to switch subject (scenario 10b). */
  switch_to?: string;
}

export interface LearnerScript {
  opening: string;
  /** Scenario rules, tried before the shared ones. */
  rules: Rule[];
  /** Learner turns before the wrap-up request (opening included). */
  turns: number;
  /** Replies sent on fixed learner turns (1-based, opening = 1), before any rule. */
  at_turn?: Record<number, Omit<Rule, 'when' | 'id'>>;
  /** Turns allowed after the wrap-up request for the exit ticket and end_session. */
  wrap_turns?: number;
}

export const WRAP_UP = 'I need to stop in a couple of minutes, can we wrap up?';
const FALLBACK =
  'Not sure. My best guess is that it depends on what is at the far end of the line. Confidence 2.';

/** Shared persona answers, roughly those of an engineer two weeks into SI/PI. */
export const SHARED_RULES: Rule[] = [
  {
    id: 'approve',
    when: /\b(shall i|should i|ok(ay)? (to|if) i|do you approve|want me to|does (this|that|the map) (look|sound)|look right|good to go|ready to (save|start)|any changes|edit anything|happy with)\b/i,
    reply: 'Looks good, yes, go ahead.',
  },
  {
    id: 'minutes',
    when: /\bhow (much time|long) (do|have|can) you\b|\bhow many minutes\b|\btime (do you have|available)\b/i,
    reply: 'About 15 minutes.',
  },
  {
    id: 'open',
    when: /\bopen(-circuit| circuit| end|ed)?\b.*(Γ|\bgamma|\breflect)|(Γ|\bgamma\b|\breflect\w*).*\bopen\b/i,
    reply: 'Γ = +1 at an open: the full voltage reflects, not inverted. Confidence 3.',
    answer: true,
  },
  {
    id: 'short',
    when: /\bshort(ed)?\b.*(Γ|\bgamma|\breflect)|(Γ|\bgamma\b|\breflect\w*).*\bshort/i,
    reply: 'Γ = −1 at a short, so the reflection is inverted. Confidence 3.',
    answer: true,
  },
  {
    id: 'gamma-75',
    when: /\b75\b.*(Γ|\bgamma|\breflect)|(Γ|\bgamma\b|\breflect\w*).*\b75\b/i,
    reply: 'Γ = (75 − 50)/(75 + 50) = 0.2, so about 20 % comes back. Confidence 3.',
    answer: true,
  },
  {
    id: 'matched',
    when: /\bmatch(ed)?\b|\bterminat\w+ (in|with|into) (a )?(50|z0)/i,
    reply: 'Γ = 0 when the load equals Z0, so nothing reflects. Confidence 4.',
    answer: true,
  },
  {
    id: 'transmitted',
    when: /\btransmi(tted|ssion)\b|\bcontinues into\b|\bT\s*=/i,
    reply: 'T = 1 + Γ, so with Γ = 0.2 the transmitted edge is 1.2 V. Confidence 2.',
    answer: true,
  },
  {
    id: 'gamma',
    when: /Γ|\b(gamma|reflection coefficient|reflect\w*)\b/i,
    reply: 'Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltage that comes back. Confidence 3.',
    answer: true,
  },
  {
    id: 'z0',
    when: /Z₀|\b(Z0|characteristic impedance|ohmmeter)\b/i,
    reply:
      'Z0 is the V/I ratio of a wave travelling on the line, set by L and C per length, not a DC resistance. Confidence 3.',
    answer: true,
  },
  {
    id: 'td',
    when: /\b(propagation delay|TD|how long does .* take|travel time|εr|ns)\b/i,
    reply: 'v = c/√εr = 15 cm/ns, so 30 cm takes 2 ns. Confidence 3.',
    answer: true,
  },
  {
    id: 'instantaneous',
    when: /\binstantaneous impedance|impedance (does|will) the (step|edge|signal) see/i,
    reply:
      'It sees 50 Ω at every point, because a uniform line has the same L and C everywhere. Confidence 3.',
    answer: true,
  },
  {
    id: 'current',
    when: /\bcurrent\b/i,
    reply: 'I = V/Z0, so 1 V into 50 Ω gives 20 mA until a reflection comes back. Confidence 3.',
    answer: true,
  },
  {
    id: 'lattice',
    when: /\b(lattice|bounce)\w*/i,
    reply:
      'You draw time going down and position across, and multiply by Γ at each end every bounce. Confidence 2.',
    answer: true,
  },
  {
    id: 'termination',
    when: /\bterminat\w*\b/i,
    reply:
      'A resistor equal to Z0 at the far end, or a series resistor at the source so the source plus resistor equals Z0. Confidence 3.',
    answer: true,
  },
  {
    id: 'long',
    when: /\belectrically long|rise time\b/i,
    reply:
      'When the rise time is shorter than about twice the delay, the line acts long and reflections matter. Confidence 2.',
    answer: true,
  },
  {
    id: 'interval',
    when: /\b(interval|semitone|fifth|third|fourth)\w*/i,
    reply: 'C up to G is a perfect fifth, 7 semitones. Confidence 3.',
    answer: true,
  },
  {
    id: 'scale',
    when: /\b(major scale|spell|whole|half)\b/i,
    reply: 'W W H W W W H, so D major is D E F♯ G A B C♯ D. Confidence 3.',
    answer: true,
  },
  {
    id: 'triad',
    when: /\b(triad|chord)\w*/i,
    reply: 'A triad is a root, a third and a fifth stacked; C major is C E G. Confidence 2.',
    answer: true,
  },
  { id: 'confidence', when: /\b(confiden\w*|how sure|1\s*[–-]\s*4)\b/i, reply: '3' },
  {
    id: 'teachback',
    when: /\b(teach|explain) (it |this )?back|in your own words|explain .* to (a|someone)/i,
    reply:
      'A wave travels down the line, and at the end part of it comes back. Γ tells you how much comes back. Confidence 3.',
    answer: true,
  },
];

const META = new Set(['approve', 'minutes']);
const TASK = /\b(predict|compute|calculate|explain|estimate|sketch|name|spell|state|write|describe)\b/i;

export class Learner {
  private turn = 0;
  private used = new Set<string>();
  private wrapped = false;
  private afterWrap = 0;
  constructor(private readonly script: LearnerScript) {}

  get done(): boolean {
    return this.wrapped && this.afterWrap > (this.script.wrap_turns ?? 2);
  }

  opening(): { text: string; answer?: boolean; switch_to?: string } {
    this.turn = 1;
    return { text: this.script.opening };
  }

  /**
   * The tutor's last question with the sentence before it ("A line is shorted. What is Γ there?"),
   * or the last two paragraphs when it asks none ("Predict …. \n\n Add your confidence.").
   */
  static lastQuestion(text: string): string {
    const paras = text
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const para = paras.findLast((p) => p.includes('?'));
    if (!para) return paras.slice(-2).join('\n\n');
    const sentences = para.split(/(?<=[.!?])\s+/);
    const i = sentences.findLastIndex((s) => s.includes('?'));
    return sentences.slice(Math.max(0, i - 1), i + 1).join(' ');
  }

  reply(tutorText: string): { text: string; answer?: boolean; switch_to?: string } {
    this.turn += 1;
    if (this.wrapped) this.afterWrap += 1;
    const fixed = this.script.at_turn?.[this.turn];
    if (fixed)
      return {
        text: fixed.reply,
        ...(fixed.answer ? { answer: true } : {}),
        ...(fixed.switch_to ? { switch_to: fixed.switch_to } : {}),
      };
    if (!this.wrapped && this.turn > this.script.turns) {
      this.wrapped = true;
      return { text: WRAP_UP };
    }
    const q = Learner.lastQuestion(tutorText);
    const asks = /\?/.test(tutorText) || TASK.test(q);
    const meta = SHARED_RULES.filter((r) => META.has(r.id));
    const content = SHARED_RULES.filter((r) => !META.has(r.id) && r.id !== 'confidence');
    const confidence = SHARED_RULES.filter((r) => r.id === 'confidence');
    // Approvals and logistics first, then content (the question, then the whole message), and a
    // bare confidence reply only when nothing else matched.
    const passes: [Rule[], string][] = [
      [meta, q],
      [this.script.rules, q],
      [content, q],
      [this.script.rules, tutorText],
      [content, tutorText],
      [confidence, q],
    ];
    for (const [rules, target] of passes) {
      for (const r of rules) {
        if (r.once && this.used.has(r.id)) continue;
        if (!r.when.test(target)) continue;
        this.used.add(r.id);
        return {
          text: r.reply,
          ...(r.answer && asks ? { answer: true } : {}),
          ...(r.switch_to ? { switch_to: r.switch_to } : {}),
        };
      }
    }
    return asks ? { text: FALLBACK, answer: true } : { text: 'OK, go on.' };
  }
}
