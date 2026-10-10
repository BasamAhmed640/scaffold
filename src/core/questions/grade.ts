import type { Grade } from '../schemas/common.js';
import type { NumericKey } from '../schemas/question.js';
import { optionIndex } from './lint.js';
import { parseQuantity, parseUnit } from './units.js';

// REL-02: multiple-choice and numeric answers are graded by code against the key; the model grades
// only free text. LM-07: "I don't know" is `unanswered`.

const IDK =
  /^\s*(i\s*(do\s*not|don['’]?t|dont)\s*know|idk|no\s*idea|not\s*sure|skip(ped)?|pass|\?+)\s*[.!]?\s*$/i;

export function isIDontKnow(answer: string): boolean {
  return IDK.test(answer);
}

export interface CodeGrade {
  grade: Grade;
  detail: string;
  /** index of the option the learner chose (mc) */
  chosen?: number;
  /** value the learner gave, converted to the key's unit (numeric) */
  value?: number;
}

export function gradeNumeric(answer: string, key: NumericKey): CodeGrade {
  if (isIDontKnow(answer)) return { grade: 'unanswered', detail: '"I don\'t know"' };
  const q = parseQuantity(answer);
  if (!q) return { grade: 'incorrect', detail: 'no number found in the answer' };
  const keyUnit = key.unit.trim();
  const dimensionless = keyUnit === '' || keyUnit === '1';
  const ku = dimensionless ? { dim: '1', factor: 1 } : parseUnit(keyUnit);
  const tol =
    typeof key.tolerance === 'number'
      ? key.tolerance
      : (Number(key.tolerance.replace('%', '')) / 100) * Math.abs(key.value);
  let value = q.value;
  let unitNote = '';
  if (!q.unitText) {
    if (!dimensionless) unitNote = 'unit missing';
  } else if (dimensionless) {
    const au = parseUnit(q.unitText);
    if (au && au.dim !== '1')
      return { grade: 'incorrect', detail: `expected a dimensionless number, got ${q.unitText}`, value };
  } else {
    const au = parseUnit(q.unitText);
    if (!au || !ku) {
      if (q.unitText.toLowerCase() !== keyUnit.toLowerCase())
        unitNote = `unit "${q.unitText}" not understood`;
    } else if (au.dim !== ku.dim) {
      return { grade: 'incorrect', detail: `wrong unit: ${q.unitText} is not ${keyUnit}`, value };
    } else {
      value = (q.value * au.factor) / ku.factor;
    }
  }
  const within = Math.abs(value - key.value) <= tol + 1e-12 * Math.max(1, Math.abs(key.value));
  if (!within)
    return {
      grade: 'incorrect',
      detail: `${round(value)} ${keyUnit} is outside ${key.value} ± ${round(tol)}`,
      value,
    };
  if (unitNote) return { grade: 'partial', detail: `value right, ${unitNote} (units are required)`, value };
  return { grade: 'correct', detail: `${round(value)} ${keyUnit} within tolerance`, value };
}

export function gradeMultipleChoice(answer: string, options: string[], key: string): CodeGrade {
  if (isIDontKnow(answer)) return { grade: 'unanswered', detail: '"I don\'t know"' };
  const lead = /^\s*\(?([A-Fa-f])\)?(?:[\s.,:;)!]|$)/.exec(answer);
  let chosen = lead ? lead[1]!.toUpperCase().charCodeAt(0) - 65 : optionIndex(options, answer);
  if (chosen >= options.length) chosen = -1;
  const k = optionIndex(options, key);
  if (chosen === -1) return { grade: 'incorrect', detail: 'no option recognized in the answer' };
  const letter = String.fromCharCode(65 + chosen);
  return chosen === k
    ? { grade: 'correct', detail: `chose ${letter}`, chosen }
    : { grade: 'incorrect', detail: `chose ${letter}; the key is ${String.fromCharCode(65 + k)}`, chosen };
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
