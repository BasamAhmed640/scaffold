import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { allTools } from '../../src/core/api/tools.js';
import { parseFrontmatter, splitNote } from '../../src/core/vault/frontmatter.js';

// V-PROTO: skill frontmatter valid; SKILL.md ≤ 500 lines; every TP rule verbatim; generated
// adapters match the source (AD-01).

const SKILL = 'skills/scaffold-tutor/SKILL.md';
const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const tp = JSON.parse(read('protocol/tp-rules.json')) as Record<string, string>;
const d3 = JSON.parse(read('protocol/d3-canonical.json')) as Record<string, { title: string; body: string }>;

describe('V-PROTO skill', () => {
  it('has valid frontmatter (name, description)', () => {
    const n = splitNote(read(SKILL));
    expect(n.hasFrontmatter).toBe(true);
    const fm = parseFrontmatter(n.fm);
    expect(Object.keys(fm).sort()).toEqual(['description', 'name']);
    expect(fm.name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(typeof fm.description).toBe('string');
    expect((fm.description as string).length).toBeGreaterThan(50);
    expect((fm.description as string).length).toBeLessThanOrEqual(1024);
  });

  it('SKILL.md stays at or under 500 lines, with the rest in references/', () => {
    expect(read(SKILL).split('\n').length).toBeLessThanOrEqual(500);
    for (const m of read(SKILL).matchAll(/references\/([\w-]+\.md)/g)) {
      expect(existsSync(`skills/scaffold-tutor/references/${m[1]}`), m[1]).toBe(true);
    }
  });

  it('every TP rule appears verbatim (TP-01 … TP-18)', () => {
    expect(Object.keys(tp)).toHaveLength(18);
    for (const [id, text] of Object.entries(tp)) {
      const expected = id === 'TP-01' ? `- \`${id}\` ${text}` : `| \`${id}\` | ${text} |`;
      for (const file of [SKILL, 'CLAUDE.md', 'AGENTS.md'])
        expect(read(file), `${id} in ${file}`).toContain(expected);
    }
  });

  it('every D3 section (D3.1 … D3.11) appears verbatim in the skill', () => {
    const skill = read(SKILL);
    expect(Object.keys(d3)).toHaveLength(11);
    for (const [id, s] of Object.entries(d3)) {
      expect(skill, id).toContain(`### ${id} ${s.title}`);
      expect(skill, id).toContain(s.body);
    }
  });

  it('protocol sources still match the frozen spec text (no softening)', () => {
    const sources = [
      '01-stance',
      '02-hard-rules',
      '03-session-script',
      '04-explanation-style',
      '05-questions',
      '06-misconception-repair',
      '07-analogy-policy',
      '08-teach-back',
      '09-metacognition',
      '10-new-subject',
      '11-example',
    ];
    Object.entries(d3).forEach(([id, s], i) => {
      expect(read(`protocol/d3/${sources[i]}.md`), id).toBe(`### ${id} ${s.title}\n\n${s.body}\n`);
    });
  });

  it('tools named in the protocol exist', () => {
    const names = new Set(allTools().map((t) => t.name));
    const text = [
      SKILL,
      'skills/scaffold-tutor/references/anki.md',
      'skills/scaffold-tutor/references/visuals.md',
      'skills/scaffold-tutor/references/questions.md',
      'skills/scaffold-tutor/references/batch-jobs.md',
    ]
      .map(read)
      .join('\n');
    // tool mentions: `name {…}` call patterns, and the Tool column of the SKILL.md table
    const mentioned = new Set([...text.matchAll(/`([a-z]+(?:_[a-z]+)+) \{[^`]*\}`/g)].map((m) => m[1]!));
    const table = read(SKILL).split('## Tools')[1]!.split('## Reading the briefing')[0]!;
    for (const row of table
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| When') && !l.startsWith('|---'))) {
      const cell = row.split('|')[2] ?? '';
      for (const m of cell.matchAll(/`([a-z]+(?:_[a-z]+)+)/g)) mentioned.add(m[1]!);
    }
    expect(mentioned.size).toBeGreaterThan(15);
    for (const m of mentioned) expect(names.has(m), `unknown tool "${m}"`).toBe(true);
  });
});

describe('V-PROTO adapters (AD-01)', () => {
  it('generated files match the source (hash banner + --check)', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-adapters.ts', '--check'], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(0);
    for (const f of [SKILL, 'CLAUDE.md', 'AGENTS.md']) expect(read(f)).toMatch(/source sha256 [0-9a-f]{16}/);
  });

  it('the skill ZIP holds scaffold-tutor/SKILL.md and its references', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/build-adapters.ts'], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(0);
    const buf = readFileSync('dist/scaffold-tutor-skill.zip');
    const names: string[] = [];
    let off = 0;
    while (buf.readUInt32LE(off) === 0x04034b50) {
      const compSize = buf.readUInt32LE(off + 18);
      const nameLen = buf.readUInt16LE(off + 26);
      const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
      const data = inflateRawSync(buf.subarray(off + 30 + nameLen, off + 30 + nameLen + compSize)).toString(
        'utf8',
      );
      if (name === 'scaffold-tutor/SKILL.md') expect(data).toBe(read(SKILL));
      names.push(name);
      off += 30 + nameLen + compSize;
    }
    expect(names).toContain('scaffold-tutor/SKILL.md');
    expect(names).toContain('scaffold-tutor/references/tools.md');
  });

  it('against the original build spec, when it is available locally', () => {
    const spec = process.env.SCAFFOLD_SPEC ?? 'C:/Users/basam/Downloads/scaffold-build-prompt.md';
    if (!existsSync(spec)) return; // the spec is never committed (C7)
    const text = read(spec);
    for (const [id, rule] of Object.entries(tp)) expect(text, id).toContain(rule);
  });
});
