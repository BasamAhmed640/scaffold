import type { Plan } from '../../src/core/schemas/plan.js';

export function emptyPlanFor(subject: string): Plan {
  return {
    status: 'ok',
    focus: { subject, why: 'test' },
    minutes_requested: 30,
    minutes_planned: 0,
    carryover: 2,
    steps: [],
    trimmed: [],
    notes: [],
  };
}
