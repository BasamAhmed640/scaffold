import type { Config } from '../config.js';
import type { DerivedState, KcState } from '../model/derive.js';
import type { LearnerFacts } from '../model/facts.js';
import { topoOrder } from '../model/graph.js';
import type { MisconceptionView } from '../model/misconceptions.js';
import { wordedAlike } from '../questions/similarity.js';
import type { QType } from '../schemas/common.js';
import type { Plan, PlanItem, PlanStep, StepName } from '../schemas/plan.js';
import type { SubjectFields } from '../schemas/subject.js';
import { ms } from '../time.js';
import { compareKeys, truncate } from '../util.js';
import type { FocusResult } from './focus.js';

// LM-10: deterministic planner. Every step draws only from the focus subject unless it says otherwise.

export interface BankQuestion {
  id: string;
  kc_ids: string[];
  qtype: QType;
  difficulty: number;
  stem: string;
  misconception_ids: string[];
  /** Only `ok` questions are served (QB-04). */
  verdict: 'pending' | 'ok' | 'fix' | 'reject';
}

export interface PlannerInput {
  facts: LearnerFacts;
  derived: DerivedState;
  subjects: SubjectFields[];
  cfg: Config;
  focus: FocusResult;
  minutes: number;
  carryover: number;
  questions: BankQuestion[];
  /** Anki card fronts per KC, so questions are not worded like the cards (LM-10 step 2). */
  ankiText: Record<string, string[]>;
}

/** Review categories, ranked: forgotten > misconception > needs_check > R below target > solid untested by transfer. */
export type ReviewCategory = 1 | 2 | 3 | 4 | 5;

export interface ReviewNeed {
  kc: KcState;
  category: ReviewCategory;
  why: string;
}

export function reviewNeed(k: KcState, cfg: Config): ReviewNeed | null {
  const learned = k.status === 'fragile' || k.status === 'solid' || k.status === 'forgotten';
  if (k.status === 'forgotten') return { kc: k, category: 1, why: `forgotten (${k.forgotten_reason})` };
  if (k.misconception_active)
    return { kc: k, category: 2, why: `active misconception ${k.misconceptions.join(', ')}` };
  if (!learned) return null;
  if (k.needs_check) return { kc: k, category: 3, why: `needs check (${k.needs_check_reason})` };
  if (k.memory && k.memory.retrievability < cfg.fsrs.desired_retention)
    return {
      kc: k,
      category: 4,
      why: `R ${k.memory.retrievability.toFixed(2)} < ${cfg.fsrs.desired_retention}`,
    };
  if (k.status === 'solid' && !k.tested_transfer)
    return { kc: k, category: 5, why: 'solid, never tested with transfer' };
  return null;
}

/** Retrievability, with "no memory yet" sorted after every real value. */
export function rOf(k: KcState): number {
  return k.memory ? k.memory.retrievability : 2;
}

function compareNeeds(a: ReviewNeed, b: ReviewNeed): number {
  return compareKeys(
    [a.category, rOf(a.kc), a.kc.subject, a.kc.id],
    [b.category, rOf(b.kc), b.kc.subject, b.kc.id],
  );
}

export function rankedNeeds(kcs: KcState[], cfg: Config): ReviewNeed[] {
  return kcs
    .map((k) => reviewNeed(k, cfg))
    .filter((n): n is ReviewNeed => n !== null)
    .sort(compareNeeds);
}

/** The review backlog: categories 1–4 (DECISIONS.md D-10). */
export function backlogCount(kcs: KcState[], cfg: Config): number {
  return rankedNeeds(kcs, cfg).filter((n) => n.category <= 4).length;
}

type Purpose = 'pretest' | 'review' | 'transfer' | 'repair' | 'new' | 'exit' | 'carryover';

/** Full orderings of all question types per purpose (most preferred first). */
const PREFERENCE: Record<Purpose, readonly QType[]> = {
  pretest: [
    'predict',
    'recall',
    'explain',
    'apply',
    'visual',
    'discriminate',
    'diagnose',
    'transfer',
    'teach-back',
  ],
  review: [
    'recall',
    'explain',
    'predict',
    'apply',
    'discriminate',
    'visual',
    'diagnose',
    'transfer',
    'teach-back',
  ],
  carryover: [
    'recall',
    'explain',
    'predict',
    'apply',
    'discriminate',
    'visual',
    'diagnose',
    'transfer',
    'teach-back',
  ],
  transfer: [
    'transfer',
    'apply',
    'diagnose',
    'predict',
    'explain',
    'discriminate',
    'visual',
    'recall',
    'teach-back',
  ],
  repair: [
    'diagnose',
    'discriminate',
    'predict',
    'explain',
    'apply',
    'visual',
    'transfer',
    'recall',
    'teach-back',
  ],
  new: [
    'predict',
    'recall',
    'explain',
    'apply',
    'visual',
    'discriminate',
    'diagnose',
    'transfer',
    'teach-back',
  ],
  exit: [
    'explain',
    'apply',
    'predict',
    'discriminate',
    'recall',
    'transfer',
    'visual',
    'diagnose',
    'teach-back',
  ],
};

