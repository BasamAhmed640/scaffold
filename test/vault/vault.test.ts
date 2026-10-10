import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Warnings } from '../../src/core/envelope.js';
import { SeqIds } from '../../src/core/ids.js';
import { addQuestion, upsertConcepts, upsertSubject } from '../../src/core/service/ops/content.js';
import { doctorVault, rebuildVault, validateVault } from '../../src/core/service/ops/maintenance.js';
import { Scaffold } from '../../src/core/service/scaffold.js';
import { syncFromVault } from '../../src/core/service/sync.js';
import { FakeClock } from '../../src/core/time.js';
import { EventLog } from '../../src/core/vault/eventlog.js';
import { splitNote } from '../../src/core/vault/frontmatter.js';
import { initVault } from '../../src/core/vault/init.js';
import { checkLinks } from '../../src/core/vault/links.js';
import { confine, resolveVault } from '../../src/core/vault/paths.js';
import { generatedTemplateFiles } from '../../src/core/vault/template.js';
import { conceptRel, Vault } from '../../src/core/vault/vault.js';
import { TZ } from '../helpers/builder.js';
import { cleanupAll, makeVault, tempDir, vaultFromEvents } from '../helpers/vault.js';
import { FIXTURE_NOW, standardFixture } from '../fixtures/standard.js';

afterAll(() => cleanupAll());

async function seed(sc: Scaffold): Promise<void> {
  const w = new Warnings();
  await upsertSubject(sc, { title: 'SI/PI', id: 'si-pi', aliases: ['signal integrity'] }, w);
  upsertConcepts(
    sc,
    {
      concepts: [
        {
          id: 'kc-si-z0',
          title: 'Characteristic impedance (Z₀)',
          subject: 'si-pi',
          explanation: 'Z₀ is what a fast edge sees.',
        },
        {
          id: 'kc-si-gamma',
          title: 'Reflection coefficient (Γ)',
          subject: 'si-pi',
          prerequisites: ['kc-si-z0'],
          requires_visual: true,
        },
      ],
    },
    w,
  );
}

describe('VLT-04 init', () => {
  it('creates the vault from the template and never overwrites on re-run', () => {
    const v = makeVault({ obsidian: true });
    for (const rel of [
      'Home.md',
      'Learner/Profile.md',
      'Learner/Misconceptions.md',
      '_bases/mastery.base',
      '_bases/due.base',
      '_bases/misconceptions.base',
      '_system/config.json',
      '_system/schema-version',
      '_system/events.jsonl',
      '_templates/Concept.md',
    ])
      expect(existsSync(path.join(v.root, 'Scaffold', ...rel.split('/'))), rel).toBe(true);
    for (const d of [
      'Concepts',
      'Subjects',
      'Questions',
      'Visuals',
      'Sessions',
      'Sources',
      'Learner/Weekly',
      '_system/queue',
      '_system/backups',
    ])
      expect(existsSync(path.join(v.root, 'Scaffold', ...d.split('/'))), d).toBe(true);
    expect(existsSync(path.join(v.root, '.obsidian', 'snippets', 'scaffold.css'))).toBe(true);
    const home = path.join(v.root, 'Scaffold', 'Home.md');
    writeFileSync(home, 'my own home page\n');
    const again = initVault(v.root, { userConfig: v.userConfig });
    expect(again.created).toEqual([]);
    expect(readFileSync(home, 'utf8')).toBe('my own home page\n');
    expect(JSON.parse(readFileSync(v.userConfig, 'utf8')).vault).toBe(path.resolve(v.root));
  });

  it('the committed vault-template matches its generators (no drift)', () => {
    for (const [rel, text] of Object.entries(generatedTemplateFiles())) {
      const committed = readFileSync(
        path.join('vault-template', 'Scaffold', ...rel.split('/')),
        'utf8',
      ).replace(/\r\n/g, '\n');
      expect(committed, rel).toBe(text);
    }
  });
});

