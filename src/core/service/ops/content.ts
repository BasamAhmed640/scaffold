import { z } from 'zod';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { validateGraph } from '../../model/graph.js';
import { lintQuestion, type LintResult } from '../../questions/lint.js';
import { Slug } from '../../schemas/common.js';
import { DERIVED_KC_KEYS, KcFields } from '../../schemas/kc.js';
import { Question, QuestionInput } from '../../schemas/question.js';
import { AnkiMinutes, DERIVED_SUBJECT_KEYS, deckNameFor, SubjectFields } from '../../schemas/subject.js';
import { addDaysToDate, localDate } from '../../time.js';
import { fillEmptySection } from '../../vault/markers.js';
import { conceptNote, questionNote, subjectNote } from '../../vault/notes.js';
import { conceptRel, questionRel, subjectRel } from '../../vault/vault.js';
import { keyHash, loadBank } from '../bank.js';
import type { EventDraft, Scaffold } from '../scaffold.js';
import { sectionHashes, SourceResolver } from '../sync.js';
import { refreshNotes } from '../writers.js';
import { ensureDeck } from './anki-hooks.js';

// Subjects (LM-14), concepts (LM-01), questions (QB-02). Derived fields are rejected on input.

function rejectDerived(input: Record<string, unknown>, keys: readonly string[], what: string): void {
  const bad = keys.filter((k) => k in input);
  if (bad.length)
    throw new ScaffoldError(
      'derived_field_rejected',
      `${what}: ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} derived and written only by scaffold-core.`,
      'Remove derived fields from the input.',
    );
}

export function slugify(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'subject'
  );
}

export const UpsertSubjectInput = z
  .object({
    id: Slug.optional(),
    title: z.string().min(1).max(120),
    aliases: z.array(z.string().min(1).max(80)).max(20).optional(),
    goals: z.array(z.string().max(500)).max(20).optional(),
    scope: z.enum(['active', 'paused', 'closed']).optional(),
    anki_minutes: AnkiMinutes.optional(),
    anki_deck: z.string().min(1).max(200).optional(),
  })
  .loose();

export function upsertSubject(sc: Scaffold, raw: unknown, w: Warnings) {
  if (raw && typeof raw === 'object')
    rejectDerived(raw as Record<string, unknown>, DERIVED_SUBJECT_KEYS, 'upsert_subject');
  const input = UpsertSubjectInput.parse(raw);
  const id = input.id ?? slugify(input.title);
  const facts = sc.facts();
  const prev = facts.subjects[id];
  if (!prev) {
    const subject = SubjectFields.parse({
      id,
      title: input.title,
      aliases: input.aliases ?? [],
      goals: input.goals ?? [],
      scope: input.scope ?? 'active',
      anki_minutes: input.anki_minutes ?? 'auto',
      anki_deck: input.anki_deck ?? deckNameFor(input.title),
    });
    const rel = subjectRel(id);
    if (!sc.vault.createText(rel, subjectNote(subject)))
      w.add(`${rel} already existed; kept the file and recorded the subject.`);
    sc.emit([{ type: 'subject_created', subject }]);
    const deck = ensureDeck(sc, subject.anki_deck!, w);
    return {
      created: true,
      subject,
      note: rel,
      anki_deck: { name: subject.anki_deck, status: deck },
      reminders: [
        `Set the daily new-card limit of "${subject.anki_deck}" in Anki (deck options → This deck) (ANK-01).`,
      ],
    };
  }
  if (input.scope && input.scope !== prev.fields.scope)
    throw new ScaffoldError(
      'scope_change_rejected',
      `Scope changes go through set_subject_scope (LM-14).`,
      `Call set_subject_scope ${id} ${input.scope}.`,
    );
  const next = SubjectFields.parse({
    ...prev.fields,
    title: input.title,
    ...(input.aliases ? { aliases: input.aliases } : {}),
    ...(input.goals ? { goals: input.goals } : {}),
    ...(input.anki_minutes !== undefined ? { anki_minutes: input.anki_minutes } : {}),
    ...(input.anki_deck ? { anki_deck: input.anki_deck } : {}),
  });
  const changed = (['title', 'aliases', 'goals', 'anki_minutes', 'anki_deck'] as const).filter(
    (k) => JSON.stringify(next[k]) !== JSON.stringify(prev.fields[k]),
  );
  if (changed.length) {
    const owned: Record<string, unknown> = {};
    for (const k of changed) owned[k] = next[k];
    sc.vault.writeOwned(subjectRel(id), owned);
    sc.emit([{ type: 'subject_updated', subject: next, changed }]);
  }
  return { created: false, subject: next, note: subjectRel(id), changed };
}

