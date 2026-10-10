import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { lastSessionOn } from '../../planner/focus.js';
import { backlogCount } from '../../planner/plan.js';
import { KcId, MisconceptionId, SessionId, SubjectId } from '../../schemas/common.js';
import { localDate, ms } from '../../time.js';
import { truncate } from '../../util.js';
import { sectionText } from '../../vault/markers.js';
import { readRegion } from '../../vault/markers.js';
import { conceptRel } from '../../vault/vault.js';
import { loadBank } from '../bank.js';
import type { Scaffold } from '../scaffold.js';
import { syncFromVault } from '../sync.js';
import { refreshNotes } from '../writers.js';

export function listSubjects(sc: Scaffold, _raw: unknown, w: Warnings) {
  syncFromVault(sc, w);
  const facts = sc.facts();
  const derived = sc.derived();
  const cfg = sc.cfg();
  return {
    subjects: Object.values(facts.subjects)
      .map((s) => {
        const kcs = Object.values(derived.kcs).filter((k) => k.subject === s.fields.id);
        const count = (st: string): number => kcs.filter((k) => k.status === st).length;
        const last = lastSessionOn(facts, s.fields.id);
        return {
          id: s.fields.id,
          title: s.fields.title,
          aliases: s.fields.aliases,
          scope: s.fields.scope,
          kcs: kcs.length,
          due: backlogCount(kcs, cfg),
          solid: count('solid'),
          fragile: count('fragile'),
          forgotten: count('forgotten'),
          misconceptions: kcs.filter((k) => k.misconception_active).length,
          last_session: last ? localDate(new Date(ms(last.started_ts)), sc.tz()) : null,
          anki_deck: s.fields.anki_deck ?? null,
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

export const GetConceptInput = z.object({ kc_id: KcId, include_text: z.boolean().default(true) });

export function getConcept(sc: Scaffold, raw: unknown, _w: Warnings) {
  const { kc_id, include_text } = GetConceptInput.parse(raw);
  const facts = sc.facts();
  const kf = facts.kcs[kc_id];
  if (!kf)
    throw new ScaffoldError(
      'unknown_kc',
      `Unknown KC ${kc_id}.`,
      'Use list_subjects / scaffold kc list to find ids.',
    );
  const k = sc.derived().kcs[kc_id]!;
  const attempts = kf.attempt_ids
    .map((id) => facts.attempts[id]!)
    .filter(Boolean)
    .sort((a, b) => ms(a.ts) - ms(b.ts))
    .slice(-5)
    .map((a) => ({
      date: localDate(new Date(ms(a.ts)), sc.tz()),
      qtype: a.qtype,
      grade: a.grade,
      confidence: a.confidence,
      assisted: a.assisted,
    }));
  const out: Record<string, unknown> = {
    ...kf.fields,
    status: k.status,
    misconception_active: k.misconception_active,
    misconceptions: k.misconceptions,
    mastery: k.mastery.summary,
    memory: k.memory
      ? {
          stability_days: k.memory.stability_days,
          retrievability: k.memory.retrievability,
          next_check: localDate(k.memory.next_check, sc.tz()),
        }
      : null,
    needs_check: k.needs_check,
    recent_attempts: attempts,
    questions: loadBank(sc)
      .entries.filter((e) => e.question.kc_ids.includes(kc_id))
      .map((e) => e.question.id),
  };
  if (include_text) {
    const note = sc.vault.readNote(conceptRel(kc_id));
    if (note) {
      out.in_my_words = truncate(readRegion(note.split.body, 'in-my-words') ?? '', 1500);
      out.explanation = truncate(sectionText(note.split.body, 'Explanation') ?? '', 1500);
      out.worked_example = truncate(sectionText(note.split.body, 'Worked example') ?? '', 1500);
    }
  }
  return out;
}

export const ListConceptsInput = z.object({
  subject: SubjectId.optional(),
  status: z.string().max(20).optional(),
});

export function listConcepts(sc: Scaffold, raw: unknown, _w: Warnings) {
  const input = ListConceptsInput.parse(raw ?? {});
  const derived = sc.derived();
  return {
    concepts: Object.values(derived.kcs)
      .filter(
        (k) =>
          (!input.subject || k.subject === input.subject) && (!input.status || k.status === input.status),
      )
      .map((k) => ({
        id: k.id,
        title: k.title,
        subject: k.subject,
        status: k.status,
        misconception_active: k.misconception_active,
        needs_check: k.needs_check,
        R: k.memory ? k.memory.retrievability : null,
        prerequisites: k.prerequisites,
      })),
  };
}

export const ListMisconceptionsInput = z.object({
  subject: SubjectId.optional(),
  state: z.enum(['candidate', 'open', 'resolved', 'all']).default('all'),
});

export function listMisconceptions(sc: Scaffold, raw: unknown, _w: Warnings) {
  const input = ListMisconceptionsInput.parse(raw ?? {});
  const facts = sc.facts();
  const derived = sc.derived();
  return {
    misconceptions: derived.misconceptions
      .filter((m) => input.state === 'all' || m.state === input.state)
      .filter((m) => !input.subject || m.kc_ids.some((k) => facts.kcs[k]?.fields.subject === input.subject))
      .map((m) => ({
        id: m.id,
        belief: m.belief,
        kc_ids: m.kc_ids,
        state: m.state,
        since: m.since?.slice(0, 10) ?? null,
        resolve_progress: m.resolve_progress,
      })),
  };
}

export const OpenMisconceptionInput = z.object({
  kc_ids: z.array(KcId).min(1).max(5),
  belief: z.string().min(5).max(500),
  misconception_id: MisconceptionId.optional(),
  session_id: SessionId.nullish(),
  by: z.string().min(2).max(40),
});

export function openMisconception(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = OpenMisconceptionInput.parse(raw);
  const facts = sc.facts();
  for (const k of input.kc_ids) if (!facts.kcs[k]) throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`);
  const id = input.misconception_id ?? sc.nextId('M');
  sc.emit([
    {
      type: 'misconception_opened',
      misconception_id: id,
      kc_ids: input.kc_ids,
      belief: input.belief,
      session_id: input.session_id ?? sc.openSession()?.id ?? null,
      attempt_id: null,
      by: input.by,
    },
  ]);
  refreshNotes(sc, { kcs: input.kc_ids }, loadBank(sc), w);
  return { misconception_id: id, state: sc.derived().misconceptions.find((m) => m.id === id)?.state };
}
