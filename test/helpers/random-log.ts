import fc from 'fast-check';
import { LogBuilder } from './builder.js';
import type { Grade, QType } from '../../src/core/schemas/common.js';

// Random but valid multi-subject event logs for property tests.

export interface RandomLogSpec {
  subjects: { id: string; scope: 'active' | 'paused' | 'closed' }[];
  kcs: { id: string; subject: number; prereqs: number[]; confusable: number[] }[];
  ops: Op[];
}

type Op =
  | {
      k: 'attempt';
      kc: number;
      grade: Grade;
      conf: number;
      qtype: QType;
      assisted: boolean;
      mis: number;
      q: number;
    }
  | { k: 'taught'; kc: number }
  | { k: 'advance'; hours: number }
  | { k: 'session'; subject: number }
  | { k: 'lapse'; kc: number; anchor: boolean }
  | { k: 'override'; back: number; grade: Grade }
  | { k: 'duplicate'; back: number }
  | { k: 'scope'; subject: number; to: 'active' | 'paused' | 'closed' }
  | { k: 'open_mis'; kc: number; mis: number };

const grades: Grade[] = ['correct', 'partial', 'incorrect', 'unanswered'];
const qtypes: QType[] = ['recall', 'explain', 'predict', 'apply', 'discriminate', 'transfer', 'teach-back'];
const SUBJECT_IDS = ['si-pi', 'music-theory', 'spanish'];

export const randomLogSpec: fc.Arbitrary<RandomLogSpec> = fc
  .record({
    nSubjects: fc.integer({ min: 1, max: 3 }),
    scopes: fc.array(
      fc.constantFrom('active', 'active', 'paused', 'closed') as fc.Arbitrary<'active' | 'paused' | 'closed'>,
      {
        minLength: 3,
        maxLength: 3,
      },
    ),
    nKcs: fc.integer({ min: 1, max: 8 }),
  })
  .chain(({ nSubjects, scopes, nKcs }) =>
    fc.record({
      subjects: fc.constant(SUBJECT_IDS.slice(0, nSubjects).map((id, i) => ({ id, scope: scopes[i]! }))),
      kcs: fc.tuple(
        ...Array.from({ length: nKcs }, (_, i) =>
          fc.record({
            id: fc.constant(`kc-${i}`),
            subject: fc.integer({ min: 0, max: nSubjects - 1 }),
            prereqs:
              i === 0
                ? fc.constant([] as number[])
                : fc.uniqueArray(fc.integer({ min: 0, max: i - 1 }), { maxLength: 2 }),
            confusable: fc.uniqueArray(fc.integer({ min: 0, max: nKcs - 1 }), { maxLength: 1 }),
          }),
        ),
      ),
      ops: fc.array(
        fc.oneof(
          {
            weight: 6,
            arbitrary: fc.record({
              k: fc.constant('attempt' as const),
              kc: fc.integer({ min: 0, max: nKcs - 1 }),
              grade: fc.constantFrom(...grades),
              conf: fc.integer({ min: 1, max: 4 }),
              qtype: fc.constantFrom(...qtypes),
              assisted: fc.boolean(),
              mis: fc.integer({ min: -2, max: 1 }),
              q: fc.integer({ min: 0, max: 5 }),
            }),
          },
          {
            weight: 2,
            arbitrary: fc.record({
              k: fc.constant('taught' as const),
              kc: fc.integer({ min: 0, max: nKcs - 1 }),
            }),
          },
          {
            weight: 3,
            arbitrary: fc.record({
              k: fc.constant('advance' as const),
              hours: fc.integer({ min: 1, max: 24 * 10 }),
            }),
          },
          {
            weight: 2,
            arbitrary: fc.record({
              k: fc.constant('session' as const),
              subject: fc.integer({ min: 0, max: nSubjects - 1 }),
            }),
          },
          {
            weight: 1,
            arbitrary: fc.record({
              k: fc.constant('lapse' as const),
              kc: fc.integer({ min: 0, max: nKcs - 1 }),
              anchor: fc.boolean(),
            }),
          },
          {
            weight: 1,
            arbitrary: fc.record({
              k: fc.constant('override' as const),
              back: fc.integer({ min: 1, max: 5 }),
              grade: fc.constantFrom(...grades),
            }),
          },
          {
            weight: 1,
            arbitrary: fc.record({
              k: fc.constant('duplicate' as const),
              back: fc.integer({ min: 1, max: 5 }),
            }),
          },
          {
            weight: 1,
            arbitrary: fc.record({
              k: fc.constant('scope' as const),
              subject: fc.integer({ min: 0, max: nSubjects - 1 }),
              to: fc.constantFrom('active', 'paused', 'closed') as fc.Arbitrary<
                'active' | 'paused' | 'closed'
              >,
            }),
          },
          {
            weight: 1,
            arbitrary: fc.record({
              k: fc.constant('open_mis' as const),
              kc: fc.integer({ min: 0, max: nKcs - 1 }),
              mis: fc.integer({ min: 0, max: 1 }),
            }),
          },
        ),
        { maxLength: 40 },
      ),
    }),
  );

