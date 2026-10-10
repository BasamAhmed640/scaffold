import { shortHash } from '../ids.js';
import type { ScaffoldEvent } from '../schemas/events.js';
import { DAY_MS, ms } from '../time.js';
import type { AttemptFact, LearnerFacts } from './facts.js';

// ARC-08: derived state is a pure fold over events. `applyEvent` mutates `facts` in place and is
// deterministic; `rebuild` folds a whole log from empty facts.

export function emptyFacts(): LearnerFacts {
  return {
    version: 1,
    event_count: 0,
    event_ids: {},
    kcs: {},
    subjects: {},
    sessions: {},
    session_order: [],
    attempts: {},
    misconceptions: {},
    questions: {},
    visuals: {},
    card_proposals: {},
    card_actions: {},
    card_flags: [],
    anki_review_ids: {},
    anki_reviews: [],
    last_anki_import_ts: null,
    escrow: { keys: [], hints: [] },
  };
}

/** Keep about 400 days of Anki reviews in the facts (load metrics need 7 days; intake needs a year). */
const ANKI_REVIEW_RETENTION_DAYS = 400;

export function questionKey(questionId: string | null, questionText: string | null): string {
  if (questionId) return questionId;
  return `improvised:${shortHash((questionText ?? '').trim().toLowerCase().replace(/\s+/g, ' '))}`;
}

function markCheck(facts: LearnerFacts, kcIds: string[], ts: string, reason: string): void {
  for (const id of kcIds) {
    const kc = facts.kcs[id];
    if (!kc) continue;
    if (!kc.check_flag_ts || ms(ts) >= ms(kc.check_flag_ts)) {
      kc.check_flag_ts = ts;
      kc.check_flag_reason = reason;
    }
  }
}