describe('ARC-12 configuration order', () => {
  it('flag > env SCAFFOLD_VAULT > user config', () => {
    const dir = tempDir();
    const cfg = path.join(dir, 'config.json');
    writeFileSync(cfg, JSON.stringify({ vault: path.join(dir, 'from-config') }));
    expect(
      resolveVault({
        flag: path.join(dir, 'flag'),
        env: { SCAFFOLD_VAULT: path.join(dir, 'env') },
        configPath: cfg,
      }).source,
    ).toBe('flag');
    expect(resolveVault({ env: { SCAFFOLD_VAULT: path.join(dir, 'env') }, configPath: cfg }).source).toBe(
      'env',
    );
    expect(resolveVault({ env: {}, configPath: cfg })).toEqual({
      vault: path.join(dir, 'from-config'),
      source: 'user-config',
    });
    expect(() => resolveVault({ env: {}, configPath: path.join(dir, 'missing.json') })).toThrow(
      /No vault configured/,
    );
  });
});

describe('IF-03 path confinement', () => {
  it('rejects .., absolute paths outside the vault and link escapes', () => {
    const v = makeVault();
    expect(() => confine(v.root, '../outside.md')).toThrow(/contains "\.\."/);
    expect(() => confine(v.root, 'Scaffold/../../x')).toThrow();
    expect(() => confine(v.root, path.resolve(v.root, '..', 'other', 'x.md'))).toThrow(/outside the vault/);
    expect(confine(v.root, 'Scaffold/Concepts/kc-a.md')).toBe(
      path.join(v.root, 'Scaffold', 'Concepts', 'kc-a.md'),
    );
    const outside = tempDir('scaffold-outside-');
    const link = path.join(v.root, 'Scaffold', 'escape');
    symlinkSync(outside, link, 'junction');
    expect(() => confine(v.root, 'Scaffold/escape/secret.md')).toThrow(/escapes the vault/);
  });
});

describe('VLT-02 atomic writes', () => {
  it('a simulated crash mid-write leaves the old file intact and no truncated file', async () => {
    let crash = false;
    const v = makeVault({
      hooks: {
        beforeRename: () => {
          if (crash) throw new Error('simulated crash');
        },
      },
    });
    await seed(v.sc);
    const rel = conceptRel('kc-si-z0');
    const before = readFileSync(path.join(v.root, ...rel.split('/')), 'utf8');
    crash = true;
    expect(() => v.sc.vault.writeDerived(rel, { status: 'solid' })).toThrow('simulated crash');
    expect(readFileSync(path.join(v.root, ...rel.split('/')), 'utf8')).toBe(before);
    const leftovers = readdirSync(path.join(v.root, 'Scaffold', 'Concepts')).filter((f) =>
      f.includes('.scaffold-tmp-'),
    );
    expect(leftovers).toEqual([]);
  });

  it('a torn last line in events.jsonl (crash mid-append) is ignored, reported and repairable', async () => {
    const v = makeVault();
    await seed(v.sc);
    const file = path.join(v.root, 'Scaffold', '_system', 'events.jsonl');
    const good = v.sc.vault.log.read().events.length;
    writeFileSync(file, readFileSync(file, 'utf8') + '{"type":"attempt","id":"X');
    const log = new EventLog(path.dirname(file), { timezone: TZ, now: () => new Date() });
    const r = log.read();
    expect(r.events.length).toBe(good);
    expect(r.warnings[0]).toMatch(/last line is incomplete/);
    expect(log.repairTornTail()).toBe(true);
    expect(
      new EventLog(path.dirname(file), { timezone: TZ, now: () => new Date() }).read().bad_lines,
    ).toEqual([]);
    // appending after a torn line never glues the new event onto it
    writeFileSync(file, readFileSync(file, 'utf8') + '{"type":"attempt","id":"Y');
    v.sc.emit([{ type: 'taught', session_id: null, kc_ids: ['kc-si-z0'] }]);
    const after = new EventLog(path.dirname(file), { timezone: TZ, now: () => new Date() }).read();
    expect(after.events.length).toBe(good + 1);
    expect(after.bad_lines).toHaveLength(1);
  });
});

