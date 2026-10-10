import type { KcFields } from '../schemas/kc.js';
import type { Question } from '../schemas/question.js';
import { deckNameFor, type SubjectFields } from '../schemas/subject.js';
import { DERIVED_HEADER, serializeKey } from './frontmatter.js';
import { region } from './markers.js';

// Generated note text. The vault's _templates/ folder is written from these same functions.

const EOL = '\n';

/** Keys whose values are long lists of objects/strings read better in block style. */
const BLOCK_KEYS = new Set(['rubric', 'hints', 'misconception_targets', 'options', 'goals']);

function fm(owned: Record<string, unknown>, derived?: Record<string, unknown>): string {
  let out = '---\n';
  for (const [k, v] of Object.entries(owned))
    if (v !== undefined) out += serializeKey(k, v, EOL, { flow: !BLOCK_KEYS.has(k) });
  if (derived) {
    out += DERIVED_HEADER + EOL;
    for (const [k, v] of Object.entries(derived)) out += serializeKey(k, v, EOL);
  }
  return out + '---\n';
}

export const CONCEPT_DERIVED_DEFAULTS = {
  status: 'unseen',
  misconception_active: false,
  mastery: '0 of 3 conditions met',
  memory: null,
  last_assessed: null,
  needs_check: false,
  due: false,
};

export function conceptNote(
  kc: KcFields,
  opts: { explanation?: string; worked_example?: string } = {},
): string {
  const owned = {
    id: kc.id,
    title: kc.title,
    subject: kc.subject,
    kind: kc.kind,
    prerequisites: kc.prerequisites,
    confusable_with: kc.confusable_with,
    requires_visual: kc.requires_visual,
    volatility: kc.volatility,
    review_by: kc.review_by,
    anki_note_ids: kc.anki_note_ids,
    visuals: kc.visuals,
    sources: kc.sources,
    cssclasses: ['scaffold', 'scaffold-concept'],
  };
  const body = [
    `# ${kc.title}`,
    '',
    '## In my words',
    '',
    region('in-my-words', '', EOL),
    '',
    '## Explanation',
    '',
    ...(opts.explanation ? [opts.explanation.trim(), ''] : []),
    '## Worked example',
    '',
    ...(opts.worked_example ? [opts.worked_example.trim(), ''] : []),
    '## Misconceptions seen',
    '',
    region('misconceptions', '_None recorded._', EOL),
    '',
    '## Visuals',
    '',
    region('visuals', '_None yet._', EOL),
    '',
    '## Questions',
    '',
    region('questions', '_None yet._', EOL),
    '',
  ].join(EOL);
  return fm(owned, CONCEPT_DERIVED_DEFAULTS) + EOL + body;
}

export function subjectNote(s: SubjectFields): string {
  const owned = {
    id: s.id,
    title: s.title,
    aliases: s.aliases,
    goals: s.goals,
    scope: s.scope,
    anki_minutes: s.anki_minutes,
    anki_deck: s.anki_deck ?? deckNameFor(s.title),
    cssclasses: ['scaffold', 'scaffold-subject'],
  };
  const body = [
    `# ${s.title}`,
    '',
    '## Goals',
    '',
    ...(s.goals.length ? s.goals.map((g) => `- ${g}`) : ['- ']),
    '',
    '## Concept map',
    '',
    region('concept-map', '_No concepts yet._', EOL),
    '',
    '## Notes',
    '',
  ].join(EOL);
  return fm(owned, { last_session: null, due: 0 }) + EOL + body;
}

export function questionFrontmatter(q: Question): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: q.id,
    kc_ids: q.kc_ids,
    qtype: q.qtype,
    format: q.format,
    difficulty: q.difficulty,
    stem: q.stem,
  };
  if (q.options) out.options = q.options;
  out.answer_key = q.answer_key;
  if (q.numeric) out.numeric = q.numeric;
  out.rubric = q.rubric;
  out.hints = q.hints;
  out.misconception_targets = q.misconception_targets;
  if (q.visual_id) out.visual_id = q.visual_id;
  if (q.source_ref) out.source_ref = q.source_ref;
  if (q.variant_of) out.variant_of = q.variant_of;
  out.created_by = q.created_by;
  out.cssclasses = ['scaffold', 'scaffold-question'];
  return out;
}

