import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DERIVED_HEADER,
  joinNote,
  parseFrontmatter,
  setDerivedKeys,
  setOwnedKeys,
  splitNote,
} from '../../src/core/vault/frontmatter.js';
import {
  fillEmptySection,
  learnerProjection,
  readRegion,
  replaceRegion,
} from '../../src/core/vault/markers.js';

// V-VAULT: learner-written text and unknown frontmatter keys are never altered (VLT-02, LM-02).

const DERIVED = [
  'status',
  'misconception_active',
  'mastery',
  'memory',
  'last_assessed',
  'needs_check',
  'due',
];

/** Independent projection: drop derived key lines (and their indented continuation) and the header. */
function learnerFm(fm: string): string {
  const lines = fm.split(/(?<=\n)/);
  const out: string[] = [];
  let skipping = false;
  for (const l of lines) {
    const key = /^([A-Za-z_][\w-]*):/.exec(l)?.[1];
    if (key) skipping = DERIVED.includes(key);
    else if (!/^[ \t]/.test(l)) skipping = false;
    if (l.replace(/\r?\n$/, '') === DERIVED_HEADER) continue;
    if (!skipping) out.push(l);
  }
  return out.join('');
}

describe('frontmatter splitting', () => {
  it('round-trips BOM, CRLF and bodies byte for byte', () => {
    for (const text of [
      '---\nid: x\n---\nbody\n',
      '﻿---\r\nid: x\r\n---\r\nbody\r\nmore\r\n',
      'no frontmatter at all\n',
      '---\nunterminated\n',
      '---\n---\nempty fm\n',
    ]) {
      expect(joinNote(splitNote(text))).toBe(text);
    }
  });

  it('fails loudly on invalid YAML instead of writing', () => {
    expect(() => parseFrontmatter('a: [1, 2\nb: c\n')).toThrow(/YAML error/);
    expect(() => setDerivedKeys('a: [1, 2\n', { status: 'solid' }, '\n')).toThrow(/YAML error/);
  });
});

describe('surgical key updates', () => {
  it('replaces only derived keys and keeps comments, quoting and unknown keys', () => {
    const fm = [
      'id: kc-a',
      'title: "Reflection coefficient (Γ)"   # learner comment',
      'custom_list:',
      '  - one',
      '  - "two: quoted"',
      '# a comment about the next key',
      'status: unseen',
      'flow: {a: 1,   b: [x,y]}',
      DERIVED_HEADER,
      'memory:',
      '  stability_days: 1',
      '  difficulty: 2',
      'mastery: old',
      '',
    ].join('\n');
    const out = setDerivedKeys(
      fm,
      {
        status: 'fragile',
        memory: { stability_days: 4.2, difficulty: 5.1, retrievability: 0.83, next_check: '2026-10-12' },
        mastery: '2 of 3 conditions met',
        due: true,
      },
      '\n',
    );
    expect(learnerFm(out)).toBe(learnerFm(fm));
    expect(out).toContain('title: "Reflection coefficient (Γ)"   # learner comment');
    expect(out).toContain('# a comment about the next key\nstatus: fragile\n');
    expect(out).toContain('flow: {a: 1,   b: [x,y]}');
    expect(out).toContain(
      'memory: {stability_days: 4.2, difficulty: 5.1, retrievability: 0.83, next_check: 2026-10-12}',
    );
    expect(out.endsWith('due: true\n')).toBe(true);
    expect(parseFrontmatter(out).custom_list).toEqual(['one', 'two: quoted']);
  });

  it('adds the derived header once when derived keys are missing', () => {
    const out = setDerivedKeys('id: kc-a\n', { status: 'solid' }, '\n');
    expect(out).toBe(`id: kc-a\n${DERIVED_HEADER}\nstatus: solid\n`);
    const again = setDerivedKeys(out, { status: 'fragile', due: false }, '\n');
    expect(again).toBe(`id: kc-a\n${DERIVED_HEADER}\nstatus: fragile\ndue: false\n`);
  });

  it('inserts learner-owned keys above the derived block and preserves CRLF', () => {
    const fm = `id: kc-a\r\n${DERIVED_HEADER}\r\nstatus: solid\r\n`;
    const out = setOwnedKeys(fm, { prerequisites: ['kc-b'] }, '\r\n');
    expect(out).toBe(`id: kc-a\r\nprerequisites: [kc-b]\r\n${DERIVED_HEADER}\r\nstatus: solid\r\n`);
  });
});

describe('marker regions', () => {
  it('replace only the inner text and report missing markers', () => {
    const body = 'learner text\n<!-- scaffold:begin q -->\nold\n<!-- scaffold:end q -->\nmore learner text\n';
    const r = replaceRegion(body, 'q', 'new line', '\n');
    expect(r.text).toBe(
      'learner text\n<!-- scaffold:begin q -->\nnew line\n<!-- scaffold:end q -->\nmore learner text\n',
    );
    expect(readRegion(r.text, 'q')).toBe('new line');
    expect(replaceRegion('no markers', 'q', 'x', '\n').found).toBe(false);
    expect(learnerProjection(r.text)).toBe(learnerProjection(body));
  });

  it('fills an empty section but never overwrites learner text', () => {
    const body = '## Explanation\n\n## Worked example\nmine\n';
    const r1 = fillEmptySection(body, 'Explanation', 'Generated text', '\n');
    expect(r1.changed).toBe(true);
    expect(r1.text).toContain('## Explanation\n\nGenerated text\n\n## Worked example\nmine\n');
    const r2 = fillEmptySection(body, 'Worked example', 'other', '\n');
    expect(r2.changed).toBe(false);
    expect(r2.text).toBe(body);
  });
});

