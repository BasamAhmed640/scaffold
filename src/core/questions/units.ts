// Minimal unit parsing for numeric answers (REL-02): SI prefixes, common electrical and length
// units, compound units with "/" or "per". Converts both sides to SI before comparing.

const PREFIX: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  c: 1e-2,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

/** base symbol → [SI dimension key, factor to SI] */
const BASE: Record<string, [string, number]> = {
  Ω: ['ohm', 1],
  V: ['V', 1],
  A: ['A', 1],
  s: ['s', 1],
  Hz: ['Hz', 1],
  m: ['m', 1],
  F: ['F', 1],
  H: ['H', 1],
  W: ['W', 1],
  S: ['S', 1],
  J: ['J', 1],
  C: ['C', 1],
  dB: ['dB', 1],
  '%': ['%', 1],
  in: ['m', 0.0254],
  mil: ['m', 2.54e-5],
  ft: ['m', 0.3048],
  '1': ['1', 1],
};

const ALIASES: [RegExp, string][] = [
  [/^(ohms?|Ω|Ω)$/i, 'Ω'],
  [/^volts?$/i, 'V'],
  [/^(amps?|amperes?)$/i, 'A'],
  [/^(sec|secs|seconds?)$/i, 's'],
  [/^hertz$/i, 'Hz'],
  [/^(meters?|metres?)$/i, 'm'],
  [/^farads?$/i, 'F'],
  [/^henr(y|ies|ys)$/i, 'H'],
  [/^watts?$/i, 'W'],
  [/^(siemens|mhos?)$/i, 'S'],
  [/^(inch|inches|")$/i, 'in'],
  [/^mils?$/i, 'mil'],
  [/^(feet|foot)$/i, 'ft'],
  [/^(decibels?|db)$/i, 'dB'],
  [/^(percent|pct)$/i, '%'],
  [/^(dimensionless|unitless|none)$/i, '1'],
];

const WORD_PREFIX: [RegExp, string][] = [
  [/^pico/i, 'p'],
  [/^nano/i, 'n'],
  [/^micro/i, 'u'],
  [/^milli/i, 'm'],
  [/^centi/i, 'c'],
  [/^kilo/i, 'k'],
  [/^mega/i, 'M'],
  [/^giga/i, 'G'],
];

export interface ParsedUnit {
  /** e.g. "m/s" or "ohm" — the dimension signature after removing prefixes. */
  dim: string;
  /** factor to SI */
  factor: number;
}

function parseAtom(raw: string): ParsedUnit | null {
  let s = raw.trim();
  if (!s) return null;
  // spelled-out prefix: "nanoseconds", "kilohms"
  for (const [re, p] of WORD_PREFIX) {
    if (re.test(s)) {
      const rest = s.replace(re, '');
      const alias = ALIASES.find(([r]) => r.test(rest) || r.test(rest.replace(/^h/, 'oh')));
      if (alias) {
        const b = BASE[alias[1]]!;
        return { dim: b[0], factor: PREFIX[p]! * b[1] };
      }
    }
  }
  const alias = ALIASES.find(([r]) => r.test(s));
  if (alias) s = alias[1];
  if (BASE[s]) return { dim: BASE[s]![0], factor: BASE[s]![1] };
  // symbol with SI prefix: "ns", "kΩ", "pF", "mV"
  const first = [...s][0]!;
  const rest = s.slice(first.length);
  if (PREFIX[first] !== undefined) {
    const restAlias = ALIASES.find(([r]) => r.test(rest));
    const base = restAlias ? restAlias[1] : rest;
    if (BASE[base] && base !== '%' && base !== '1')
      return { dim: BASE[base]![0], factor: PREFIX[first]! * BASE[base]![1] };
  }
  return null;
}

/** Parses "in/ns", "ps per inch", "kΩ", "1". Returns null when the unit is not understood. */
export function parseUnit(raw: string): ParsedUnit | null {
  const s = raw
    .trim()
    .replace(/\s+per\s+/gi, '/')
    .replace(/\s*\/\s*/g, '/');
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length > 2) return null;
  const num = parseAtom(parts[0]!);
  if (!num) return null;
  if (parts.length === 1) return num;
  const den = parseAtom(parts[1]!);
  if (!den) return null;
  return { dim: `${num.dim}/${den.dim}`, factor: num.factor / den.factor };
}

export interface ParsedQuantity {
  value: number;
  unitText: string;
}

const NUMBER = /[-+−]?(?:\d+(?:[.,]\d+)?|\.\d+)(?:\s*[eE×x]\s*(?:10\^?)?[-+−]?\d+)?/g;

function toNumber(raw: string): number {
  let s = raw.replace(/−/g, '-').replace(/\s+/g, '');
  const sci = /^([-+]?[\d.,]+)(?:[×x]10\^?|[eE])([-+]?\d+)$/.exec(s);
  if (sci) return Number(sci[1]!.replace(',', '.')) * 10 ** Number(sci[2]);
  s = s.replace(',', '.');
  return Number(s);
}

/** Extracts the answer quantity: the number after the last "=", else the first number. */
export function parseQuantity(answer: string): ParsedQuantity | null {
  const text = answer.replace(/s/g, ' '); // s also matches a no-break space
  const eq = text.lastIndexOf('=');
  const scope = eq >= 0 ? text.slice(eq + 1) : text;
  NUMBER.lastIndex = 0;
  const m = NUMBER.exec(scope);
  if (!m) return null;
  let value = toNumber(m[0]);
  if (!Number.isFinite(value)) return null;
  let after = scope.slice(m.index + m[0].length);
  // a simple fraction: "-1/3"
  const frac = /^\s*\/\s*(\d+(?:\.\d+)?)(?![\d.])/.exec(after);
  if (frac && Number(frac[1]) !== 0) {
    value = value / Number(frac[1]);
    after = after.slice(frac[0].length);
  }
  const unitMatch = /^\s*([A-Za-zΩΩµμ%"]+(?:\s*(?:\/|per)\s*[A-Za-zΩΩµμ"]+)?)/.exec(after);
  return { value, unitText: unitMatch ? unitMatch[1]! : '' };
}
