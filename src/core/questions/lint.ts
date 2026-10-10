import type { QuestionInputParsed } from '../schemas/question.js';
import { wordedAlike } from './similarity.js';

// QB-03: `scaffold q lint` enforces every machine-checkable part of QB-01.

export interface LintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** DEFAULT: longest option at most 1.6× the shortest, and at most 40 characters longer. */
export const OPTION_RATIO = 1.6;
export const OPTION_SPREAD_CHARS = 40;
export const MAX_STEM_CHARS = 1200;
const REASONING = /\b(because|since|therefore|so that|which means|due to)\b/i;

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

export function optionIndex(options: string[], answer: string): number {
  const a = answer.trim();
  const letter = /^\(?([A-Fa-f])\)?\.?$/.exec(a);
  if (letter) {
    const i = letter[1]!.toUpperCase().charCodeAt(0) - 65;
    return i < options.length ? i : -1;
  }
  return options.findIndex((o) => norm(o) === norm(a));
}

export function lintQuestion(q: QuestionInputParsed, opts: { ankiText?: string[] } = {}): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (q.kc_ids.length < 1 || q.kc_ids.length > 2)
    errors.push('QB-01.1: target one KC or one relation between two KCs.');
  // QB-01.2: production by default; multiple choice only for discriminate.
  if (q.format === 'mc' && q.qtype !== 'discriminate')
    errors.push('QB-01.2: multiple choice is allowed only for `discriminate` questions.');
  // QB-01.3: key and rubric.
  if (!q.answer_key.trim() && !(q.format === 'numeric' && q.numeric))
    errors.push('QB-01.3: answer key missing.');
  if (q.rubric.length < 1 || q.rubric.length > 4)
    errors.push(`QB-01.3: rubric must have 1–4 propositions (has ${q.rubric.length}).`);
  const rubricIds = new Set(q.rubric.map((r) => r.id));
  if (rubricIds.size !== q.rubric.length) errors.push('QB-01.3: rubric ids must be unique.');
  if (q.format === 'numeric') {
    if (!q.numeric) errors.push('QB-01.3: numeric questions need `numeric: {value, unit, tolerance}`.');
    else {
      if (!q.numeric.unit.trim())
        errors.push('QB-01.3: numeric answer needs a unit (use "1" for dimensionless).');
      if (q.numeric.tolerance === 0 || q.numeric.tolerance === '0%')
        warnings.push('QB-01.3: tolerance is zero; numeric answers rarely match exactly.');
    }
  }
  // QB-01.5: no leak through the stem or options.
  const stem = norm(q.stem);
  const key = norm(q.answer_key);
  if (q.format !== 'mc' && key.length >= 3 && stem.includes(key))
    errors.push('QB-01.5: the answer key text appears in the stem.');
  if (q.format === 'numeric' && q.numeric) {
    const v = String(q.numeric.value);
    if (v.length >= 2 && new RegExp(`(^|[^\\d.])${v.replace('.', '\\.')}([^\\d]|$)`).test(q.stem))
      errors.push('QB-01.5: the numeric answer appears in the stem.');
  }
  if (q.format === 'mc') {
    const options = q.options ?? [];
    if (options.length < 2) errors.push('QB-01.2: multiple choice needs at least 2 options.');
    const ki = optionIndex(options, q.answer_key);
    if (ki === -1)
      errors.push('QB-01.3: the mc answer key must be an option letter or the exact option text.');
    else if (stem.includes(norm(options[ki]!)) && norm(options[ki]!).length >= 3)
      errors.push('QB-01.5: the correct option text appears in the stem.');
    if (options.length >= 2) {
      const lens = options.map((o) => o.trim().length);
      const min = Math.min(...lens);
      const max = Math.max(...lens);
      if (max > min * OPTION_RATIO || max - min > OPTION_SPREAD_CHARS)
        errors.push(`QB-01.5: option lengths differ too much (${min}–${max} characters); make them similar.`);
    }
    options.forEach((o, i) => {
      if (REASONING.test(o))
        errors.push(`QB-01.5: option ${String.fromCharCode(65 + i)} contains reasoning ("because", "so"…).`);
    });
    // Each distractor maps to a known misconception.
    options.forEach((o, i) => {
      if (i === ki) return;
      const letter = String.fromCharCode(65 + i);
      const mapped = q.misconception_targets.some(
        (t) =>
          t.misconception_id &&
          (norm(t.option_or_belief) === norm(o) || norm(t.option_or_belief) === norm(letter)),
      );
      if (!mapped)
        errors.push(
          `QB-01.2: distractor ${letter} must map to a known misconception (misconception_targets).`,
        );
    });
  }
  // QB-01.7: four-step hint ladder.
  if (q.hints.length !== 4)
    errors.push(
      `QB-01.7: exactly 4 hints required (H1 orient, H2 principle, H3 partial step, H4 full answer); has ${q.hints.length}.`,
    );
  q.hints.forEach((h, i) => {
    if (!h.trim()) errors.push(`QB-01.7: hint H${i + 1} is empty.`);
  });
  if (q.hints.length === 4 && q.hints[0] && key.length >= 3 && norm(q.hints[0]).includes(key))
    errors.push('QB-01.7: H1 must orient, not give the answer.');
  // QB-01.8: answerable in one chat message.
  if (q.stem.length > MAX_STEM_CHARS)
    errors.push(`QB-01.8: stem is longer than ${MAX_STEM_CHARS} characters; split it into steps.`);
  // QB-01.6: wording different from the KC's Anki cards.
  for (const card of opts.ankiText ?? []) {
    if (wordedAlike(card, q.stem)) {
      errors.push('QB-01.6: the stem is worded like one of the KC’s Anki cards.');
      break;
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
