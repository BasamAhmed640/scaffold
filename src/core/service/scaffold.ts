import type { Config } from '../config.js';
import { Warnings } from '../envelope.js';
import { nextNumberedId } from '../ids.js';
import { deriveState, type DerivedState } from '../model/derive.js';
import type { LearnerFacts } from '../model/facts.js';
import { applyEvent, emptyFacts } from '../model/reducer.js';
import { parseEvent, type ScaffoldEvent } from '../schemas/events.js';
import type { SubjectFields } from '../schemas/subject.js';
import { localDate } from '../time.js';
import { FOLDERS, Vault, type VaultOptions } from '../vault/vault.js';

// The service core (IF-01): one implementation behind both the CLI and the MCP server.
// It calls no LLM. All durable state is in the vault; derived state is a fold over events.

export type EventDraft = { type: ScaffoldEvent['type']; id?: string; ts?: string } & Record<string, unknown>;

export interface ScaffoldDeps {
  /** AnkiConnect client (M6); absent in pure-core tests. */
  anki?: unknown;
}

export class Scaffold {
  readonly vault: Vault;
  readonly deps: ScaffoldDeps;
  private factsCache: { count: number; lastId: string | null; facts: LearnerFacts } | null = null;

  constructor(vault: Vault, deps: ScaffoldDeps = {}) {
    this.vault = vault;
    this.deps = deps;
  }

  static open(root: string, opts: VaultOptions = {}, deps: ScaffoldDeps = {}): Scaffold {
    return new Scaffold(Vault.open(root, opts), deps);
  }

  cfg(): Config {
    return this.vault.config();
  }

  tz(): string {
    return this.vault.tz();
  }

  now(): Date {
    return this.vault.now();
  }

  events(w?: Warnings): ScaffoldEvent[] {
    const r = this.vault.log.read();
    for (const m of r.warnings) w?.add(m);
    return r.events;
  }

  facts(w?: Warnings): LearnerFacts {
    const events = this.events(w);
    const lastId = events.length ? events[events.length - 1]!.id : null;
    if (this.factsCache && this.factsCache.count === events.length && this.factsCache.lastId === lastId)
      return this.factsCache.facts;
    const facts = emptyFacts();
    for (const e of events) applyEvent(facts, e);
    this.factsCache = { count: events.length, lastId, facts };
    return facts;
  }

  derived(now: Date = this.now(), w?: Warnings): DerivedState {
    return deriveState(this.facts(w), this.cfg(), now, { timezone: this.tz() });
  }

  subjects(w?: Warnings): SubjectFields[] {
    return Object.values(this.facts(w).subjects).map((s) => s.fields);
  }

  /** Fills id/ts, validates (LM-03) and appends. Returns the events actually written (LM-04). */
  emit(drafts: EventDraft[]): ScaffoldEvent[] {
    if (drafts.length === 0) return [];
    const now = this.now();
    const ts = this.vault.nowIso();
    const events = drafts.map((d) =>
      parseEvent({ ...d, id: d.id ?? this.vault.ids.eventId(now), ts: d.ts ?? ts }),
    );
    const written = this.vault.log.append(events);
    if (written.length > 0 && this.factsCache) {
      // keep the cache warm: apply the new events incrementally (ARC-08 equivalence is tested)
      const read = this.vault.log.read().events;
      for (const e of written) applyEvent(this.factsCache.facts, e);
      this.factsCache.count = read.length;
      this.factsCache.lastId = read.length ? read[read.length - 1]!.id : null;
    }
    return written;
  }

  /** Next id with a prefix, considering events and files on disk (hand-made notes). */
  nextId(prefix: 'Q' | 'V' | 'M' | 'P' | 'CA'): string {
    const f = this.facts();
    const ids: string[] = [];
    if (prefix === 'Q') {
      ids.push(...Object.keys(f.questions));
      ids.push(
        ...this.vault.listMarkdown(FOLDERS.questions).map((p) => p.split('/').pop()!.replace(/\.md$/, '')),
      );
    } else if (prefix === 'V') {
      ids.push(...Object.keys(f.visuals));
      ids.push(...this.vault.listDirs(FOLDERS.visuals));
    } else if (prefix === 'M') {
      ids.push(...Object.keys(f.misconceptions));
      for (const a of Object.values(f.attempts)) if (a.misconception_id) ids.push(a.misconception_id);
    } else if (prefix === 'P') ids.push(...Object.keys(f.card_proposals));
    else ids.push(...Object.keys(f.card_actions));
    return nextNumberedId(prefix, ids);
  }

  /** S-YYYY-MM-DD-n using the local date. */
  newSessionId(): string {
    const date = localDate(this.now(), this.tz());
    const n = Object.keys(this.facts().sessions).filter((id) => id.startsWith(`S-${date}-`)).length + 1;
    return `S-${date}-${n}`;
  }

  /** The open (started, not ended) session, if any. */
  openSession(): LearnerFacts['sessions'][string] | null {
    const f = this.facts();
    for (let i = f.session_order.length - 1; i >= 0; i--) {
      const s = f.sessions[f.session_order[i]!]!;
      if (!s.ended_ts) return s;
    }
    return null;
  }
}
