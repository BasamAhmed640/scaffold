import type { ScaffoldEvent } from '../../src/core/schemas/events.js';

// V-PED transcript format, normalized from Claude Code stream-json and Codex --json output.

export interface ToolCall {
  name: string; // without the mcp__scaffold__ prefix
  input: Record<string, unknown>;
  ok?: boolean;
}

export interface Turn {
  role: 'learner' | 'tutor';
  text: string;
  tools: ToolCall[];
  /** Learner turns: true when the scenario marks this message as an answer to an assessed question. */
  answer?: boolean;
  /** Learner turns: the learner asks to switch subject (scenario 10b). */
  switch_to?: string;
  /** Tutor turns: number of run events in the log once the turn finished (maps events to turns). */
  events_after?: number;
}

export interface Transcript {
  provider: 'claude' | 'codex' | 'manual';
  scenario: string;
  turns: Turn[];
  /** Events appended during the run (the fixture's events are excluded), in log order. */
  events: ScaffoldEvent[];
  /** KC facts at the start (from the fixture). */
  kcs: { id: string; title: string; subject: string; status_at_start: string; requires_visual: boolean }[];
  subjects: { id: string; title: string; aliases: string[] }[];
  /** Bank questions with their keys (for leak checks). */
  questions: { id: string; kc_ids: string[]; stem: string; answer_key: string; rubric: string[] }[];
  focus: string;
}

export interface CheckResult {
  id: string;
  title: string;
  /** Numerator/denominator for rate checks; pass/fail checks use 1/1 or 0/1. */
  passed: number;
  total: number;
  bar: number; // required rate, e.g. 0.9 or 1
  details: string[];
  applicable: boolean;
}
