// LM-12: prerequisites form one DAG across all subjects; edges may cross subjects.

export interface GraphNode {
  id: string;
  prerequisites: string[];
  confusable_with?: string[];
}

export interface GraphIssue {
  code: 'cycle' | 'dangling_prerequisite' | 'dangling_confusable' | 'self_reference';
  message: string;
  kc: string;
}

export function validateGraph(nodes: GraphNode[]): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    for (const p of n.prerequisites) {
      if (p === n.id)
        issues.push({ code: 'self_reference', kc: n.id, message: `${n.id} lists itself as a prerequisite` });
      else if (!ids.has(p))
        issues.push({
          code: 'dangling_prerequisite',
          kc: n.id,
          message: `${n.id}: unknown prerequisite ${p}`,
        });
    }
    for (const c of n.confusable_with ?? []) {
      if (!ids.has(c))
        issues.push({ code: 'dangling_confusable', kc: n.id, message: `${n.id}: unknown confusable ${c}` });
    }
  }
  for (const cycle of findCycles(nodes)) {
    issues.push({ code: 'cycle', kc: cycle[0]!, message: `prerequisite cycle: ${cycle.join(' → ')}` });
  }
  return issues;
}

/** Returns one representative cycle per strongly connected loop found (iterative DFS, bounded). */
export function findCycles(nodes: GraphNode[]): string[][] {
  const adj = new Map(nodes.map((n) => [n.id, n.prerequisites.filter((p) => p !== n.id)]));
  const color = new Map<string, 0 | 1 | 2>();
  const cycles: string[][] = [];
  for (const start of [...adj.keys()].sort()) {
    if (color.get(start)) continue;
    const stack: { id: string; i: number }[] = [{ id: start, i: 0 }];
    const path: string[] = [start];
    color.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const next = (adj.get(top.id) ?? [])[top.i];
      if (next === undefined) {
        color.set(top.id, 2);
        stack.pop();
        path.pop();
        continue;
      }
      top.i += 1;
      if (!adj.has(next)) continue;
      const c = color.get(next) ?? 0;
      if (c === 1) {
        const at = path.indexOf(next);
        cycles.push([...path.slice(at), next]);
      } else if (c === 0) {
        color.set(next, 1);
        stack.push({ id: next, i: 0 });
        path.push(next);
      }
    }
  }
  return cycles;
}

/** Topological order (prerequisites first); ties by depth then id. Ignores unknown ids and cycles. */
export function topoOrder(nodes: GraphNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const depth = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const d = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const n = byId.get(id);
    const prereqs = (n?.prerequisites ?? []).filter((p) => ids.has(p) && p !== id);
    const v = prereqs.length === 0 ? 0 : 1 + Math.max(...prereqs.map(d));
    visiting.delete(id);
    depth.set(id, v);
    return v;
  };
  return [...ids].sort((a, b) => d(a) - d(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** All transitive prerequisites of the given ids (a seed is included only if another seed needs it). */
export function ancestors(nodes: GraphNode[], of: Iterable<string>): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  const stack = [...of];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if (!out.has(p)) {
        out.add(p);
        stack.push(p);
      }
    }
  }
  return out;
}