// ---- 200 random write cycles -------------------------------------------------------------

const scalar = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }).map((s) => JSON.stringify(s)),
  fc.constantFrom(
    'plain words',
    "'single quoted'",
    '42',
    'true',
    'null',
    '2026-10-05',
    'Γ → Z₀ ✓',
    '"with: colon"',
  ),
);
const learnerLine = fc.oneof(
  fc
    .tuple(
      fc.constantFrom('note', 'my_tag', 'Custom-Key', 'ünïcode', 'rating', 'tags', 'source_page'),
      scalar,
    )
    .map(([k, v]) => `${k}: ${v}`),
  fc.constantFrom(
    '# a learner comment',
    'list_key:\n  - a\n  - "b c"',
    'nested:\n  inner: 1\n  other: [x, y]',
    'flowy: {a: 1, b: two}',
    'empty_key:',
  ),
);
const derivedValue = fc.record({
  status: fc.constantFrom('unseen', 'introduced', 'fragile', 'solid', 'forgotten'),
  misconception_active: fc.boolean(),
  mastery: fc.constantFrom(
    '0 of 3 conditions met',
    '2 of 3 conditions met',
    '3 of 3 conditions met; latest attempt not correct',
  ),
  memory: fc.option(
    fc.record({
      stability_days: fc.double({ min: 0.1, max: 400, noNaN: true }).map((x) => Math.round(x * 100) / 100),
      difficulty: fc.double({ min: 1, max: 10, noNaN: true }).map((x) => Math.round(x * 100) / 100),
      retrievability: fc.double({ min: 0, max: 1, noNaN: true }).map((x) => Math.round(x * 1000) / 1000),
      next_check: fc.constantFrom('2026-10-12', '2027-01-01'),
    }),
    { nil: null },
  ),
  last_assessed: fc.option(fc.constantFrom('2026-10-05', '2026-10-09'), { nil: null }),
  needs_check: fc.boolean(),
  due: fc.boolean(),
});
const bodyText = fc.array(
  fc.oneof(
    fc.string({ maxLength: 40 }).map((s) => s.replace(/<!--|-->|\r/g, '')),
    fc.constantFrom(
      '## In my words',
      'Γ = (Z_L − Z0)/(Z_L + Z0)',
      '> [!note] callout',
      '```\ncode block\n```',
      '- item',
      '',
    ),
  ),
  { maxLength: 8 },
);

describe('VLT-02 / LM-02: 200 random write cycles', () => {
  it('leave learner-written text and unknown frontmatter keys byte-identical', () => {
    fc.assert(
      fc.property(
        fc.array(learnerLine, { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        fc.boolean(),
        bodyText,
        bodyText,
        fc.array(fc.tuple(derivedValue, fc.string({ maxLength: 30 })), { minLength: 200, maxLength: 200 }),
        (lines, crlf, interleave, bodyA, bodyB, cycles) => {
          const eol = crlf ? '\r\n' : '\n';
          // learner keys, optionally with a derived key placed in the middle by the learner
          // unique learner keys (duplicate keys are invalid YAML)
          const fmLines = lines.map((l, i) => l.replace(/^([^\s#:][^:\n]*):/, `$1_${i}:`));
          if (interleave) fmLines.splice(1, 0, 'status: unseen');
          const fm = fmLines.join('\n').replace(/\n/g, eol) + eol;
          const body =
            [...bodyA, '<!-- scaffold:begin questions -->', 'x', '<!-- scaffold:end questions -->', ...bodyB]
              .join('\n')
              .replace(/\n/g, eol) + eol;
          let text = `---${eol}${fm}---${eol}${body}`;
          const original = splitNote(text);
          const fmProjection = learnerFm(original.fm);
          const bodyProjection = learnerProjection(original.body);
          for (const [derived, regionText] of cycles) {
            const n = splitNote(text);
            const nextFm = setDerivedKeys(n.fm, derived, n.eol);
            const nextBody = replaceRegion(n.body, 'questions', regionText, n.eol).text;
            text = joinNote({ ...n, fm: nextFm, body: nextBody });
          }
          const after = splitNote(text);
          expect(learnerFm(after.fm)).toBe(fmProjection);
          expect(learnerProjection(after.body)).toBe(bodyProjection);
          expect(after.eol).toBe(original.eol);
          if (crlf) expect(text.replace(/\r\n/g, '')).not.toContain('\n');
          const parsed = parseFrontmatter(after.fm);
          expect(parsed.status).toBe(cycles[cycles.length - 1]![0].status);
        },
      ),
      { numRuns: 25, seed: 7 },
    );
  });
});
