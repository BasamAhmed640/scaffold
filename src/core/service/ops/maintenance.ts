import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Warnings } from '../../envelope.js';
import { validateGraph } from '../../model/graph.js';
import { lintQuestion } from '../../questions/lint.js';
import { Question } from '../../schemas/question.js';
import { SCHEMA_VERSION } from '../../vault/eventlog.js';
import { checkLinks } from '../../vault/links.js';
import { conceptNote, questionNote, subjectNote } from '../../vault/notes.js';
import { conceptRel, FOLDERS, questionRel, subjectRel } from '../../vault/vault.js';
import { loadBank } from '../bank.js';
import type { Scaffold } from '../scaffold.js';
import { syncFromVault } from '../sync.js';
import { refreshNotes, writeSessionLog } from '../writers.js';
import { queueFor } from './anki-hooks.js';

// `scaffold rebuild` (ARC-08), `scaffold validate` (LM-12), `scaffold doctor` (VLT-04).

export function rebuildVault(sc: Scaffold, opts: { restoreMissing?: boolean }, w: Warnings) {
  const facts = sc.facts(w);
  let restored = 0;
  if (opts.restoreMissing) {
    for (const s of Object.values(facts.subjects))
      if (sc.vault.createText(subjectRel(s.fields.id), subjectNote(s.fields))) restored++;
    for (const k of Object.values(facts.kcs))
      if (sc.vault.createText(conceptRel(k.fields.id), conceptNote(k.fields))) restored++;
    const titles: Record<string, string> = {};
    for (const k of Object.values(facts.kcs)) titles[k.fields.id] = k.fields.title;
    for (const e of sc.events()) {
      if (e.type !== 'question_added' || sc.vault.exists(questionRel(e.question_id))) continue;
      const q = Question.parse({
        ...e.question,
        id: e.question_id,
        review: {
          by: facts.questions[e.question_id]?.reviewed_by ?? null,
          verdict: facts.questions[e.question_id]?.verdict ?? 'pending',
          notes: '',
        },
        stats: { attempts: 0, correct_rate: null, last_used: null },
      });
      if (sc.vault.createText(questionRel(q.id), questionNote(q, titles))) restored++;
    }
  } else {
    const missing = Object.keys(facts.kcs).filter((id) => !sc.vault.exists(conceptRel(id)));
    if (missing.length)
      w.add(
        `${missing.length} concept note(s) missing (e.g. ${missing[0]}); run \`scaffold rebuild --restore-missing\` to recreate them.`,
      );
  }
  const bank = loadBank(sc);
  const written = refreshNotes(sc, { all: true }, bank, w);
  let sessions = 0;
  for (const id of facts.session_order) if (writeSessionLog(sc, id, bank, w)) sessions++;
  return {
    events: facts.event_count,
    kcs: Object.keys(facts.kcs).length,
    subjects: Object.keys(facts.subjects).length,
    notes_written: written,
    session_logs_written: sessions,
    restored,
  };
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateVault(sc: Scaffold, w: Warnings): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const read = sc.vault.log.read();
  if (read.bad_lines.length) errors.push(...read.warnings);
  const { bank } = syncFromVault(sc, w);
  const facts = sc.facts();
  const nodes = Object.values(facts.kcs).map((k) => ({
    id: k.fields.id,
    prerequisites: k.fields.prerequisites,
    confusable_with: k.fields.confusable_with,
  }));
  for (const g of validateGraph(nodes)) errors.push(`LM-12 ${g.message}`);
  for (const k of Object.values(facts.kcs)) {
    if (!facts.subjects[k.fields.subject]) errors.push(`${k.fields.id}: unknown subject ${k.fields.subject}`);
    if (k.fields.volatility === 'volatile' && !k.fields.review_by)
      errors.push(`${k.fields.id}: volatile KC without review_by (ANK-05)`);
  }
  for (const i of bank.issues) errors.push(`${i.rel}: ${i.message}`);
  for (const { question } of bank.entries) {
    const l = lintQuestion(question);
    if (!l.ok) warnings.push(`${question.id}: ${l.errors[0]}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
  next_step?: string;
}

/** Vault-side health checks; Anki checks are added by the Anki layer. Never blocks (REL-03). */
export function doctorVault(sc: Scaffold, w: Warnings): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const add = (id: string, ok: boolean, message: string, next_step?: string): void => {
    checks.push(next_step && !ok ? { id, ok, message, next_step } : { id, ok, message });
  };
  add('vault', true, `Vault: ${sc.vault.root}`);
  for (const rel of [
    FOLDERS.system,
    FOLDERS.concepts,
    FOLDERS.subjects,
    FOLDERS.questions,
    FOLDERS.sessions,
    FOLDERS.visuals,
  ]) {
    const abs = sc.vault.abs(rel);
    if (!existsSync(abs)) {
      add(
        `folder:${rel}`,
        false,
        `${rel} is missing.`,
        'Run `scaffold init` on this vault to restore missing folders.',
      );
      continue;
    }
    if (!sc.vault.isWritable(rel))
      add(
        `folder:${rel}`,
        false,
        `${rel} is not writable.`,
        'Check folder permissions, or whether a sync tool locks the folder.',
      );
  }
  if (!checks.some((c) => c.id.startsWith('folder:')))
    add('folders', true, 'All Scaffold folders exist and are writable.');
  const v = sc.vault.log.schemaVersion();
  add(
    'schema',
    v === SCHEMA_VERSION,
    `Event schema v${v ?? '?'} (expected v${SCHEMA_VERSION}).`,
    'Run any Scaffold command once to migrate (a backup is made first).',
  );
  try {
    sc.cfg();
    add('config', true, 'config.json is valid.');
  } catch (e) {
    add('config', false, (e as Error).message, 'Fix Scaffold/_system/config.json.');
  }
  const read = sc.vault.log.read();
  add(
    'events',
    read.bad_lines.length === 0,
    read.bad_lines.length === 0
      ? `events.jsonl: ${read.events.length} valid events.`
      : read.warnings.join(' '),
    'Run `scaffold doctor --fix` (moves a torn last line to backups/).',
  );
  const lock = path.join(sc.vault.sys, 'events.lock');
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 30_000)
    add(
      'lock',
      false,
      'A stale events.lock exists.',
      'Delete Scaffold/_system/events.lock (no Scaffold process is running).',
    );
  const facts = sc.facts(w);
  const nodes = Object.values(facts.kcs).map((k) => ({
    id: k.fields.id,
    prerequisites: k.fields.prerequisites,
    confusable_with: k.fields.confusable_with,
  }));
  const graph = validateGraph(nodes);
  add(
    'graph',
    graph.length === 0,
    graph.length === 0 ? `Concept graph: ${nodes.length} KCs, no cycles or dangling ids.` : graph[0]!.message,
    'Run `scaffold validate` for the full list.',
  );
  const pending = queueFor(sc).count();
  add('queue', true, pending ? `${pending} Anki operation(s) queued.` : 'Anki queue is empty.');
  const css = path.join(sc.vault.root, '.obsidian', 'snippets', 'scaffold.css');
  if (existsSync(path.join(sc.vault.root, '.obsidian')))
    add(
      'css',
      existsSync(css),
      existsSync(css)
        ? 'CSS snippet installed (enable it in Settings → Appearance).'
        : 'CSS snippet not installed.',
      'Run `scaffold init` again to copy it.',
    );
  const links = checkLinks(sc.vault.root);
  add(
    'links',
    links.length === 0,
    links.length === 0
      ? 'No unresolved links in Scaffold notes.'
      : `${links.length} unresolved link(s), e.g. ${links[0]!.link} in ${links[0]!.file}.`,
    'Fix or remove the links.',
  );
  return checks;
}

export function doctorFix(sc: Scaffold): string[] {
  const done: string[] = [];
  if (sc.vault.log.repairTornTail())
    done.push('Repaired the torn last line of events.jsonl (kept a copy in backups/).');
  return done;
}
