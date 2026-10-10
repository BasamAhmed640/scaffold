import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { flagStaleFromChanges, reviewByFlags } from './anki/stale.js';
import path from 'node:path';
import type { Warnings } from '../envelope.js';
import { sha256 } from '../ids.js';
import { KcFields, STALENESS_SECTIONS } from '../schemas/kc.js';
import { SubjectFields } from '../schemas/subject.js';
import { sectionText } from '../vault/markers.js';
import { FOLDERS } from '../vault/vault.js';
import { keyHash, loadBank, type BankLoad } from './bank.js';
import type { EventDraft, Scaffold } from './scaffold.js';

// Learner edits made in Obsidian are folded into the event log, so the log stays the single
// history (ARC-08) and staleness can be detected (ANK-05).

const KC_KEYS = Object.keys(KcFields.shape) as (keyof KcFields)[];
const SUBJECT_KEYS = Object.keys(SubjectFields.shape) as (keyof SubjectFields)[];

function pick<T extends string>(data: Record<string, unknown>, keys: readonly T[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (data[k] !== undefined && data[k] !== null) out[k] = data[k];
  // null is meaningful for review_by
  if ((keys as readonly string[]).includes('review_by') && data.review_by === null) out.review_by = null;
  return out;
}

const canon = (v: unknown): string => JSON.stringify(v);

export function normalizeSection(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function sectionHashes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of STALENESS_SECTIONS) out[s] = sha256(normalizeSection(sectionText(body, s))).slice(0, 16);
  return out;
}

/** Resolves a source reference like "[[Bogatin SPI ch7 notes]]" to a vault file, Obsidian-style. */
export class SourceResolver {
  private index: Map<string, string> | null = null;
  constructor(private readonly vaultRoot: string) {}

  resolve(ref: string): string | null {
    const m = /^\s*!?\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(ref);
    const target = (m ? m[1]! : ref).trim();
    if (!target) return null;
    const withExt = /\.[a-z0-9]+$/i.test(target) ? target : `${target}.md`;
    const direct = path.join(this.vaultRoot, ...withExt.split('/'));
    if (existsSync(direct)) return direct;
    const inSources = path.join(this.vaultRoot, 'Scaffold', 'Sources', path.basename(withExt));
    if (existsSync(inSources)) return inSources;
    return this.byBasename().get(path.basename(withExt).toLowerCase()) ?? null;
  }

  private byBasename(): Map<string, string> {
    if (this.index) return this.index;
    const index = new Map<string, string>();
    let budget = 20_000; // bounded walk (ARC-10)
    const walk = (dir: string): void => {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        return;
      }
      for (const n of names) {
        if (budget-- <= 0) return;
        if (n.startsWith('.') || n === 'node_modules') continue;
        const abs = path.join(dir, n);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(abs);
        else if (!index.has(n.toLowerCase())) index.set(n.toLowerCase(), abs);
      }
    };
    walk(this.vaultRoot);
    this.index = index;
    return index;
  }

  hash(ref: string): string {
    const f = this.resolve(ref);
    if (!f) return 'missing';
    try {
      return sha256(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).slice(0, 16);
    } catch {
      return 'unreadable';
    }
  }
}

export interface SyncChange {
  kind:
    | 'subject_created'
    | 'subject_updated'
    | 'scope_changed'
    | 'kc_created'
    | 'kc_updated'
    | 'question_added'
    | 'question_updated';
  id: string;
  changed: string[];
  from?: string;
  to?: string;
}

export interface SyncResult {
  changes: SyncChange[];
  bank: BankLoad;
}

