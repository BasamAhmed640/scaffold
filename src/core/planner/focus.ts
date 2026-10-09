import { ScaffoldError } from '../envelope.js';
import type { LearnerFacts, SessionFacts } from '../model/facts.js';
import type { SubjectFields } from '../schemas/subject.js';
import { ms } from '../time.js';
import { cmp, compareKeys } from '../util.js';

// LM-15: every session has exactly one focus, a subject or `all`, resolved deterministically.

export interface FocusResult {
  subject: string; // subject id or 'all'
  why: string;
}

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchSubject(subjects: SubjectFields[], name: string): SubjectFields | null {
  const n = normalizeName(name);
  return (
    subjects.find(
      (s) =>
        normalizeName(s.id) === n ||
        normalizeName(s.title) === n ||
        s.aliases.some((a) => normalizeName(a) === n),
    ) ?? null
  );
}

/** Most recent focus entry (excluding mixed review days). */
export function lastFocusedSubject(facts: LearnerFacts): { subject: string; ts: string } | null {
  const entries = Object.values(facts.sessions)
    .flatMap((s) => s.focus_history)
    .filter((f) => f.subject !== 'all')
    .sort((a, b) => compareKeys([ms(b.ts), b.subject], [ms(a.ts), a.subject]));
  const top = entries[0];
  return top ? { subject: top.subject, ts: top.ts } : null;
}

/** The most recent session whose focus was `subject` at any point (carry-over checks don't count). */
export function lastSessionOn(
  facts: LearnerFacts,
  subject: string,
  opts: { endedOnly?: boolean } = {},
): SessionFacts | null {
  const list = Object.values(facts.sessions)
    .filter((s) => !(opts.endedOnly && !s.ended_ts) && s.focus_history.some((f) => f.subject === subject))
    .sort((a, b) => compareKeys([ms(b.started_ts), b.id], [ms(a.started_ts), a.id]));
  return list[0] ?? null;
}

export function resolveFocus(
  subjects: SubjectFields[],
  facts: LearnerFacts,
  dueBySubject: Record<string, number>,
  requested?: string | null,
): FocusResult {
  const active = subjects.filter((s) => s.scope === 'active').sort((a, b) => cmp(a.id, b.id));
  const dueOf = (id: string): number => dueBySubject[id] ?? 0;
  if (requested && requested.trim() !== '') {
    if (normalizeName(requested) === 'all') {
      if (active.length === 0) throw noActive(subjects);
      return { subject: 'all', why: 'mixed review day (named by learner)' };
    }
    const m = matchSubject(subjects, requested);
    if (!m) {
      throw new ScaffoldError(
        'unknown_subject',
        `No subject matches "${requested}".`,
        'Ask the learner once whether to start it as a new subject (onboarding, D3.10); use list_subjects to map loose names.',
      );
    }
    if (m.scope !== 'active') {
      throw new ScaffoldError(
        'subject_not_active',
        `Subject ${m.id} is ${m.scope}.`,
        `Ask the learner once whether to reopen it (set_subject_scope ${m.id} active, ANK-07).`,
      );
    }
    return { subject: m.id, why: 'named by learner' };
  }
  if (active.length === 0) throw noActive(subjects);
  if (active.length === 1) return { subject: active[0]!.id, why: 'only active subject' };
  const last = lastFocusedSubject(facts);
  if (last) {
    const s = active.find((a) => a.id === last.subject);
    if (s) return { subject: s.id, why: `focus of the last session (${last.ts.slice(0, 10)})` };
  }
  const ranked = [...active].sort((a, b) => compareKeys([-dueOf(a.id), a.id], [-dueOf(b.id), b.id]));
  const top = ranked[0]!;
  return { subject: top.id, why: `most due KCs (${dueOf(top.id)})` };
}

function noActive(subjects: SubjectFields[]): ScaffoldError {
  return subjects.length === 0
    ? new ScaffoldError(
        'no_subjects',
        'There are no subjects yet.',
        'Start onboarding for a new subject (D3.10).',
      )
    : new ScaffoldError(
        'no_active_subjects',
        'Every subject is paused or closed.',
        'Ask the learner which subject to reopen (set_subject_scope <id> active) or start a new one (D3.10).',
      );
}