describe('event log lock (REL-04)', () => {
  it('takes over a stale lock and fails loudly on a live one', async () => {
    const v = makeVault();
    await seed(v.sc);
    const lock = path.join(v.root, 'Scaffold', '_system', 'events.lock');
    writeFileSync(lock, 'old pid');
    utimesSync(lock, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    expect(v.sc.emit([{ type: 'taught', session_id: null, kc_ids: ['kc-si-z0'] }])).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
    writeFileSync(lock, 'live pid');
    expect(() => v.sc.emit([{ type: 'taught', session_id: null, kc_ids: ['kc-si-z0'] }])).toThrow(
      /Another Scaffold process/,
    );
  });
});

describe('Windows paths and line endings', () => {
  it('handles spaces, Unicode, an apostrophe and long names (> 260 characters)', async () => {
    const deep = [
      'Basam’s Vault with spaces',
      'ünïcödé 日本語 Γ',
      'a'.repeat(60),
      'b'.repeat(60),
      'c'.repeat(60),
    ].join(path.sep);
    const v = makeVault({ name: deep });
    expect(v.root.length).toBeGreaterThan(260);
    await seed(v.sc);
    const note = v.sc.vault.readNote(conceptRel('kc-si-z0'))!;
    expect(note.data.title).toBe('Characteristic impedance (Z₀)');
    expect(rebuildVault(v.sc, {}, new Warnings()).kcs).toBe(2);
  });

  it('tolerates CRLF notes edited by the learner and keeps their line endings', async () => {
    const v = makeVault();
    await seed(v.sc);
    const abs = path.join(v.root, ...conceptRel('kc-si-gamma').split('/'));
    const crlf = readFileSync(abs, 'utf8')
      .replace(/\n/g, '\r\n')
      .replace('## In my words\r\n', '## In my words\r\nMy own words.\r\n');
    writeFileSync(abs, crlf);
    v.sc.vault.writeDerived(
      conceptRel('kc-si-gamma'),
      { status: 'fragile' },
      { questions: 'line one\nline two' },
    );
    const after = readFileSync(abs, 'utf8');
    expect(after.replace(/\r\n/g, '')).not.toContain('\n');
    expect(after).toContain('My own words.\r\n');
    expect(splitNote(after).eol).toBe('\r\n');
  });
});

describe('LM-13 schema migration and backups', () => {
  it('migrates a v0 log after taking a backup copy', async () => {
    const v = makeVault();
    const sys = path.join(v.root, 'Scaffold', '_system');
    await seed(v.sc);
    const lines = readFileSync(path.join(sys, 'events.jsonl'), 'utf8').trim().split('\n');
    const v0 = JSON.stringify({
      type: 'taught',
      id: 'V0TAUGHT0001',
      ts: '2026-10-01T10:00:00-04:00',
      session_id: null,
      kc: 'kc-si-z0',
    });
    writeFileSync(path.join(sys, 'events.jsonl'), [...lines, v0].join('\n') + '\n');
    writeFileSync(path.join(sys, 'schema-version'), '0\n');
    const sc = Scaffold.open(v.root, { clock: v.clock, ids: new SeqIds(), timezone: TZ });
    expect(readFileSync(path.join(sys, 'schema-version'), 'utf8').trim()).toBe('1');
    const backups = readdirSync(path.join(sys, 'backups')).filter((f) =>
      f.startsWith('events-pre-migration-v0'),
    );
    expect(backups).toHaveLength(1);
    expect(readFileSync(path.join(sys, 'backups', backups[0]!), 'utf8')).toContain('"kc":"kc-si-z0"');
    const taught = sc.events().find((e) => e.id === 'V0TAUGHT0001');
    expect(taught?.type === 'taught' && taught.kc_ids).toEqual(['kc-si-z0']);
  });

  it('keeps one dated backup per day with 14-day rotation', async () => {
    const v = makeVault();
    await seed(v.sc);
    const dir = path.join(v.root, 'Scaffold', '_system', 'backups');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'events-2026-09-01.jsonl'), 'old');
    writeFileSync(path.join(dir, 'events-2026-09-30.jsonl'), 'recent');
    writeFileSync(path.join(dir, 'unrelated.txt'), 'keep me');
    v.sc.emit([{ type: 'taught', session_id: null, kc_ids: ['kc-si-z0'] }]);
    const files = readdirSync(dir).sort();
    expect(files).toContain('events-2026-10-09.jsonl');
    expect(files).toContain('events-2026-09-30.jsonl');
    expect(files).toContain('unrelated.txt');
    expect(files).not.toContain('events-2026-09-01.jsonl');
  });
});

