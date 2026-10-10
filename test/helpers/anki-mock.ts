import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnkiConnectClient } from '../../src/core/anki/client.js';
import { select } from '../../src/core/anki/search.js';

// A mock AnkiConnect (V-ANKI): an in-memory collection behind the same HTTP protocol, on 127.0.0.1.
// It records every request, can be taken offline (connection refused) and back, and simulates
// reviews with `answerCards`. Behaviour follows the AnkiConnect docs for API version 6.

export interface MockNote {
  id: number;
  model: string;
  fields: Record<string, string>;
  tags: string[];
  mod: number;
}

export interface MockCard {
  id: number;
  note: number;
  deck: string;
  /** Home deck while the card sits in a filtered deck. */
  odeck: string | null;
  type: number;
  queue: number;
  ivl: number;
  due: number;
  reps: number;
  lapses: number;
}

export interface MockRevlog {
  id: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

export interface Request {
  action: string;
  params: Record<string, unknown>;
}

export class MockAnki {
  decks = new Set<string>(['Default']);
  models = new Map<string, { fields: string[]; isCloze: boolean }>();
  notes = new Map<number, MockNote>();
  cards = new Map<number, MockCard>();
  revlog = new Map<number, MockRevlog[]>();
  requests: Request[] = [];
  version = 6;
  fsrs: boolean | 'unknown' = true;
  reflect: string[] = [];
  /** Clock for note/card ids and review times (ms). */
  now = Date.parse('2026-10-09T12:00:00Z');
  private seq = 0;
  private server: Server | null = null;
  port = 0;

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  client(timeoutMs = 2000): AnkiConnectClient {
    return new AnkiConnectClient(this.url, timeoutMs, 6);
  }

  async start(port = 0): Promise<this> {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (d: Buffer) => (body += d.toString('utf8')));
      req.on('end', () => {
        let result: unknown = null;
        let error: string | null = null;
        try {
          const { action, params, version } = JSON.parse(body) as {
            action: string;
            params?: Record<string, unknown>;
            version?: number;
          };
          if (version !== 6) throw new Error('unsupported version');
          this.requests.push({ action, params: params ?? {} });
          result = this.handle(action, params ?? {});
        } catch (e) {
          error = (e as Error).message;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result, error }));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  /** Anki closed: the port refuses connections until `start()` again (same port). */
  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server.closeAllConnections?.();
    this.server = null;
  }

  async restart(): Promise<void> {
    await this.start(this.port);
  }

  actions(): string[] {
    return this.requests.map((r) => r.action);
  }

  private nextId(): number {
    this.seq += 1;
    return this.now + this.seq;
  }

  /** Card view for the search evaluator. */
  view(c: MockCard) {
    const n = this.notes.get(c.note)!;
    return {
      card: c,
      deck: c.deck,
      home_deck: c.odeck ?? c.deck,
      tags: n.tags,
      suspended: c.queue === -1,
      type: c.type,
    };
  }

  find(query: string): MockCard[] {
    return select(
      query,
      [...this.cards.values()].map((c) => this.view(c)),
    ).map((v) => v.card);
  }

  /** Adds a note directly (fixture setup), returning its note and card ids. */
  seed(n: {
    deck: string;
    model?: string;
    fields: Record<string, string>;
    tags: string[];
    card?: Partial<MockCard>;
  }): { note: number; card: number } {
    const note = this.nextId();
    this.notes.set(note, {
      id: note,
      model: n.model ?? 'Scaffold Basic',
      fields: n.fields,
      tags: n.tags,
      mod: Math.floor(this.now / 1000),
    });
    const card = this.nextId();
    this.cards.set(card, {
      id: card,
      note,
      deck: n.deck,
      odeck: null,
      type: 0,
      queue: 0,
      ivl: 0,
      due: 0,
      reps: 0,
      lapses: 0,
      ...n.card,
    });
    return { note, card };
  }

  /** Simulates a review: ease 1 on a review card is a lapse. */
  answer(cardId: number, ease: number, timeMs = 8000): void {
    const c = this.cards.get(cardId)!;
    this.now += 60_000;
    const type = c.type === 0 ? 0 : c.type === 2 ? 1 : c.type === 3 ? 2 : 0;
    const last = c.ivl;
    if (ease === 1) {
      if (c.type === 2) c.lapses += 1;
      c.type = c.type === 2 ? 3 : 1;
      c.queue = 1;
      c.ivl = c.type === 3 ? 1 : 0;
    } else {
      c.type = 2;
      c.queue = 2;
      c.ivl = Math.max(1, Math.round((last || 1) * (ease === 2 ? 1.2 : ease === 3 ? 2.5 : 3.5)));
    }
    c.reps += 1;
    const list = this.revlog.get(cardId) ?? [];
    list.push({ id: this.now, usn: -1, ease, ivl: c.ivl, lastIvl: last, factor: 0, time: timeMs, type });
    this.revlog.set(cardId, list);
  }

