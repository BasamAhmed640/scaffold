import { describe, expect, it } from 'vitest';
import { gradeMultipleChoice, gradeNumeric, isIDontKnow } from '../../src/core/questions/grade.js';
import { parseUnit } from '../../src/core/questions/units.js';

// REL-02: code grades multiple-choice and numeric answers against the key.

describe('REL-02 numeric grading', () => {
  const z0 = { value: 50, unit: 'Ω', tolerance: 1 };
  const table: [string, string, string][] = [
    ['50 Ω', 'correct', 'symbol'],
    ['50 ohms', 'correct', 'spelled out'],
    ['about 50.5Ω', 'correct', 'within tolerance'],
    ['0.05 kΩ', 'correct', 'prefix conversion'],
    ['Z0 = 50 ohm', 'correct', 'after an equals sign'],
    ['50', 'partial', 'unit missing'],
    ['75 Ω', 'incorrect', 'outside tolerance'],
    ['50 V', 'incorrect', 'wrong unit'],
    ['no idea', 'unanswered', 'I don’t know (LM-07)'],
    ['fifty', 'incorrect', 'no number'],
  ];
  for (const [answer, grade, why] of table) {
    it(`${why}: "${answer}" → ${grade}`, () => expect(gradeNumeric(answer, z0).grade).toBe(grade));
  }

  it('relative tolerance and compound units', () => {
    const v = { value: 6, unit: 'in/ns', tolerance: '5%' };
    expect(gradeNumeric('6 in/ns', v).grade).toBe('correct');
    expect(gradeNumeric('5.8 inches per ns', v).grade).toBe('correct');
    expect(gradeNumeric('0.1524 m/ns', v).grade).toBe('correct');
    expect(gradeNumeric('15 cm/ns', v).grade).toBe('correct');
    expect(gradeNumeric('5 in/ns', v).grade).toBe('incorrect');
  });

  it('dimensionless keys (Γ = −0.33) and scientific notation', () => {
    const g = { value: -0.333, unit: '1', tolerance: 0.01 };
    expect(gradeNumeric('Γ = −0.33', g).grade).toBe('correct');
    expect(gradeNumeric('Γ = -1/3', g).grade).toBe('correct');
    expect(gradeNumeric('0.33', g).grade).toBe('incorrect');
    const t = { value: 1.5e-9, unit: 's', tolerance: '2%' };
    expect(gradeNumeric('1.5e-9 s', t).grade).toBe('correct');
    expect(gradeNumeric('1.5 ns', t).grade).toBe('correct');
    expect(gradeNumeric('1500 ps', t).grade).toBe('correct');
  });

  it('parses units', () => {
    expect(parseUnit('kΩ')).toEqual({ dim: 'ohm', factor: 1000 });
    expect(parseUnit('nanoseconds')?.factor).toBeCloseTo(1e-9);
    expect(parseUnit('ps/in')?.dim).toBe('s/m');
    expect(parseUnit('bananas')).toBeNull();
  });
});

describe('REL-02 multiple-choice grading', () => {
  const options = ['Γ = 0', 'Γ = +1', 'Γ = −1'];
  it('accepts a letter, a letter with words, or the option text', () => {
    expect(gradeMultipleChoice('B', options, 'B').grade).toBe('correct');
    expect(gradeMultipleChoice('b) since it is open', options, 'B').grade).toBe('correct');
    expect(gradeMultipleChoice('Γ = +1', options, 'B').grade).toBe('correct');
    expect(gradeMultipleChoice('A', options, 'Γ = +1')).toMatchObject({ grade: 'incorrect', chosen: 0 });
    expect(gradeMultipleChoice('I don’t know', options, 'B').grade).toBe('unanswered');
    expect(gradeMultipleChoice("I don't know", options, 'B').grade).toBe('unanswered');
    expect(gradeMultipleChoice('Z', options, 'B').grade).toBe('incorrect');
  });
  it('recognizes "I don\'t know" variants (LM-07)', () => {
    for (const s of ["I don't know", 'idk', 'No idea.', 'skip', 'i dont know'])
      expect(isIDontKnow(s)).toBe(true);
    expect(isIDontKnow("I don't know why but 50 Ω")).toBe(false);
  });
});
