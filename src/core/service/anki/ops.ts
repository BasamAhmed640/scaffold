import { z } from 'zod';
import { AnkiOffline } from '../../anki/client.js';
import { budgetProposals, scopeProposals, type ProposedAction } from '../../anki/controller.js';
import { reviewsPerDay } from '../../anki/load.js';
import type { MirrorCard } from '../../anki/mirror.js';
import { hasTag, ROOT_DECK, TAG } from '../../anki/notes.js';
import { any, select, term } from '../../anki/search.js';
import { ScaffoldError, type Warnings } from '../../envelope.js';
import { matchSubject } from '../../planner/focus.js';
import type { AnkiBriefing } from '../../planner/briefing.js';
import { KcId, Scope } from '../../schemas/common.js';
import { subjectRel } from '../../vault/vault.js';
import type { DoctorCheck } from '../ops/maintenance.js';
import type { EventDraft, Scaffold } from '../scaffold.js';
import { activePause } from '../../anki/controller.js';
import { allocIds, clientFor, loadFor, protectFor, queueFor, readMirror } from './context.js';

// ANK-06/07 proposals, ANK-01 custom stacks, load reporting (briefing, weekly report, doctor).

/** Emits controller proposals that are not already pending (same kind, subject and notes). */
export function emitProposals(sc: Scaffold, proposals: ProposedAction[], by = 'scaffold-core'): string[] {
  const facts = sc.facts();
  const pending = Object.values(facts.card_actions).filter((a) => a.result === null);
  const fresh = proposals.filter(
    (p) =>
      !pending.some(
        (a) =>
          a.kind === p.kind &&
          a.subject === p.subject &&
          (p.kind === 'pause_new' || p.kind === 'unpause_new' || a.note_ids.join() === p.note_ids.join()),
      ),
  );
  if (!fresh.length) return [];
  const ids = allocIds(sc, 'CA', fresh.length);
  const drafts: EventDraft[] = fresh.map((p, i) => ({
    type: 'card_action_proposed',
    action_id: ids[i],
    ...p,
    by,
  }));
  sc.emit(drafts);
  return ids;
}

/** After a sync: over-budget proposals (ANK-06), and suspension of new cards added during a pause. */
export async function budgetPass(
  sc: Scaffold,
  w: Warnings,
): Promise<{ proposed: string[]; paused_new: number }> {
  const mirror = readMirror(sc);
  const facts = sc.facts();
  let pausedNew = 0;
  for (const s of sc.subjects()) {
    if (!activePause(facts, s.id)) continue;
    const late = (mirror?.cards ?? []).filter(
      (c) => c.subject === s.id && !c.suspended && c.type === 0 && hasTag(c.tags, TAG.newPaused),
    );
    if (!late.length) continue;
    try {
      await clientFor(sc).invoke('suspend', { cards: late.map((c) => c.card_id) });
      pausedNew += late.length;
    } catch (e) {
      if (!(e instanceof AnkiOffline)) throw e;
    }
  }
  const proposed = emitProposals(
    sc,
    budgetProposals({
      subjects: sc.subjects(),
      load: loadFor(sc, mirror),
      mirror,
      protect: protectFor(sc),
      derived: sc.derived(),
      facts,
      cfg: sc.cfg(),
      now: sc.now(),
    }),
  );
  if (proposed.length)
    w.add(
      `${proposed.length} Anki budget proposal(s) wait for approval (ANK-06): \`scaffold anki actions list\`.`,
    );
  return { proposed, paused_new: pausedNew };
}

export const SetScopeInput = z.object({ subject: z.string().min(1).max(120), scope: Scope });

export function setSubjectScope(sc: Scaffold, raw: unknown, w: Warnings) {
  const input = SetScopeInput.parse(raw);
  const s = matchSubject(sc.subjects(), input.subject);
  if (!s)
    throw new ScaffoldError(
      'unknown_subject',
      `No subject matches "${input.subject}".`,
      'Call list_subjects.',
    );
  if (s.scope === input.scope)
    return { subject: s.id, from: s.scope, to: s.scope, proposals: [], changed: false };
  sc.emit([{ type: 'subject_scope_changed', subject_id: s.id, from: s.scope, to: input.scope }]);
  sc.vault.writeOwned(subjectRel(s.id), { scope: input.scope });
  const ids = emitProposals(
    sc,
    scopeProposals(s.id, s.scope, input.scope, { mirror: readMirror(sc), protect: protectFor(sc) }),
  );
  if (input.scope === 'active')
    w.add(`${s.title} is active again; its KCs are marked needs_check for a relearning pass (ANK-07).`);
  else w.add(`${s.title} is ${input.scope}; its Anki time goes back to the auto subjects (ANK-06).`);
  return {
    subject: s.id,
    from: s.scope,
    to: input.scope,
    changed: true,
    proposals: ids,
    next_step: ids.length
      ? 'Show the card proposals to the learner and apply them with apply_card_actions only after approval.'
      : 'No card changes are needed.',
  };
}