/** Purposes that need a specific question type; otherwise the tutor improvises one of that type. */
const STRICT: Partial<Record<Purpose, QType[]>> = { transfer: ['transfer'] };

class QuestionPicker {
  private readonly used = new Set<string>();
  constructor(
    private readonly questions: BankQuestion[],
    private readonly derived: DerivedState,
    private readonly ankiText: Record<string, string[]>,
  ) {}

  pick(kcId: string, purpose: Purpose, misconceptionId?: string): { id: string | null; qtype?: QType } {
    const recent = new Set(this.derived.kcs[kcId]!.recent_question_keys);
    const cards = this.ankiText[kcId] ?? [];
    const pref = PREFERENCE[purpose];
    const strict = STRICT[purpose];
    const candidates = this.questions.filter(
      (q) =>
        q.verdict === 'ok' &&
        (!strict || strict.includes(q.qtype)) &&
        q.kc_ids.includes(kcId) &&
        !recent.has(q.id) &&
        !this.used.has(q.id) &&
        (purpose !== 'repair' || !misconceptionId || q.misconception_ids.includes(misconceptionId)) &&
        !cards.some((c) => wordedAlike(c, q.stem)),
    );
    const easyFirst = purpose === 'pretest' || purpose === 'new';
    const key = (q: BankQuestion): (number | string)[] => [
      pref.indexOf(q.qtype),
      q.kc_ids.length,
      easyFirst ? q.difficulty : 0,
      q.id,
    ];
    candidates.sort((a, b) => compareKeys(key(a), key(b)));
    const q = candidates[0];
    if (!q) return strict ? { id: null, qtype: strict[0]! } : { id: null };
    this.used.add(q.id);
    return { id: q.id, qtype: q.qtype };
  }
}

/** Put confusable_with pairs next to each other (interleaving), preserving rank order otherwise. */
export function interleaveConfusables<T extends { kc: string }>(items: T[], derived: DerivedState): T[] {
  const rest = [...items];
  const out: T[] = [];
  while (rest.length > 0) {
    const x = rest.shift()!;
    out.push(x);
    const kx = derived.kcs[x.kc]!;
    const j = rest.findIndex(
      (y) => kx.confusable_with.includes(y.kc) || derived.kcs[y.kc]!.confusable_with.includes(x.kc),
    );
    if (j >= 0) out.push(rest.splice(j, 1)[0]!);
  }
  return out;
}

function item(
  k: KcState,
  why: string,
  q: { id: string | null; qtype?: QType },
  extra: Partial<PlanItem> = {},
): PlanItem {
  const it: PlanItem = { kc: k.id, subject: k.subject, why, question_id: q.id, ...extra };
  if (q.qtype) it.qtype = q.qtype;
  return it;
}