export function applyEvent(facts: LearnerFacts, e: ScaffoldEvent): LearnerFacts {
  if (facts.event_ids[e.id]) return facts; // LM-04: idempotent on id.
  facts.event_ids[e.id] = true;
  facts.event_count += 1;

  switch (e.type) {
    case 'subject_created':
    case 'subject_updated': {
      const prev = facts.subjects[e.subject.id];
      facts.subjects[e.subject.id] = {
        fields: e.subject,
        created_ts: prev?.created_ts ?? e.ts,
        scope_changes: prev?.scope_changes ?? [],
      };
      break;
    }
    case 'subject_scope_changed': {
      const s = facts.subjects[e.subject_id];
      if (!s) break;
      s.scope_changes.push({ ts: e.ts, from: e.from, to: e.to });
      s.fields = { ...s.fields, scope: e.to };
      // ANK-07 / LM-09: reopening marks the subject's KCs needs_check.
      if (e.to === 'active' && e.from !== 'active') {
        const ids = Object.values(facts.kcs)
          .filter((k) => k.fields.subject === e.subject_id)
          .map((k) => k.fields.id);
        markCheck(facts, ids, e.ts, 'subject reopened');
      }
      break;
    }
    case 'kc_created':
    case 'kc_updated': {
      const prev = facts.kcs[e.kc.id];
      facts.kcs[e.kc.id] = {
        fields: e.kc,
        created_ts: prev?.created_ts ?? e.ts,
        updated_ts: e.ts,
        taught_ts: prev?.taught_ts ?? [],
        attempt_ids:
          prev?.attempt_ids ??
          Object.values(facts.attempts)
            .filter((a) => a.kc_ids.includes(e.kc.id))
            .map((a) => a.id),
        anchor_lapse_ts: prev?.anchor_lapse_ts ?? [],
        check_flag_ts: prev?.check_flag_ts ?? null,
        check_flag_reason: prev?.check_flag_reason ?? null,
        section_hashes: { ...(prev?.section_hashes ?? {}), ...e.section_hashes },
        source_hashes: { ...(prev?.source_hashes ?? {}), ...e.source_hashes },
      };
      break;
    }
    case 'session_started':
    case 'session_replanned': {
      let s = facts.sessions[e.session_id];
      if (!s) {
        s = {
          id: e.session_id,
          started_ts: e.ts,
          ended_ts: null,
          focus_history: [],
          minutes: e.minutes,
          carryover: e.carryover,
          plan: e.plan,
          summary: null,
          open_threads: [],
          next_preview: null,
          auto_closed: false,
        };
        facts.sessions[e.session_id] = s;
        facts.session_order.push(e.session_id);
      }
      s.focus_history.push({ ts: e.ts, subject: e.focus.subject, why: e.focus.why });
      s.minutes = e.minutes;
      s.carryover = e.carryover;
      s.plan = e.plan;
      break;
    }
    case 'session_ended': {
      const s = facts.sessions[e.session_id];
      if (!s) break;
      s.ended_ts = e.ts;
      s.summary = e.summary;
      s.open_threads = e.open_threads;
      s.next_preview = e.next_preview;
      s.auto_closed = e.auto_closed;
      break;
    }
    case 'taught': {
      for (const id of e.kc_ids) facts.kcs[id]?.taught_ts.push(e.ts);
      break;
    }
    case 'attempt': {
      const a: AttemptFact = {
        id: e.id,
        ts: e.ts,
        session_id: e.session_id,
        question_id: e.question_id,
        question_key: questionKey(e.question_id, e.question_text),
        kc_ids: e.kc_ids,
        qtype: e.qtype,
        format: e.format,
        grade: e.grade,
        confidence: e.confidence,
        assisted: e.assisted,
        hints_used: e.hints_used,
        misconception_id: e.misconception_id,
        misconception_belief: e.misconception_belief,
        grader_uncertain: e.grader_uncertain,
        step: e.step ?? null,
      };
      facts.attempts[e.id] = a;
      for (const id of e.kc_ids) facts.kcs[id]?.attempt_ids.push(e.id);
      if (e.misconception_id && e.misconception_belief && !facts.misconceptions[e.misconception_id]) {
        facts.misconceptions[e.misconception_id] = {
          id: e.misconception_id,
          kc_ids: e.kc_ids,
          belief: e.misconception_belief,
          first_ts: e.ts,
          explicit_open_ts: [],
        };
      }
      break;
    }
    case 'grade_overridden': {
      const a = facts.attempts[e.attempt_id];
      if (a) a.grade = e.grade;
      break;
    }
    case 'misconception_opened': {
      const m = facts.misconceptions[e.misconception_id];
      if (m) {
        m.explicit_open_ts.push(e.ts);
      } else {
        facts.misconceptions[e.misconception_id] = {
          id: e.misconception_id,
          kc_ids: e.kc_ids,
          belief: e.belief,
          first_ts: e.ts,
          explicit_open_ts: [e.ts],
        };
      }
      break;
    }
    case 'anki_reviews_imported': {
      for (const r of e.reviews) {
        const key = String(r.review_id) + ':' + String(r.card_id);
        if (facts.anki_review_ids[key]) continue;
        facts.anki_review_ids[key] = true;
        facts.anki_reviews.push({
          review_id: r.review_id,
          card_id: r.card_id,
          note_id: r.note_id,
          kc_ids: r.kc_ids,
          subject: r.subject,
          anchor: r.anchor,
          ease: r.ease,
          time_ms: r.time_ms,
          ts: r.ts,
          lapse: r.lapse,
        });
        if (r.lapse) {
          markCheck(facts, r.kc_ids, r.ts, 'Anki lapse');
          if (r.anchor) for (const id of r.kc_ids) facts.kcs[id]?.anchor_lapse_ts.push(r.ts);
        }
      }
      for (const f of e.flags)
        markCheck(facts, f.kc_ids, e.ts, f.kind === 'leech' ? 'Anki leech' : 'stale card');
      facts.last_anki_import_ts = e.ts;
      const cutoff = ms(e.ts) - ANKI_REVIEW_RETENTION_DAYS * DAY_MS;
      if (facts.anki_reviews.length > 0 && ms(facts.anki_reviews[0]!.ts) < cutoff) {
        facts.anki_reviews = facts.anki_reviews.filter((r) => ms(r.ts) >= cutoff);
      }
      break;
    }
    case 'question_added': {
      facts.questions[e.question_id] = {
        id: e.question_id,
        kc_ids: e.question.kc_ids,
        created_by: e.question.created_by,
        created_ts: e.ts,
        key_hash: e.key_hash,
        misconception_ids: (e.question.misconception_targets ?? [])
          .map((t) => t.misconception_id)
          .filter((x): x is string => !!x),
        verdict: 'pending',
        reviewed_by: null,
        key_changed_ts: null,
      };
      break;
    }
    case 'question_updated': {
      const q = facts.questions[e.question_id];
      if (!q) break;
      q.kc_ids = e.kc_ids;
      if (e.key_hash !== q.key_hash) {
        q.key_hash = e.key_hash;
        q.key_changed_ts = e.ts;
        q.verdict = 'pending'; // a changed key needs a fresh cross-model review (QB-04)
        q.reviewed_by = null;
      }
      if (e.misconception_ids.length > 0) q.misconception_ids = e.misconception_ids;
      break;
    }
    case 'question_reviewed': {
      const q = facts.questions[e.question_id];
      if (!q) break;
      q.verdict = e.verdict;
      q.reviewed_by = e.by;
      break;
    }
    case 'visual_registered': {
      const prev = facts.visuals[e.visual_id];
      const registrations = [
        ...(prev?.registrations ?? []),
        { ts: e.ts, session_id: e.session_id, status: e.status, attempt: e.attempt },
      ];
      // A failed fix of an accepted visual leaves the stored version in place (VIS-05).
      if (prev && prev.status === 'accepted' && e.status !== 'accepted') {
        prev.registrations = registrations;
        break;
      }
      facts.visuals[e.visual_id] = {
        id: e.visual_id,
        kc_ids: e.kc_ids,
        ts: e.ts,
        title: e.title,
        kind: e.kind,
        format: e.format,
        status: e.status,
        has_generator: e.has_generator,
        static_ok: e.static_ok,
        warnings: e.warnings,
        source_sha256: e.source_sha256,
        registrations,
      };
      break;
    }
    case 'card_proposed': {
      facts.card_proposals[e.proposal_id] = {
        proposal_id: e.proposal_id,
        ts: e.ts,
        session_id: e.session_id,
        kc_id: e.kc_id,
        subject: e.subject,
        anchor: e.anchor,
        front: e.front,
        back: e.back,
        extra: e.extra,
        note_type: e.note_type,
        link: e.link,
      };
      break;
    }
    case 'card_flagged': {
      facts.card_flags.push({
        ts: e.ts,
        note_id: e.note_id,
        kc_ids: e.kc_ids,
        reason: e.reason,
        proposed: e.proposed,
      });
      markCheck(facts, e.kc_ids, e.ts, `card flagged: ${e.reason}`);
      break;
    }
    case 'card_action_proposed': {
      facts.card_actions[e.action_id] = {
        action_id: e.action_id,
        ts: e.ts,
        kind: e.kind,
        subject: e.subject,
        kc_ids: e.kc_ids,
        note_ids: e.note_ids,
        card_ids: e.card_ids,
        reason: e.reason,
        payload: e.payload,
        applied_ts: null,
        result: null,
        approval_quote: null,
        created_note_ids: [],
      };
      break;
    }
    case 'card_action_applied': {
      const a = facts.card_actions[e.action_id];
      if (!a) break;
      a.applied_ts = e.ts;
      a.result = e.result;
      a.approval_quote = e.approval.learner_quote;
      if (e.created_note_ids.length > 0) a.created_note_ids = e.created_note_ids;
      break;
    }
    case 'key_requested':
      facts.escrow.keys.push({ ts: e.ts, session_id: e.session_id, question_id: e.question_id });
      break;
    case 'hint_requested':
      facts.escrow.hints.push({
        ts: e.ts,
        session_id: e.session_id,
        question_id: e.question_id,
        level: e.level,
      });
      break;
  }
  return facts;
}

export function rebuild(events: Iterable<ScaffoldEvent>): LearnerFacts {
  const f = emptyFacts();
  for (const e of events) applyEvent(f, e);
  return f;
}

/** Attempts on a KC, sorted by time then id (deterministic). */
export function attemptsFor(facts: LearnerFacts, kcId: string): import('./facts.js').AttemptFact[] {
  const kc = facts.kcs[kcId];
  if (!kc) return [];
  const list = kc.attempt_ids.map((id) => facts.attempts[id]).filter((a): a is AttemptFact => !!a);
  return sortAttempts(list);
}

export function sortAttempts(list: AttemptFact[]): AttemptFact[] {
  return [...list].sort((a, b) => ms(a.ts) - ms(b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