export const StackInput = z.object({
  name: z.string().min(1).max(80),
  subject: z.string().max(120).optional(),
  kc_ids: z.array(KcId).max(50).optional(),
  tags: z.array(z.string().min(1).max(80)).max(10).optional(),
  status: z.enum(['forgotten', 'fragile', 'misconception', 'check']).optional(),
});

/** ANK-01 custom stacks: the search string for a filtered deck the owner creates in Anki. */
export function stackSearch(sc: Scaffold, raw: unknown): { search: string; kcs: string[] | null } {
  const input = StackInput.parse(raw);
  const parts = [term('tag', TAG.scaffold), '-is:suspended'];
  let subjectId: string | null = null;
  if (input.subject) {
    const s = matchSubject(sc.subjects(), input.subject);
    if (!s)
      throw new ScaffoldError(
        'unknown_subject',
        `No subject matches "${input.subject}".`,
        'Call list_subjects.',
      );
    subjectId = s.id;
    parts.push(term('deck', s.anki_deck ?? `${ROOT_DECK}::${s.title}`));
  }
  let kcs: string[] | null = input.kc_ids ?? null;
  if (input.status === 'check') parts.push(term('tag', TAG.check));
  else if (input.status) {
    const derived = sc.derived();
    const pick = Object.values(derived.kcs)
      .filter((k) => !subjectId || k.subject === subjectId)
      .filter((k) => (input.status === 'misconception' ? k.misconception_active : k.status === input.status))
      .map((k) => k.id)
      .sort();
    if (!pick.length)
      throw new ScaffoldError(
        'empty_stack',
        `No KCs are ${input.status}${subjectId ? ` in ${subjectId}` : ''}.`,
        'Pick another filter.',
      );
    kcs = kcs ? kcs.filter((k) => pick.includes(k)) : pick;
  }
  if (kcs) {
    if (!kcs.length)
      throw new ScaffoldError('empty_stack', 'The filters leave no KCs.', 'Loosen the filters.');
    parts.push(any(kcs.map((k) => term('tag', TAG.kc(k)))));
  }
  for (const t of input.tags ?? []) parts.push(term('tag', t));
  return { search: parts.join(' '), kcs };
}

export async function ankiStack(sc: Scaffold, raw: unknown) {
  const input = StackInput.parse(raw);
  const { search } = stackSearch(sc, input);
  const cards = readMirror(sc)?.cards ?? [];
  const matches = select(search, cards);
  let createSupported: boolean | null;
  try {
    const r = await clientFor(sc).invoke<{ actions?: string[] }>('apiReflect', {
      scopes: ['actions'],
      actions: null,
    });
    createSupported = (r?.actions ?? []).includes('createFilteredDeck');
  } catch {
    createSupported = null;
  }
  return {
    name: input.name,
    search,
    matching_cards: matches.length,
    sample: matches.slice(0, 5).map((c) => ({ note_id: c.note_id, front: c.front.slice(0, 80) })),
    instructions: `In Anki: Tools → Create Filtered Deck, name it "${input.name}", paste the search, and keep "Reschedule cards based on my answers" on. Emptying the deck returns every card to its subject deck.`,
    create_supported: createSupported,
  };
}

export function getAnkiLoad(sc: Scaffold) {
  const mirror = readMirror(sc);
  const load = loadFor(sc, mirror);
  return {
    ...load,
    synced_at: mirror?.synced_at ?? null,
    queued_operations: queueFor(sc).count(),
    deck_limits: {
      [ROOT_DECK]: {
        new_per_day: load.recommended_new_total,
        max_reviews_per_day: sc.cfg().anki.max_reviews_per_day,
      },
      ...Object.fromEntries(
        load.subjects
          .filter((r) => r.scope === 'active')
          .map((r) => {
            const s = sc.subjects().find((x) => x.id === r.subject)!;
            return [
              s.anki_deck ?? `${ROOT_DECK}::${s.title}`,
              { new_per_day_this_deck: r.recommended_new_per_day },
            ];
          }),
      ),
    },
  };
}

