import type { DerivedState } from '../model/derive.js';
import { ancestors } from '../model/graph.js';
import type { SubjectFields } from '../schemas/subject.js';
import type { MirrorCard } from './mirror.js';

// ANK-06 protected set: never proposed for dormancy automatically.
//  - every anchor card;
//  - cards of `introduced` and `fragile` KCs in active subjects (still consolidating);
//  - cards of KCs that any active subject's frontier depends on, transitively.

/** Frontier KCs of active subjects: unseen or introduced, every prerequisite fragile, solid or forgotten. */
export function activeFrontier(derived: DerivedState, subjects: SubjectFields[]): string[] {
  const active = new Set(subjects.filter((s) => s.scope === 'active').map((s) => s.id));
  const ready = (id: string): boolean => {
    const s = derived.kcs[id]?.status;
    return s === 'fragile' || s === 'solid' || s === 'forgotten';
  };
  return Object.values(derived.kcs)
    .filter(
      (k) =>
        active.has(k.subject) &&
        (k.status === 'unseen' || k.status === 'introduced') &&
        k.prerequisites.every(ready),
    )
    .map((k) => k.id);
}

export interface ProtectedSet {
  kcs: Set<string>;
  isProtected(card: MirrorCard): boolean;
  /** Why a card is protected (for messages), or null. */
  reason(card: MirrorCard): string | null;
}

export function protectedSet(derived: DerivedState, subjects: SubjectFields[]): ProtectedSet {
  const active = new Set(subjects.filter((s) => s.scope === 'active').map((s) => s.id));
  const consolidating = new Set(
    Object.values(derived.kcs)
      .filter((k) => active.has(k.subject) && (k.status === 'introduced' || k.status === 'fragile'))
      .map((k) => k.id),
  );
  const nodes = Object.values(derived.kcs).map((k) => ({ id: k.id, prerequisites: k.prerequisites }));
  const frontierDeps = ancestors(nodes, activeFrontier(derived, subjects));
  const kcs = new Set([...consolidating, ...frontierDeps]);
  const reason = (c: MirrorCard): string | null => {
    if (c.anchor) return 'anchor card';
    const k = c.kc_ids.find((id) => consolidating.has(id));
    if (k) return `${k} is still consolidating (${derived.kcs[k]?.status})`;
    const d = c.kc_ids.find((id) => frontierDeps.has(id));
    if (d) return `an active subject's frontier depends on ${d}`;
    return null;
  };
  return { kcs, isProtected: (c) => reason(c) !== null, reason };
}