/** Materializes a spec into a validated event log. */
export function buildLog(spec: RandomLogSpec, start = '2026-08-01T09:00:00-04:00'): LogBuilder {
  const b = new LogBuilder(start);
  const scopes = new Map<string, string>();
  for (const s of spec.subjects) {
    b.subject(s.id, { scope: s.scope });
    scopes.set(s.id, s.scope);
  }
  for (const k of spec.kcs) {
    b.kc(k.id, spec.subjects[k.subject]!.id, {
      prerequisites: k.prereqs.map((i) => `kc-${i}`),
      confusable_with: k.confusable.filter((i) => `kc-${i}` !== k.id).map((i) => `kc-${i}`),
    });
  }
  let session: string | null = null;
  let sessionN = 0;
  let reviewId = 1;
  for (const op of spec.ops) {
    switch (op.k) {
      case 'advance':
        b.hours(op.hours);
        break;
      case 'session': {
        sessionN += 1;
        session = `S-2026-08-01-${sessionN}`;
        b.session(session, spec.subjects[op.subject]!.id);
        break;
      }
      case 'taught':
        b.taught(`kc-${op.kc}`, session);
        break;
      case 'attempt': {
        const mid = op.mis >= 0 && op.grade !== 'unanswered' ? `M-000${op.mis + 1}` : null;
        b.attempt(`kc-${op.kc}`, op.grade, {
          conf: op.grade === 'unanswered' ? null : op.conf,
          qtype: op.qtype,
          assisted: op.assisted,
          session,
          text: `q${op.q}`,
          mid,
          belief: mid ? `belief ${mid}` : null,
        });
        break;
      }
      case 'lapse': {
        const kc = spec.kcs.find((k) => k.id === `kc-${op.kc}`)!;
        b.push({
          type: 'anki_reviews_imported',
          since: null,
          reviews: [
            {
              review_id: reviewId,
              card_id: 1000 + op.kc,
              note_id: 2000 + op.kc,
              kc_ids: [`kc-${op.kc}`],
              subject: spec.subjects[kc.subject]!.id,
              anchor: op.anchor,
              ease: 1,
              revlog_type: 1,
              ivl: 1,
              last_ivl: 5,
              time_ms: 7000,
              ts: b.ts,
              lapse: true,
            },
          ],
          flags: [],
        });
        reviewId += 1;
        break;
      }
      case 'override': {
        const attempts = b.events.filter((e) => e.type === 'attempt');
        const target = attempts[attempts.length - op.back];
        if (target)
          b.push({
            type: 'grade_overridden',
            attempt_id: target.id,
            grade: op.grade,
            by: 'owner',
            reason: 'test',
          });
        break;
      }
      case 'duplicate': {
        const target = b.events[b.events.length - op.back];
        if (target) b.events.push(target);
        break;
      }
      case 'scope': {
        const sid = spec.subjects[op.subject]!.id;
        const from = scopes.get(sid)!;
        if (from !== op.to) {
          b.scope(sid, from, op.to);
          scopes.set(sid, op.to);
        }
        break;
      }
      case 'open_mis': {
        b.push({
          type: 'misconception_opened',
          misconception_id: `M-000${op.mis + 1}`,
          kc_ids: [`kc-${op.kc}`],
          belief: `belief M-000${op.mis + 1}`,
          session_id: session,
          attempt_id: null,
          by: 'test',
        });
        break;
      }
    }
  }
  return b;
}