/** Notes flagged and not yet resolved by an applied action on them (ANK-05: listed in the briefing). */
export function openFlags(sc: Scaffold): { note_id: number; kc_ids: string[]; reason: string; ts: string }[] {
  const facts = sc.facts();
  const resolving = new Set(['keep', 'rewrite', 'rewrite_reset', 'retire', 'compress', 'dormant']);
  const out = new Map<number, { note_id: number; kc_ids: string[]; reason: string; ts: string }>();
  for (const f of facts.card_flags) {
    if (f.note_id === null) continue;
    const resolved = Object.values(facts.card_actions).some(
      (a) =>
        resolving.has(a.kind) &&
        a.note_ids.includes(f.note_id!) &&
        a.applied_ts !== null &&
        a.result !== 'aborted' &&
        a.applied_ts >= f.ts,
    );
    if (!resolved) out.set(f.note_id, { note_id: f.note_id, kc_ids: f.kc_ids, reason: f.reason, ts: f.ts });
  }
  return [...out.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

/** The briefing's Anki block for the focus subject and in total (ANK-06). */
export function ankiBriefing(sc: Scaffold, focus: string, w: Warnings): AnkiBriefing | null {
  const pending = queueFor(sc).count();
  if (pending > 0) w.add(`Anki operations queued: ${pending} (they are applied on the next \`anki sync\`).`);
  const mirror = readMirror(sc);
  const facts = sc.facts();
  const flags = openFlags(sc);
  const proposals = Object.values(facts.card_actions).filter((a) => a.result === null).length;
  if (!mirror && !flags.length && !proposals) return null;
  const load = loadFor(sc, mirror);
  const row = load.subjects.find((r) => r.subject === focus);
  const totalBudget =
    load.subjects.filter((r) => r.scope === 'active').reduce((a, r) => a + r.budget_min, 0) +
    load.maintenance.estimated_min;
  if (row?.over_budget)
    w.add(`${focus} is over its Anki budget (${row.measured_min_7d} > ${row.budget_min} min/day).`);
  return {
    subject: row
      ? {
          min_7d: row.measured_min_7d,
          budget_min: row.budget_min,
          active_cards: row.active_cards,
          intake_year: `${row.intake.used}/${row.intake.budget}`,
        }
      : null,
    total: { min_7d: load.total.measured_min_7d, budget_min: Math.round(totalBudget * 10) / 10 },
    flagged: flags.length,
    ...(flags.length ? { flagged_notes: flags.slice(0, 3).map((f) => f.note_id) } : {}),
    pending_proposals: proposals,
  };
}

/** ANK-10 weekly metrics, per subject and in total. */
export function ankiWeeklyLines(sc: Scaffold): string[] {
  const mirror = readMirror(sc);
  if (!mirror) return ['_Anki metrics appear after the first `scaffold anki sync` (ANK-10)._', ''];
  const load = loadFor(sc, mirror);
  const derived = sc.derived();
  const cfg = sc.cfg();
  const lines = [
    '| Subject | Anki min/day (7 d) | Budget | Active cards | Est. reviews/day | Intake (year) | Cards per solid KC |',
    '|---|---|---|---|---|---|---|',
  ];
  const perSolid = (cards: MirrorCard[], subject: string | null): string => {
    const solid = Object.values(derived.kcs).filter(
      (k) => k.status === 'solid' && (!subject || k.subject === subject),
    );
    if (!solid.length) return '–';
    const ids = new Set(solid.map((k) => k.id));
    const notes = new Set(cards.filter((c) => c.kc_ids.some((k) => ids.has(k))).map((c) => c.note_id));
    const ratio = notes.size / solid.length;
    return `${Math.round(ratio * 10) / 10}${ratio > 4 ? ' ⚠ (target 2–3)' : ''}`;
  };
  for (const r of load.subjects) {
    const cards = mirror.cards.filter((c) => c.subject === r.subject);
    const reviews = cards.reduce((a, c) => a + reviewsPerDay(c, cfg), 0);
    lines.push(
      `| ${r.subject}${r.scope === 'active' ? '' : ` (${r.scope})`} | ${r.measured_min_7d} | ${r.budget_min} | ${r.active_cards} | ${Math.round(reviews * 10) / 10} | ${r.intake.used}/${r.intake.budget} | ${perSolid(cards, r.subject)} |`,
    );
  }
  const totalReviews = mirror.cards.reduce((a, c) => a + reviewsPerDay(c, cfg), 0);
  lines.push(
    `| **Total** | ${load.total.measured_min_7d} | ${load.total_budget_min} | ${load.total.active_cards} | ${Math.round(totalReviews * 10) / 10} | ${load.subjects.reduce((a, r) => a + r.intake.used, 0)} | ${perSolid(mirror.cards, null)} |`,
    '',
    'Progress is measured in solid KCs; deck size is a cost, not an achievement.',
    '',
  );
  return lines;
}

/** Anki checks for doctor: reachable, API version, FSRS, deck structure, budgets (ANK-01, ANK-06, ANK-09). */
export async function ankiDoctor(sc: Scaffold): Promise<DoctorCheck[]> {
  const cfg = sc.cfg().anki;
  const checks: DoctorCheck[] = [];
  // Anki problems are warnings: tutoring goes on and Anki operations are queued (ANK-09).
  const add = (id: string, ok: boolean, message: string, next_step?: string): void => {
    checks.push(
      ok ? { id, ok, message } : { id, ok, message, ...(next_step ? { next_step } : {}), warn: true },
    );
  };
  let version: number | null = null;
  try {
    version = await clientFor(sc).invoke<number>('version');
  } catch (e) {
    add(
      'anki',
      false,
      e instanceof AnkiOffline
        ? `Anki is closed or AnkiConnect is missing: nothing answers at ${e.url}.`
        : (e as Error).message,
      'Open Anki. If it is open, install AnkiConnect (Tools → Add-ons → Get Add-ons…, code 2055492159) and restart Anki. Until then, Anki operations are queued (ANK-09).',
    );
  }
  if (version !== null)
    add(
      'anki',
      version === cfg.api_version,
      version === cfg.api_version
        ? `AnkiConnect answers (API version ${version}).`
        : `AnkiConnect API version ${version}; expected ${cfg.api_version}.`,
      'Update AnkiConnect (Tools → Add-ons → select AnkiConnect → Check for Updates) and restart Anki.',
    );
  const mirror = readMirror(sc);
  if (mirror) {
    if (mirror.fsrs_enabled === false)
      add('anki_fsrs', false, 'FSRS is off in Anki.', 'Enable FSRS in Deck Options → Advanced → FSRS.');
    else if (mirror.fsrs_enabled === null)
      add(
        'anki_fsrs',
        true,
        'Could not confirm FSRS through AnkiConnect; check that Deck Options → FSRS is on.',
      );
    else add('anki_fsrs', true, 'FSRS is on.');
    const deckOf = new Map(sc.subjects().map((s) => [s.id, s.anki_deck ?? `${ROOT_DECK}::${s.title}`]));
    const wrongHome = mirror.cards.filter(
      (c) => c.subject && deckOf.get(c.subject) && c.home_deck !== deckOf.get(c.subject),
    );
    const noSubject = mirror.cards.filter((c) => !c.subject);
    add(
      'anki_decks',
      wrongHome.length === 0 && noSubject.length === 0,
      wrongHome.length
        ? `${wrongHome.length} card(s) sit outside their subject's deck, e.g. note ${wrongHome[0]!.note_id} in "${wrongHome[0]!.home_deck}" tagged subj::${wrongHome[0]!.subject}.`
        : noSubject.length
          ? `${noSubject.length} Scaffold card(s) have no subj:: tag, e.g. note ${noSubject[0]!.note_id}.`
          : 'Every card is in its subject deck, with a matching subj:: tag.',
      'Move the cards back to their subject deck (Browse → Change Deck), or fix the subj:: tag (ANK-01).',
    );
    const subdecks = [...deckOf.values()].filter((d) => mirror.decks.some((x) => x.startsWith(`${d}::`)));
    add(
      'anki_subdecks',
      subdecks.length === 0,
      subdecks.length
        ? `Subject deck "${subdecks[0]}" has subdecks; topics are tags, not subdecks.`
        : 'No subject deck has subdecks.',
      'Move the cards into the subject deck, tag them, and delete the empty subdecks in Anki yourself (ANK-01).',
    );
  } else add('anki_mirror', true, 'No Anki sync yet; run `scaffold anki sync` once Anki is open.');
  const load = loadFor(sc, mirror);
  for (const msg of load.warnings.filter((m) => m.startsWith('Fixed Anki budgets')))
    add(
      'anki_budgets',
      false,
      msg,
      'Lower a subject’s anki_minutes, or raise anki.minutes_per_day in config.json.',
    );
  if (!checks.some((c) => c.id === 'anki_budgets'))
    add('anki_budgets', true, 'Anki budgets fit in the daily total.');
  return checks;
}
