// VLT-05: the concept map is a minimal Mermaid flowchart subset: alphanumeric node ids, quoted
// labels, one classDef per status. Snapshot-tested as text; rendering is checked in Obsidian (V-UI).

import type { Status } from '../schemas/common.js';
import { cmp } from '../util.js';

export interface MapNode {
  id: string;
  title: string;
  status: Status;
  prerequisites: string[];
  misconception: boolean;
  /** true when the node belongs to another subject (a cross-subject prerequisite). */
  external?: boolean;
}

// Mid-tone fills with dark text read in both light and dark Obsidian themes.
const CLASS_DEFS: Record<Status | 'external' | 'mis', string> = {
  unseen: 'fill:#e8e6df,stroke:#8a877d,color:#2c2c2a',
  introduced: 'fill:#cfe0f5,stroke:#4a78b0,color:#14273f',
  fragile: 'fill:#f6dfa6,stroke:#b07d12,color:#3d2a00',
  solid: 'fill:#c4e6c8,stroke:#3c8a47,color:#10301a',
  forgotten: 'fill:#f3c4bd,stroke:#b34a3b,color:#3f0f08',
  external: 'stroke-dasharray:4 3',
  mis: 'stroke:#b3261e,stroke-width:3px',
};

export function escapeLabel(s: string): string {
  return s
    .replace(/"/g, '#quot;')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;'));
}

export function conceptMap(nodes: MapNode[]): string {
  const sorted = [...nodes].sort((a, b) => cmp(a.id, b.id));
  const idOf = new Map(sorted.map((n, i) => [n.id, `n${i + 1}`]));
  const lines = ['flowchart TD'];
  for (const n of sorted) lines.push(`  ${idOf.get(n.id)}["${escapeLabel(n.title)}"]:::${n.status}`);
  for (const n of sorted) {
    for (const p of [...n.prerequisites].sort(cmp)) {
      const from = idOf.get(p);
      if (from) lines.push(`  ${from} --> ${idOf.get(n.id)}`);
    }
  }
  const ext = sorted.filter((n) => n.external).map((n) => idOf.get(n.id)!);
  if (ext.length) lines.push(`  class ${ext.join(',')} external`);
  const mis = sorted.filter((n) => n.misconception).map((n) => idOf.get(n.id)!);
  if (mis.length) lines.push(`  class ${mis.join(',')} mis`);
  for (const [k, v] of Object.entries(CLASS_DEFS)) lines.push(`  classDef ${k} ${v}`);
  return ['```mermaid', ...lines, '```'].join('\n');
}