/** Scans Subjects/, Concepts/ and Questions/ and emits events for learner edits. */
export function syncFromVault(sc: Scaffold, w: Warnings): SyncResult {
  const facts = sc.facts(w);
  const drafts: EventDraft[] = [];
  const changes: SyncChange[] = [];

  for (const rel of sc.vault.listMarkdown(FOLDERS.subjects)) {
    let note;
    try {
      note = sc.vault.readNote(rel);
    } catch (e) {
      w.add(`${rel}: ${(e as Error).message}`);
      continue;
    }
    if (!note) continue;
    const parsed = SubjectFields.safeParse(pick(note.data, SUBJECT_KEYS));
    if (!parsed.success) {
      w.add(
        `${rel}: not a valid subject note (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}).`,
      );
      continue;
    }
    const s = parsed.data;
    const prev = facts.subjects[s.id];
    if (!prev) {
      drafts.push({ type: 'subject_created', subject: s });
      changes.push({ kind: 'subject_created', id: s.id, changed: [] });
      continue;
    }
    const { scope: _a, ...restNew } = s;
    const { scope: _b, ...restOld } = prev.fields;
    const changed = SUBJECT_KEYS.filter(
      (k) =>
        k !== 'scope' &&
        canon(restNew[k as keyof typeof restNew]) !== canon(restOld[k as keyof typeof restOld]),
    );
    if (changed.length > 0) {
      drafts.push({ type: 'subject_updated', subject: { ...s, scope: prev.fields.scope }, changed });
      changes.push({ kind: 'subject_updated', id: s.id, changed });
    }
    if (s.scope !== prev.fields.scope) {
      drafts.push({ type: 'subject_scope_changed', subject_id: s.id, from: prev.fields.scope, to: s.scope });
      changes.push({
        kind: 'scope_changed',
        id: s.id,
        changed: ['scope'],
        from: prev.fields.scope,
        to: s.scope,
      });
      w.add(
        `${s.id}: scope was edited in the note (${prev.fields.scope} → ${s.scope}); recorded as a scope change (ANK-07).`,
      );
    }
  }

  const resolver = new SourceResolver(sc.vault.root);
  for (const rel of sc.vault.listMarkdown(FOLDERS.concepts)) {
    let note;
    try {
      note = sc.vault.readNote(rel);
    } catch (e) {
      w.add(`${rel}: ${(e as Error).message}`);
      continue;
    }
    if (!note) continue;
    const parsed = KcFields.safeParse(pick(note.data, KC_KEYS));
    if (!parsed.success) {
      w.add(
        `${rel}: not a valid concept note (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}).`,
      );
      continue;
    }
    const kc = parsed.data;
    const fileId = rel.split('/').pop()!.replace(/\.md$/, '');
    if (kc.id !== fileId) {
      w.add(`${rel}: id ${kc.id} does not match the file name; KC ids are never renamed (LM-01).`);
      continue;
    }
    const sh = sectionHashes(note.split.body);
    const src: Record<string, string> = {};
    for (const s of kc.sources) src[s] = resolver.hash(s);
    const prev = facts.kcs[kc.id];
    if (!prev) {
      drafts.push({ type: 'kc_created', kc, section_hashes: sh, source_hashes: src });
      changes.push({ kind: 'kc_created', id: kc.id, changed: [] });
      continue;
    }
    const changed: string[] = KC_KEYS.filter((k) => canon(kc[k]) !== canon(prev.fields[k]));
    for (const [k, h] of Object.entries(sh))
      if (prev.section_hashes[k] !== undefined && prev.section_hashes[k] !== h) changed.push(`section:${k}`);
    for (const [k, h] of Object.entries(src))
      if (prev.source_hashes[k] !== undefined && prev.source_hashes[k] !== h) changed.push(`source:${k}`);
    const newKeys =
      Object.keys(sh).some((k) => prev.section_hashes[k] === undefined) ||
      Object.keys(src).some((k) => prev.source_hashes[k] === undefined);
    if (changed.length > 0 || newKeys) {
      drafts.push({ type: 'kc_updated', kc_id: kc.id, kc, changed, section_hashes: sh, source_hashes: src });
      if (changed.length > 0) changes.push({ kind: 'kc_updated', id: kc.id, changed });
    }
  }

  const bank = loadBank(sc);
  for (const issue of bank.issues) w.add(`${issue.rel}: ${issue.message}`);
  for (const { question: q } of bank.entries) {
    const prev = facts.questions[q.id];
    const kh = keyHash(q);
    const mids = q.misconception_targets.map((t) => t.misconception_id).filter((x): x is string => !!x);
    if (!prev) {
      const { id: _id, review: _r, stats: _s, ...input } = q;
      drafts.push({ type: 'question_added', question_id: q.id, question: input, key_hash: kh });
      changes.push({ kind: 'question_added', id: q.id, changed: [] });
      continue;
    }
    const changed: string[] = [];
    if (prev.key_hash !== kh) changed.push('answer_key');
    if (canon(prev.kc_ids) !== canon(q.kc_ids)) changed.push('kc_ids');
    if (canon([...prev.misconception_ids].sort()) !== canon([...mids].sort()))
      changed.push('misconception_targets');
    if (changed.length > 0) {
      drafts.push({
        type: 'question_updated',
        question_id: q.id,
        kc_ids: q.kc_ids,
        changed,
        key_hash: kh,
        misconception_ids: mids,
      });
      changes.push({ kind: 'question_updated', id: q.id, changed });
    }
  }

  sc.emit(drafts);
  // ANK-05: edits to explanations, keys and sources flag the linked cards; so does a passed review_by.
  flagStaleFromChanges(sc, changes, w);
  reviewByFlags(sc, w);
  return { changes, bank };
}