const ConceptItem = KcFields.extend({
  explanation: z.string().max(20_000).optional(),
  worked_example: z.string().max(20_000).optional(),
}).loose();

export const UpsertConceptInput = z.union([
  z.object({ concepts: z.array(z.unknown()).min(1).max(40) }),
  z.record(z.string(), z.unknown()),
]);

export function upsertConcepts(sc: Scaffold, raw: unknown, w: Warnings) {
  const list: unknown[] =
    raw && typeof raw === 'object' && Array.isArray((raw as { concepts?: unknown }).concepts)
      ? (raw as { concepts: unknown[] }).concepts
      : [raw];
  if (list.length > 40) throw new ScaffoldError('too_many', 'At most 40 concepts per call.');
  for (const item of list)
    if (item && typeof item === 'object')
      rejectDerived(item as Record<string, unknown>, DERIVED_KC_KEYS, 'upsert_concept');
  const items = list.map((x) => ConceptItem.parse(x));
  const facts = sc.facts();
  const subjects = new Set(Object.keys(facts.subjects));
  const known = new Map(Object.values(facts.kcs).map((k) => [k.fields.id, k.fields]));
  const batchIds = new Set(items.map((i) => i.id));
  for (const it of items) {
    if (!subjects.has(it.subject))
      throw new ScaffoldError(
        'unknown_subject',
        `${it.id}: subject ${it.subject} does not exist.`,
        'Create it first with upsert_subject (D3.10).',
      );
    for (const p of [...it.prerequisites, ...it.confusable_with])
      if (!known.has(p) && !batchIds.has(p))
        throw new ScaffoldError(
          'dangling_reference',
          `${it.id}: unknown KC ${p}.`,
          'Add that KC in the same call or fix the id (LM-12).',
        );
  }
  // LM-12: the DAG stays acyclic across all subjects.
  const nodes = new Map(
    [...known].map(([id, f]) => [
      id,
      { id, prerequisites: f.prerequisites, confusable_with: f.confusable_with },
    ]),
  );
  for (const it of items)
    nodes.set(it.id, { id: it.id, prerequisites: it.prerequisites, confusable_with: it.confusable_with });
  const cyc = validateGraph([...nodes.values()]).filter(
    (i) => i.code === 'cycle' || i.code === 'self_reference',
  );
  if (cyc.length)
    throw new ScaffoldError('prerequisite_cycle', cyc[0]!.message, 'Remove one edge of the cycle (LM-12).');

  const resolver = new SourceResolver(sc.vault.root);
  const today = localDate(sc.now(), sc.tz());
  const drafts: EventDraft[] = [];
  const results: { id: string; created: boolean; changed: string[]; note: string }[] = [];
  for (const it of items) {
    const { explanation, worked_example, ...rest } = it;
    const kc = KcFields.parse(rest);
    if (kc.volatility === 'volatile' && !kc.review_by) {
      kc.review_by = addDaysToDate(today, Math.round(sc.cfg().anki.volatile_review_months * 30.44));
      w.add(`${kc.id}: volatile KCs need review_by (ANK-05); set to ${kc.review_by}.`);
    }
    const rel = conceptRel(kc.id);
    const prev = facts.kcs[kc.id];
    if (!prev || !sc.vault.exists(rel)) {
      const opts: { explanation?: string; worked_example?: string } = {};
      if (explanation) opts.explanation = explanation;
      if (worked_example) opts.worked_example = worked_example;
      const text = conceptNote(kc, opts);
      const createdFile = sc.vault.createText(rel, text);
      const body = sc.vault.readNote(rel)!.split.body;
      const src: Record<string, string> = {};
      for (const s of kc.sources) src[s] = resolver.hash(s);
      if (!prev)
        drafts.push({ type: 'kc_created', kc, section_hashes: sectionHashes(body), source_hashes: src });
      results.push({ id: kc.id, created: createdFile, changed: [], note: rel });
      continue;
    }
    const fieldChanges = (Object.keys(KcFields.shape) as (keyof typeof kc)[]).filter(
      (k) => JSON.stringify(kc[k]) !== JSON.stringify(prev.fields[k]),
    );
    const changed: string[] = [...fieldChanges];
    if (fieldChanges.length) {
      const owned: Record<string, unknown> = {};
      for (const k of fieldChanges) owned[k] = kc[k];
      sc.vault.writeOwned(rel, owned);
    }
    for (const [heading, text] of [
      ['Explanation', explanation],
      ['Worked example', worked_example],
    ] as const) {
      if (!text) continue;
      const done = sc.vault.writeBody(rel, (body, eol) => fillEmptySection(body, heading, text, eol).text);
      if (done) changed.push(`section:${heading}`);
      else
        w.add(
          `${kc.id}: "## ${heading}" already has text; it belongs to the learner and was not changed (LM-02).`,
        );
    }
    if (changed.length) {
      const body = sc.vault.readNote(rel)!.split.body;
      const src: Record<string, string> = {};
      for (const s of kc.sources) src[s] = resolver.hash(s);
      drafts.push({
        type: 'kc_updated',
        kc_id: kc.id,
        kc,
        changed,
        section_hashes: sectionHashes(body),
        source_hashes: src,
      });
    }
    results.push({ id: kc.id, created: false, changed, note: rel });
  }
  sc.emit(drafts);
  refreshNotes(sc, { kcs: items.map((i) => i.id) }, loadBank(sc), w);
  return { concepts: results };
}

