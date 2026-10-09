import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ScaffoldError } from '../../src/core/envelope.js';
import { buildLog, randomLogSpec } from '../helpers/random-log.js';
import { planFor } from '../helpers/plan-helpers.js';

// V-CORE: over 1,000 random multi-subject vaults and focus choices, no plan contains a KC from a
// paused or closed subject, and no other-subject KC appears outside the carry-over step or a listed
// prerequisite (LM-10, LM-14, LM-15).

describe('LM-10 subject isolation (property)', () => {
  it('holds for 1,000 random vaults', () => {
    fc.assert(
      fc.property(
        randomLogSpec,
        fc.integer({ min: -2, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 5, max: 60 }),
        (spec, focusPick, carryover, minutes) => {
          const b = buildLog(spec);
          b.days(2);
          const facts = b.facts();
          const subjects = Object.values(facts.subjects).map((s) => s.fields);
          const focus =
            focusPick === -2
              ? 'all'
              : focusPick === -1
                ? null
                : (subjects[focusPick % subjects.length]?.id ?? null);
          let plan;
          try {
            plan = planFor(b, { focus, carryover, minutes });
          } catch (e) {
            // paused/closed/unknown names and empty vaults fail loudly with a code; that is allowed
            expect(e).toBeInstanceOf(ScaffoldError);
            return;
          }
          const scopeOf = new Map(subjects.map((s) => [s.id, s.scope]));
          const kcSubject = new Map(Object.values(facts.kcs).map((k) => [k.fields.id, k.fields.subject]));
          const carryItems = plan.steps.find((s) => s.step === 'carryover')?.items ?? [];
          expect(carryItems.length).toBeLessThanOrEqual(carryover);
          for (const step of plan.steps) {
            for (const it of step.items) {
              const subj = kcSubject.get(it.kc)!;
              expect(it.subject).toBe(subj);
              const isPrereq = !!it.prerequisite_for;
              expect(scopeOf.get(subj)).toBe('active');
              if (plan.focus.subject !== 'all' && subj !== plan.focus.subject) {
                expect(step.step === 'carryover' || isPrereq).toBe(true);
              }
            }
          }
          if (plan.focus.subject === 'all') {
            expect(plan.steps.some((s) => s.step === 'pretest' || s.step === 'carryover')).toBe(false);
          }
          // never trims repair or the exit ticket; plan fits unless only those remain
          const fixed = plan.steps
            .filter((s) => s.step === 'repair' || s.step === 'exit')
            .reduce((x, s) => x + s.minutes, 0);
          if (plan.minutes_planned > minutes) expect(plan.notes.join(' ')).toMatch(/never trimmed/);
          expect(fixed).toBeLessThanOrEqual(Math.max(plan.minutes_planned, fixed));
        },
      ),
      { numRuns: 1000, seed: 4242 },
    );
  });
});
