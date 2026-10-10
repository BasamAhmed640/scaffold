// Anki search strings (ANK-01 custom stacks, sync queries) and a small evaluator for the subset of
// the search syntax Scaffold writes: `tag:`, `deck:`, `is:suspended`, `is:new`, `-`, `( … )`, `OR`,
// implicit AND, and double quotes. Tags and decks match hierarchically, as in Anki: `tag:kc::a`
// matches `kc::a` and `kc::a::…`; `deck:A` matches A and its subdecks, by current or home deck.

export interface SearchableCard {
  deck: string;
  /** The card's home deck when it sits in a filtered deck; otherwise its deck. */
  home_deck: string;
  tags: string[];
  suspended: boolean;
  /** Anki card type: 0 new, 1 learning, 2 review, 3 relearning. */
  type: number;
}

/** Escapes Anki wildcards and quotes inside a search value. */
export function escapeValue(v: string): string {
  return v.replace(/[\\"*_]/g, (c) => `\\${c}`);
}

/** One search term, quoted when it holds spaces or parentheses. */
export function term(kind: 'tag' | 'deck', value: string): string {
  const t = `${kind}:${escapeValue(value)}`;
  return /[\s()]/.test(t) ? `"${t}"` : t;
}

export const any = (terms: string[]): string => (terms.length === 1 ? terms[0]! : `(${terms.join(' OR ')})`);

type Node =
  { k: 'term'; v: string } | { k: 'not'; a: Node } | { k: 'and'; a: Node[] } | { k: 'or'; a: Node[] };

function tokenize(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      out.push(c);
      i++;
      continue;
    }
    let tok = '';
    let quoted = false;
    if (c === '-' && s[i + 1] !== undefined && !/\s/.test(s[i + 1]!)) {
      out.push('-');
      i++;
      continue;
    }
    while (i < s.length) {
      const d = s[i]!;
      if (d === '\\' && i + 1 < s.length) {
        tok += d + s[i + 1]!;
        i += 2;
        continue;
      }
      if (d === '"') {
        quoted = !quoted;
        i++;
        continue;
      }
      if (!quoted && (/\s/.test(d) || d === '(' || d === ')')) break;
      tok += d;
      i++;
    }
    if (quoted) throw new Error(`unbalanced quote in search: ${s}`);
    out.push(tok);
  }
  return out;
}

export function parseSearch(s: string): Node {
  const toks = tokenize(s);
  let p = 0;
  const peek = (): string | undefined => toks[p];
  function orExpr(): Node {
    const parts = [andExpr()];
    while (peek()?.toUpperCase() === 'OR') {
      p++;
      parts.push(andExpr());
    }
    return parts.length === 1 ? parts[0]! : { k: 'or', a: parts };
  }
  function andExpr(): Node {
    const parts: Node[] = [];
    while (p < toks.length && peek() !== ')' && peek()?.toUpperCase() !== 'OR') {
      if (peek()?.toUpperCase() === 'AND') {
        p++;
        continue;
      }
      parts.push(unary());
    }
    if (parts.length === 0) throw new Error(`empty expression in search: ${s}`);
    return parts.length === 1 ? parts[0]! : { k: 'and', a: parts };
  }
  function unary(): Node {
    const t = toks[p++];
    if (t === '-') return { k: 'not', a: unary() };
    if (t === '(') {
      const n = orExpr();
      if (toks[p++] !== ')') throw new Error(`missing ) in search: ${s}`);
      return n;
    }
    if (t === undefined || t === ')') throw new Error(`unexpected end of search: ${s}`);
    return { k: 'term', v: t };
  }
  const n = orExpr();
  if (p !== toks.length) throw new Error(`unexpected "${toks[p]}" in search: ${s}`);
  return n;
}

const unescape = (v: string): string => v.replace(/\\(.)/g, '$1');

/** Hierarchical, case-insensitive match of an Anki name (`A::B` matches `A::B` and `A::B::C`). */
function hier(name: string, want: string): boolean {
  const n = name.toLowerCase();
  const w = want.toLowerCase();
  return n === w || n.startsWith(`${w}::`);
}

function matchTerm(t: string, c: SearchableCard): boolean {
  const i = t.indexOf(':');
  if (i === -1) throw new Error(`unsupported bare search term "${t}"`);
  const key = t.slice(0, i).toLowerCase();
  const value = unescape(t.slice(i + 1));
  switch (key) {
    case 'tag':
      return c.tags.some((x) => hier(x, value));
    case 'deck':
      return hier(c.deck, value) || hier(c.home_deck, value);
    case 'is':
      if (value === 'suspended') return c.suspended;
      if (value === 'new') return c.type === 0;
      if (value === 'review') return c.type === 2 || c.type === 3;
      if (value === 'learn') return c.type === 1 || c.type === 3;
      throw new Error(`unsupported search term "${t}"`);
    default:
      throw new Error(`unsupported search term "${t}"`);
  }
}

function evaluate(n: Node, c: SearchableCard): boolean {
  switch (n.k) {
    case 'term':
      return matchTerm(n.v, c);
    case 'not':
      return !evaluate(n.a, c);
    case 'and':
      return n.a.every((x) => evaluate(x, c));
    case 'or':
      return n.a.some((x) => evaluate(x, c));
  }
}

/** The cards a search string selects (the evaluator behind the mock server and the stack tests). */
export function select<T extends SearchableCard>(query: string, cards: T[]): T[] {
  const n = parseSearch(query);
  return cards.filter((c) => evaluate(n, c));
}