describe('generated fixture vault', () => {
  it('rebuild --restore-missing recreates every note from events, with zero unresolved links', () => {
    const b = standardFixture();
    const v = vaultFromEvents(b.events, FIXTURE_NOW, { name: 'Fixture Vault' });
    const w = new Warnings();
    const r = rebuildVault(v.sc, { restoreMissing: true }, w);
    expect(r.kcs).toBe(14);
    expect(r.subjects).toBe(3);
    expect(r.session_logs_written).toBe(6);
    expect(checkLinks(v.root)).toEqual([]);
    const gamma = v.sc.vault.readNote(conceptRel('kc-si-reflection-coefficient'))!;
    expect(gamma.data.status).toBe('forgotten');
    expect(gamma.data.misconception_active).toBe(true);
    expect(gamma.data.due).toBe(true);
    const subject = v.sc.vault.readText('Scaffold/Subjects/si-pi.md')!;
    expect(subject).toContain('```mermaid');
    expect(subject).toContain(':::forgotten');
    const log = v.sc.vault.readText('Scaffold/Sessions/S-2026-09-20-1.md')!;
    expect(log).toContain('> [!failure]');
    expect(log).toContain('Confident and wrong: 2');
    const ledger = v.sc.vault.readText('Scaffold/Learner/Misconceptions.md')!;
    expect(ledger).toContain('| M-0001 |');
  });

  it('rebuild is deterministic: a second run changes no file', () => {
    const v = vaultFromEvents(standardFixture().events, FIXTURE_NOW);
    rebuildVault(v.sc, { restoreMissing: true }, new Warnings());
    const snapshot = (): Record<string, string> => {
      const out: Record<string, string> = {};
      const walk = (d: string): void => {
        for (const n of readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, n.name);
          if (n.isDirectory()) walk(p);
          else if (n.name.endsWith('.md')) out[p] = readFileSync(p, 'utf8');
        }
      };
      walk(path.join(v.root, 'Scaffold'));
      return out;
    };
    const first = snapshot();
    const second = rebuildVault(v.sc, {}, new Warnings());
    expect(second.notes_written).toBe(0);
    expect(snapshot()).toEqual(first);
  });
});

