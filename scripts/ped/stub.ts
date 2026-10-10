import { callTool } from '../../src/core/api/tools.js';
import type { NextItem } from '../../src/core/service/ops/questions.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { systemClock, systemTimeZone } from '../../src/core/time.js';
import { statedConfidence } from './checker.js';
import type { Provider, TurnResult } from './drivers.js';
import { WRAP_UP } from './learner.js';
import type { ToolCall } from './types.js';

// A deterministic stand-in tutor for testing the V-PED harness without any model: it starts the
// session, asks plan questions one at a time, records each answer, fetches keys only after answers,
// and closes with an exit ticket. It is not a model of good tutoring; it exercises the loop.

interface Started {
  briefing: { focus: { subject: string }; plan: { step: string }[] };
}
interface Next {
  items: NextItem[];
}

export class StubProvider implements Provider {
  readonly name = 'stub' as const;
  private queue: NextItem[] = [];
  private asked: NextItem | null = null;
  private exit = false;
  private ended = false;
  constructor(
    private readonly vault: string,
    private readonly focus: string,
  ) {}

  private async call<T = unknown>(
    tools: ToolCall[],
    name: string,
    input: Record<string, unknown>,
  ): Promise<T> {
    const sc = Scaffold.open(this.vault, { clock: systemClock, timezone: systemTimeZone() });
    const r = await callTool(sc, name, input);
    tools.push({ name, input, ok: r.ok });
    if (!r.ok) throw new Error(`${name}: ${r.errors.map((e) => e.message).join('; ')}`);
    return r.data as T;
  }

  private ask(item: NextItem): string {
    this.asked = item;
    const stem =
      item.question?.stem ?? `In one or two sentences: what do you remember about ${item.kc_title}?`;
    return `${stem}\n\nAdd your confidence from 1 to 4.`;
  }

  async turn(message: string): Promise<TurnResult> {
    const tools: ToolCall[] = [];
    try {
      if (this.ended) return { text: 'The session is closed. See you next time.', tools, session: 'stub' };
      const parts: string[] = [];
      if (!this.asked && this.queue.length === 0 && !this.exit) {
        const minutes = Number(/(\d+)[- ]minute/.exec(message)?.[1] ?? 10);
        const started = await this.call<Started>(tools, 'start_session', { focus: this.focus, minutes });
        parts.push(`Today: ${started.briefing.focus.subject}.`);
        for (const step of started.briefing.plan) {
          if (step.step === 'exit') continue;
          const next = await this.call<Next>(tools, 'next_questions', { step: step.step });
          this.queue.push(...next.items);
        }
      } else if (this.asked) {
        const item = this.asked;
        this.asked = null;
        const unanswered = /\bdon'?t know\b/i.test(message);
        if (item.question && !unanswered)
          await this.call(tools, 'get_grading_key', {
            question_id: item.question.id,
            answer_verbatim: message,
          });
        await this.call(tools, 'record_attempt', {
          ...(item.question
            ? { question_id: item.question.id }
            : {
                question_text: `${this.exit ? 'Exit ticket: ' : ''}What do you remember about ${item.kc_title}?`,
                kc_ids: [item.kc],
                qtype: 'recall',
                format: 'free',
              }),
          answer_verbatim: message,
          ...(unanswered
            ? {}
            : {
                grade: 'partial',
                confidence: statedConfidence(message) ?? 2,
                rubric_hits: item.question ? ['R1'] : [],
                evidence_quotes: [message.slice(0, 60)],
              }),
          grader: 'stub-tutor',
          step: this.exit ? 'exit' : (item.step ?? 'other'),
        });
        parts.push(unanswered ? 'That is fine; it is recorded as not yet known.' : 'Recorded.');
        if (this.exit) {
          await this.call(tools, 'end_session', {
            summary: 'Stub session for the V-PED harness test.',
            open_threads: [],
            next_preview: 'More of the same.',
          });
          this.ended = true;
          return {
            text: `${parts.join(' ')} Session closed. Next time: more practice.`,
            tools,
            session: 'stub',
          };
        }
      }
      if (message.includes(WRAP_UP.slice(0, 20)) || this.queue.length === 0) {
        this.exit = true;
        const exit = await this.call<Next>(tools, 'next_questions', { step: 'exit', limit: 1 });
        const item = exit.items[0] ?? this.queue[0];
        if (item) parts.push(`Exit ticket. ${this.ask(item)}`);
        return { text: parts.join('\n\n'), tools, session: 'stub' };
      }
      parts.push(this.ask(this.queue.shift()!));
      return { text: parts.join('\n\n'), tools, session: 'stub' };
    } catch (e) {
      return { text: '', tools, session: 'stub', error: (e as Error).message };
    }
  }
}