export function planSession(input: PlannerInput): Plan {
  const { cfg, derived, focus } = input;
  const P = cfg.planner;
  const minutes = input.minutes;
  const carryover = Math.max(0, Math.min(2, Math.trunc(input.carryover)));
  const activeIds = new Set(input.subjects.filter((s) => s.scope === 'active').map((s) => s.id));
  const isAll = focus.subject === 'all';
  const inFocus = (k: KcState): boolean => (isAll ? activeIds.has(k.subject) : k.subject === focus.subject);
  const allKcs = Object.values(derived.kcs);
  const focusKcs = allKcs.filter(inFocus);
  const notes: string[] = [];
  const trimmed: string[] = [];
  const base = {
    focus: { subject: focus.subject, why: focus.why },
    minutes_requested: minutes,
    carryover,
  };

  if (!isAll && focusKcs.length === 0) {
    return {
      status: 'intake_required',
      ...base,
      minutes_planned: 0,
      steps: [],
      trimmed: [],
      notes: [
        `Subject ${focus.subject} has no KCs yet: run onboarding (D3.10) and save the approved KC map.`,
      ],
    };
  }

  const picker = new QuestionPicker(input.questions, derived, input.ankiText);
  const graphNodes = allKcs.map((k) => ({ id: k.id, prerequisites: k.prerequisites }));
  const topo = topoOrder(graphNodes);
  const topoIndex = new Map(topo.map((id, i) => [id, i]));
  const depthRank = (id: string): number => topoIndex.get(id)!;

  // 1. Pretest: only if no KC in the focus subject has an attempt yet (not on mixed days).
  let pretest: KcState[] = [];
  if (!isAll && focusKcs.every((k) => k.attempts === 0)) {
    pretest = [...focusKcs].sort((a, b) => depthRank(a.id) - depthRank(b.id)).slice(0, P.pretest_max);
  }

  // 4. Repair: the oldest active misconception in the focus subject.
  const openMs = derived.misconceptions
    .filter((m) => m.state === 'open' && m.kc_ids.some((id) => derived.kcs[id] && inFocus(derived.kcs[id])))
    .sort((a, b) => compareKeys([ms(a.since!), a.id], [ms(b.since!), b.id]));
  const repairM: MisconceptionView | undefined = openMs[0];
  const repairKc = repairM
    ? derived.kcs[repairM.kc_ids.find((id) => derived.kcs[id] && inFocus(derived.kcs[id]))!]
    : undefined;

  // 2. Warm-up: ranked review needs in the focus, excluding the repair KC.
  const focusNeeds = rankedNeeds(focusKcs, cfg).filter((n) => n.kc.id !== repairKc?.id);
  const warmup = focusNeeds.slice(0, P.warmup_max);

  // 3. Carry-over: urgent KCs from other active subjects (focused sessions only).
  let carry: ReviewNeed[] = [];
  if (!isAll && carryover > 0) {
    carry = rankedNeeds(
      allKcs.filter((k) => k.subject !== focus.subject && activeIds.has(k.subject)),
      cfg,
    )
      .filter((n) => n.category <= 3)
      .slice(0, carryover);
  }

  // 5. New: frontier KCs (all prerequisites at least fragile), unless the backlog is over the limit.
  const subjectsInScope = isAll ? [...activeIds].sort() : [focus.subject];
  const blocked = new Set<string>();
  for (const sid of subjectsInScope) {
    const count = backlogCount(
      allKcs.filter((k) => k.subject === sid),
      cfg,
    );
    if (count > P.backlog_blocks_new) {
      blocked.add(sid);
      notes.push(`Review backlog in ${sid} is ${count} (> ${P.backlog_blocks_new}): no new KCs there today.`);
    }
  }
  const ready = (id: string): boolean => {
    const s = derived.kcs[id]?.status;
    return s === 'fragile' || s === 'solid' || s === 'forgotten';
  };
  // A forgotten prerequisite in a paused or closed subject is never planned (paused subjects never
  // contribute), so its dependents wait until that subject is reopened (DECISIONS.md D-12).
  const inactiveForgotten = (k: KcState): string | undefined =>
    k.prerequisites.find((p) => {
      const pk = derived.kcs[p];
      return !!pk && pk.status === 'forgotten' && !activeIds.has(pk.subject);
    });
  const frontier = focusKcs
    .filter(
      (k) =>
        (k.status === 'unseen' || k.status === 'introduced') &&
        !k.misconception_active &&
        !blocked.has(k.subject) &&
        k.prerequisites.every(ready),
    )
    .filter((k) => {
      const p = inactiveForgotten(k);
      if (p)
        notes.push(
          `${k.id} waits: its prerequisite ${p} is forgotten in a paused or closed subject; reopen that subject first.`,
        );
      return !p;
    })
    .sort((a, b) =>
      compareKeys(
        [a.status === 'introduced' ? 0 : 1, depthRank(a.id), a.id],
        [b.status === 'introduced' ? 0 : 1, depthRank(b.id), b.id],
      ),
    )
    .slice(0, P.new_max);

  // Short sessions: trim carry-over, then new KCs, then warm-up (to 2), then pretest (to 3).
  const already = (): Set<string> =>
    new Set([
      ...warmup.map((n) => n.kc.id),
      ...carry.map((n) => n.kc.id),
      ...(repairKc ? [repairKc.id] : []),
    ]);
  const prereqsFor = (k: KcState): KcState[] =>
    k.prerequisites
      .map((p) => derived.kcs[p])
      .filter(
        (p): p is KcState =>
          !!p && p.status === 'forgotten' && activeIds.has(p.subject) && !already().has(p.id),
      );
  const total = (): number => {
    const prereqIds = new Set(frontier.flatMap((k) => prereqsFor(k).map((p) => p.id)));
    return (
      pretest.length * P.minutes_pretest_item +
      warmup.length * P.minutes_warmup_item +
      carry.length * P.minutes_carryover_item +
      (repairM ? P.minutes_repair : 0) +
      frontier.length * P.minutes_new_kc +
      prereqIds.size * P.minutes_prerequisite_item +
      P.minutes_exit
    );
  };
  while (total() > minutes && carry.length > 0) {
    const c = carry.pop()!;
    trimmed.push(`carry-over ${c.kc.id} (${c.kc.subject})`);
  }
  while (total() > minutes && frontier.length > 0) {
    const k = frontier.pop()!;
    trimmed.push(`new ${k.id}`);
  }
  while (total() > minutes && warmup.length > P.warmup_min_after_trim) {
    const w = warmup.pop()!;
    trimmed.push(`warm-up ${w.kc.id}`);
  }
  while (total() > minutes && pretest.length > P.pretest_min_after_trim) {
    const p = pretest.pop()!;
    trimmed.push(`pretest ${p.id} (gets a pretest question when it first comes up as new)`);
  }
  if (total() > minutes)
    notes.push(`Plan needs ${total()} min (> ${minutes}); repair and the exit ticket are never trimmed.`);

  const steps: PlanStep[] = [];
  const push = (step: StepName, items: PlanItem[], mins: number): void => {
    if (items.length > 0) steps.push({ step, minutes: round1(mins), items });
  };

  push(
    'pretest',
    pretest.map((k) => item(k, 'pretest (errors are expected and useful)', picker.pick(k.id, 'pretest'))),
    pretest.length * P.minutes_pretest_item,
  );

  const warmItems = interleaveConfusables(
    warmup.map((n) => item(n.kc, n.why, picker.pick(n.kc.id, n.category === 5 ? 'transfer' : 'review'))),
    derived,
  );
  push('warmup', warmItems, warmItems.length * P.minutes_warmup_item);

  push(
    'carryover',
    carry.map((n) =>
      item(n.kc, `carry-over from ${n.kc.subject}: ${n.why}`, picker.pick(n.kc.id, 'carryover')),
    ),
    carry.length * P.minutes_carryover_item,
  );

  if (repairM && repairKc) {
    push(
      'repair',
      [
        item(
          repairKc,
          `repair ${repairM.id}: "${truncate(repairM.belief, 80)}"`,
          picker.pick(repairKc.id, 'repair', repairM.id),
          {
            misconception: repairM.id,
          },
        ),
      ],
      P.minutes_repair,
    );
  }

  const newItems: PlanItem[] = [];
  const seenPrereq = new Set<string>();
  for (const k of frontier) {
    for (const p of prereqsFor(k)) {
      if (seenPrereq.has(p.id)) continue;
      seenPrereq.add(p.id);
      newItems.push(
        item(
          p,
          `forgotten prerequisite of ${k.id} (${p.subject}): review first`,
          picker.pick(p.id, 'review'),
          {
            prerequisite_for: k.id,
          },
        ),
      );
    }
    newItems.push(
      item(
        k,
        k.status === 'introduced' ? 'frontier (introduced, not yet retrieved)' : 'frontier',
        picker.pick(k.id, 'new'),
      ),
    );
  }
  push('new', newItems, frontier.length * P.minutes_new_kc + seenPrereq.size * P.minutes_prerequisite_item);

  // 6. Exit ticket: 2–3 items, at least 1 from today and at least 1 older, when older items exist.
  // "From today" = material taught or repaired today; "older" = KCs learned before today (D-11).
  const todayKcs: KcState[] = [];
  const addToday = (k: KcState | undefined): void => {
    if (k && inFocus(k) && !todayKcs.some((t) => t.id === k.id)) todayKcs.push(k);
  };
  frontier.forEach(addToday);
  addToday(repairKc);
  pretest.forEach(addToday);
  const todaySet = new Set(todayKcs.map((k) => k.id));
  const older = focusKcs
    .filter(
      (k) =>
        !todaySet.has(k.id) && (k.status === 'fragile' || k.status === 'solid' || k.status === 'forgotten'),
    )
    .sort((a, b) => compareKeys([rOf(a), a.id], [rOf(b), b.id]));
  const n = P.exit_items;
  const nToday = older.length > 0 ? Math.min(n - 1, todayKcs.length) : Math.min(n, todayKcs.length);
  const exitKcs = [
    ...todayKcs.slice(0, nToday).map((k) => ({ k, why: 'exit ticket: from today' })),
    ...older.slice(0, n - nToday).map((k) => ({ k, why: 'exit ticket: older item' })),
  ];
  push(
    'exit',
    exitKcs.map(({ k, why }) => item(k, why, picker.pick(k.id, 'exit'))),
    P.minutes_exit,
  );

  const improvised = steps.flatMap((s) => s.items).filter((i) => i.question_id === null).length;
  if (improvised > 0)
    notes.push(
      `${improvised} item(s) have no reviewed bank question: improvise and record question_text (QB-04).`,
    );

  return {
    status: 'ok',
    ...base,
    minutes_planned: round1(steps.reduce((s, st) => s + st.minutes, 0)),
    steps,
    trimmed,
    notes,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