export function questionNote(q: Question, kcTitles: Record<string, string>): string {
  const owned = questionFrontmatter(q);
  const kcs = q.kc_ids.map((k) => `[[Scaffold/Concepts/${k}|${kcTitles[k] ?? k}]]`).join(', ');
  const body = [
    `# ${q.id}`,
    '',
    `**Concepts:** ${kcs} · **Type:** ${q.qtype} · **Format:** ${q.format} · **Difficulty:** ${q.difficulty}`,
    '',
    '## Stem',
    '',
    q.stem,
    '',
    ...(q.options ? q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).concat(['']) : []),
    ...(q.visual_id ? [`![[Scaffold/Visuals/${q.visual_id}/figure.svg]]`, ''] : []),
    '## Notes',
    '',
  ].join(EOL);
  return fm(owned, { review: q.review, stats: q.stats }) + EOL + body;
}

export function homeNote(): string {
  return [
    '---',
    'cssclasses: [scaffold, scaffold-home]',
    '---',
    '',
    '# Scaffold',
    '',
    'Start a session in Claude Desktop by typing **start a session** (or name a subject).',
    '',
    '## Due today',
    '',
    '![[Scaffold/_bases/due.base]]',
    '',
    '## Mastery by status',
    '',
    '![[Scaffold/_bases/mastery.base]]',
    '',
    '## Active misconceptions',
    '',
    '![[Scaffold/_bases/misconceptions.base]]',
    '',
    '## Links',
    '',
    '- [[Scaffold/Learner/Profile|Learner profile]]',
    '- [[Scaffold/Learner/Misconceptions|Misconception ledger]]',
    '',
  ].join(EOL);
}

export function profileNote(): string {
  return [
    '---',
    'session_minutes: 30',
    'analogies: sparing',
    'level: start below assumed level',
    'cssclasses: [scaffold]',
    '---',
    '',
    '# Learner profile',
    '',
    '## Goals',
    '',
    '- ',
    '',
    '## Background',
    '',
    '- ',
    '',
    '## Preferences',
    '',
    'The three properties above are read by Scaffold: `session_minutes`, `analogies` (off | sparing | on) and `level`.',
    '',
  ].join(EOL);
}

export function misconceptionsLedgerNote(): string {
  return [
    '---',
    'cssclasses: [scaffold]',
    '---',
    '',
    '# Misconception ledger',
    '',
    'Generated by Scaffold from the event log. Resolution is derived (two correct answers to targeting questions in two sessions ≥ 20 h apart).',
    '',
    region('ledger', '_No misconceptions recorded._', EOL),
    '',
  ].join(EOL);
}

export function visualSpecNote(v: {
  id: string;
  title: string;
  kind: string;
  kc_ids: string[];
  format: 'svg' | 'html';
  purpose: string;
  notice: string;
  alt: string;
  generator: string | null;
  provenance: string;
  checks: Record<string, unknown>;
}): string {
  const owned = {
    id: v.id,
    title: v.title,
    kind: v.kind,
    kc_ids: v.kc_ids,
    format: v.format,
    alt: v.alt,
    cssclasses: ['scaffold', 'scaffold-visual'],
  };
  const embed =
    v.format === 'svg'
      ? `![[Scaffold/Visuals/${v.id}/figure.svg]]`
      : `![[Scaffold/Visuals/${v.id}/preview.png]]\n\n[Open the interactive version](Scaffold/Visuals/${v.id}/index.html)`;
  const body = [
    `# ${v.id} · ${v.title}`,
    '',
    embed,
    '',
    '## Purpose',
    '',
    v.purpose,
    '',
    '## What to notice',
    '',
    v.notice,
    '',
    '## Concepts',
    '',
    ...v.kc_ids.map((k) => `- [[Scaffold/Concepts/${k}]]`),
    '',
    '## Generator / provenance',
    '',
    v.generator ? '```\n' + v.generator.trim() + '\n```' : v.provenance || '_Hand-authored; no generator._',
    '',
  ].join(EOL);
  return fm(owned, { checks: v.checks }) + EOL + body;
}