  private handle(action: string, p: Record<string, unknown>): unknown {
    const ids = (k: string): number[] => ((p[k] as (number | string)[] | undefined) ?? []).map(Number);
    const tagList = (): string[] =>
      String(p.tags ?? '')
        .split(/\s+/)
        .filter(Boolean);
    switch (action) {
      case 'version':
        return this.version;
      case 'deckNames':
        return [...this.decks].sort();
      case 'createDeck': {
        const name = String(p.deck);
        const parts = name.split('::');
        for (let i = 1; i <= parts.length; i++) this.decks.add(parts.slice(0, i).join('::'));
        return this.nextId();
      }
      case 'modelNames':
        return [...this.models.keys()];
      case 'createModel': {
        const name = String(p.modelName);
        if (this.models.has(name)) throw new Error(`Model name already exists`);
        this.models.set(name, { fields: p.inOrderFields as string[], isCloze: !!p.isCloze });
        return { id: this.nextId(), name };
      }
      case 'findCards':
        return this.find(String(p.query)).map((c) => c.id);
      case 'findNotes':
        return [...new Set(this.find(String(p.query)).map((c) => c.note))];
      case 'cardsInfo':
        return ids('cards').map((id) => {
          const c = this.cards.get(id);
          if (!c) return {};
          const n = this.notes.get(c.note)!;
          const fields = Object.fromEntries(
            Object.entries(n.fields).map(([k, v], i) => [k, { value: v, order: i }]),
          );
          return {
            cardId: c.id,
            note: c.note,
            deckName: c.deck,
            modelName: n.model,
            fields,
            interval: c.ivl,
            type: c.type,
            queue: c.queue,
            due: c.due,
            reps: c.reps,
            lapses: c.lapses,
            mod: n.mod,
          };
        });
      case 'notesInfo':
        return ids('notes').map((id) => {
          const n = this.notes.get(id);
          if (!n) return {};
          const fields = Object.fromEntries(
            Object.entries(n.fields).map(([k, v], i) => [k, { value: v, order: i }]),
          );
          return {
            noteId: n.id,
            modelName: n.model,
            tags: [...n.tags],
            fields,
            mod: n.mod,
            cards: [...this.cards.values()].filter((c) => c.note === id).map((c) => c.id),
          };
        });
      case 'getReviewsOfCards':
        return Object.fromEntries(ids('cards').map((id) => [String(id), [...(this.revlog.get(id) ?? [])]]));
      case 'addNotes': {
        const notes = p.notes as {
          deckName: string;
          modelName: string;
          fields: Record<string, string>;
          tags: string[];
          options?: { allowDuplicate?: boolean };
        }[];
        const out: (number | null)[] = [];
        const errors: string[] = [];
        for (const n of notes) {
          if (!this.decks.has(n.deckName)) throw new Error(`deck was not found: ${n.deckName}`);
          if (!this.models.has(n.modelName)) throw new Error(`model was not found: ${n.modelName}`);
          const first = Object.values(n.fields)[0];
          const dup = [...this.notes.values()].some(
            (x) =>
              x.model === n.modelName &&
              Object.values(x.fields)[0] === first &&
              [...this.cards.values()].some((c) => c.note === x.id && c.deck === n.deckName),
          );
          if (dup && !n.options?.allowDuplicate) {
            out.push(null);
            errors.push('cannot create note because it is a duplicate');
            continue;
          }
          out.push(
            this.seed({ deck: n.deckName, model: n.modelName, fields: { ...n.fields }, tags: [...n.tags] })
              .note,
          );
        }
        if (errors.length && out.every((x) => x === null)) throw new Error(errors.join(', '));
        return out;
      }
      case 'updateNoteFields': {
        const note = p.note as { id: number; fields: Record<string, string> };
        const n = this.notes.get(Number(note.id));
        if (!n) throw new Error('note was not found');
        Object.assign(n.fields, note.fields);
        n.mod = Math.floor(this.now / 1000) + 1;
        return null;
      }
      case 'suspend':
        for (const id of ids('cards')) this.cards.get(id)!.queue = -1;
        return true;
      case 'unsuspend':
        for (const id of ids('cards')) {
          const c = this.cards.get(id)!;
          c.queue = c.type === 0 ? 0 : c.type === 2 ? 2 : 1;
        }
        return true;
      case 'forgetCards':
        for (const id of ids('cards'))
          Object.assign(this.cards.get(id)!, { type: 0, queue: 0, ivl: 0, due: 0 });
        return null;
      case 'addTags':
        for (const id of ids('notes')) {
          const n = this.notes.get(id)!;
          for (const t of tagList()) if (!n.tags.includes(t)) n.tags.push(t);
        }
        return null;
      case 'removeTags':
        for (const id of ids('notes')) {
          const n = this.notes.get(id)!;
          const drop = new Set(tagList().map((t) => t.toLowerCase()));
          n.tags = n.tags.filter((t) => !drop.has(t.toLowerCase()));
        }
        return null;
      case 'getDeckConfig':
        if (this.fsrs === 'unknown') return { id: 1, name: 'Default', new: { perDay: 20 } };
        return this.fsrs
          ? { id: 1, name: 'Default', fsrsWeights: [0.4, 0.6, 2.4, 5.8] }
          : { id: 1, name: 'Default', fsrsWeights: [], fsrs: false };
      case 'apiReflect':
        return {
          scopes: ['actions'],
          actions: this.reflect.length ? this.reflect : ['version', 'findCards', 'cardsInfo', 'addNotes'],
        };
      case 'answerCards':
        for (const a of p.answers as { cardId: number; ease: number }[])
          this.answer(Number(a.cardId), a.ease);
        return (p.answers as unknown[]).map(() => true);
      case 'changeDeck':
        for (const id of ids('cards')) {
          const c = this.cards.get(id)!;
          c.odeck ??= c.deck;
          c.deck = String(p.deck);
        }
        return null;
      default:
        throw new Error(`unsupported action: ${action}`);
    }
  }
}