export function addQuestion(
  sc: Scaffold,
  raw: unknown,
  w: Warnings,
): { question_id: string; note: string; lint: LintResult; review: string } {
  if (raw && typeof raw === 'object')
    rejectDerived(raw as Record<string, unknown>, ['id', 'review', 'stats'], 'add_question');
  const input = QuestionInput.parse(raw);
  const facts = sc.facts();
  for (const k of input.kc_ids)
    if (!facts.kcs[k])
      throw new ScaffoldError('unknown_kc', `Unknown KC ${k}.`, 'Create it with upsert_concept first.');
  const lint = lintQuestion(input);
  const id = sc.nextId('Q');
  const q = Question.parse({
    ...input,
    id,
    review: { by: null, verdict: 'pending', notes: '' },
    stats: { attempts: 0, correct_rate: null, last_used: null },
  });
  const titles: Record<string, string> = {};
  for (const k of q.kc_ids) titles[k] = facts.kcs[k]!.fields.title;
  const rel = questionRel(id);
  sc.vault.createText(rel, questionNote(q, titles));
  const { id: _i, review: _r, stats: _s, ...payload } = q;
  sc.emit([{ type: 'question_added', question_id: id, question: payload, key_hash: keyHash(q) }]);
  if (!lint.ok) w.add(`${id} fails lint (QB-03); it will not be served until fixed and reviewed.`);
  refreshNotes(sc, { kcs: q.kc_ids }, loadBank(sc), w);
  return {
    question_id: id,
    note: rel,
    lint,
    review: 'pending: needs a cross-model review (QB-04) before the planner serves it',
  };
}