describe('learner edits are folded into the event log', () => {
  it('prerequisite, section and answer-key edits become events', async () => {
    const v = makeVault();
    await seed(v.sc);
    const w = new Warnings();
    const q = addQuestion(
      v.sc,
      {
        kc_ids: ['kc-si-gamma'],
        qtype: 'predict',
        format: 'free',
        difficulty: 2,
        stem: 'A 50 Ω line ends in an open. What does the source see after 2·TD?',
        answer_key: 'The open: the reflection returns and the source sees an open circuit.',
        rubric: [{ id: 'R1', proposition: 'Γ = +1 at an open' }],
        hints: [
          'Which end matters?',
          'Recall Γ at an open.',
          'Γ = +1, so the wave doubles.',
          'Full answer: the source sees the open after the round trip.',
        ],
        created_by: 'claude-desktop',
      },
      w,
    );
    expect(q.lint.ok).toBe(true);
    const abs = (rel: string): string => path.join(v.root, ...rel.split('/'));
    const gammaFile = abs(conceptRel('kc-si-gamma'));
    let text = readFileSync(gammaFile, 'utf8');
    text = text
      .replace('prerequisites: [kc-si-z0]', 'prerequisites: []')
      .replace('## Explanation\n', '## Explanation\n\nMy explanation, edited in Obsidian.\n');
    writeFileSync(gammaFile, text);
    const qFile = abs(q.note);
    const qText = readFileSync(qFile, 'utf8');
    expect(qText).toContain('The open: the reflection');
    writeFileSync(qFile, qText.replace('The open: the reflection', 'An open circuit: the reflection'));
    v.sc.emit([
      { type: 'question_reviewed', question_id: q.question_id, verdict: 'ok', by: 'codex', notes: '' },
    ]);
    const r = syncFromVault(v.sc, new Warnings());
    const kcChange = r.changes.find((c) => c.kind === 'kc_updated' && c.id === 'kc-si-gamma')!;
    expect(kcChange.changed).toContain('prerequisites');
    expect(kcChange.changed).toContain('section:Explanation');
    const qChange = r.changes.find((c) => c.kind === 'question_updated')!;
    expect(qChange.changed).toEqual(['answer_key']);
    expect(v.sc.facts().questions[q.question_id]!.verdict).toBe('pending');
    expect(syncFromVault(v.sc, new Warnings()).changes).toEqual([]);
  });

  it('upsert_concept never overwrites learner text in Explanation', async () => {
    const v = makeVault();
    await seed(v.sc);
    const w = new Warnings();
    upsertConcepts(
      v.sc,
      {
        id: 'kc-si-z0',
        title: 'Characteristic impedance (Z₀)',
        subject: 'si-pi',
        explanation: 'A different explanation',
      },
      w,
    );
    expect(v.sc.vault.readText(conceptRel('kc-si-z0'))).toContain('Z₀ is what a fast edge sees.');
    expect(v.sc.vault.readText(conceptRel('kc-si-z0'))).not.toContain('A different explanation');
    expect(w.items.join(' ')).toMatch(/belongs to the learner/);
  });

  it('rejects derived fields, dangling ids and cycles on input', async () => {
    const v = makeVault();
    await seed(v.sc);
    const w = new Warnings();
    expect(() =>
      upsertConcepts(v.sc, { id: 'kc-si-x', title: 'X', subject: 'si-pi', status: 'solid' }, w),
    ).toThrow(/derived/);
    expect(() =>
      upsertConcepts(v.sc, { id: 'kc-si-x', title: 'X', subject: 'si-pi', prerequisites: ['kc-nope'] }, w),
    ).toThrow(/unknown KC/);
    expect(() =>
      upsertConcepts(
        v.sc,
        { id: 'kc-si-z0', title: 'Z0', subject: 'si-pi', prerequisites: ['kc-si-gamma'] },
        w,
      ),
    ).toThrow(/cycle/);
    await expect(upsertSubject(v.sc, { title: 'X', due: 3 }, w)).rejects.toThrow(/derived/);
  });
});

describe('doctor and validate', () => {
  it('report a healthy vault and specific problems', async () => {
    const v = makeVault({ obsidian: true });
    await seed(v.sc);
    // D-94: the CSS snippet counts as healthy only once it is turned on in Obsidian
    const appearance = path.join(v.root, '.obsidian', 'appearance.json');
    expect(doctorVault(v.sc, new Warnings()).find((c) => c.id === 'css')).toMatchObject({
      ok: false,
      warn: true,
      next_step: expect.stringMatching(/CSS snippets/),
    });
    writeFileSync(appearance, JSON.stringify({ enabledCssSnippets: ['other', 'scaffold'] }));
    const checks = doctorVault(v.sc, new Warnings());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(validateVault(v.sc, new Warnings()).ok).toBe(true);
    const lock = path.join(v.root, 'Scaffold', '_system', 'events.lock');
    writeFileSync(lock, 'stale');
    utimesSync(lock, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    expect(doctorVault(v.sc, new Warnings()).find((c) => c.id === 'lock')?.next_step).toMatch(/Delete/);
  });

  it('a missing vault fails loudly with a next step (REL-03)', () => {
    expect(() => Vault.open(path.join(tempDir(), 'nope'))).toThrow(/Vault folder not found/);
    const empty = tempDir();
    try {
      Vault.open(empty);
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe('vault_not_initialized');
      expect((e as { next_step: string }).next_step).toMatch(/scaffold init/);
    }
    expect(() => Scaffold.open(empty, { clock: new FakeClock(FIXTURE_NOW) })).toThrow();
  });
});
