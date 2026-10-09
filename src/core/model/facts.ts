import type { KcFields } from '../schemas/kc.js';
import type { SubjectFields } from '../schemas/subject.js';
import type { Plan } from '../schemas/plan.js';
import type { Grade, QFormat, QType, Scope } from '../schemas/common.js';
import type { CardActionKind, ScaffoldEvent } from '../schemas/events.js';

// Accumulated facts: a pure fold over events.jsonl (ARC-08). JSON-safe (no Map/Set) so that the
// incrementally persisted state and a full rebuild can be compared byte for byte.

export interface AttemptFact {
  id: string;
  ts: string;
  session_id: string | null;
  question_id: string | null;
  /** question_id, or a hash of the improvised question text: identifies "a question" for variants. */
  question_key: string;
  kc_ids: string[];
  qtype: QType;
  format: QFormat;
  grade: Grade;
  confidence: number | null;
  assisted: boolean;
  hints_used: number;
  misconception_id: string | null;
  misconception_belief: string | null;
  grader_uncertain: boolean;
  step: string | null;
}

export interface KcFacts {
  fields: KcFields;
  created_ts: string;
  updated_ts: string;
  taught_ts: string[];
  attempt_ids: string[];
  anchor_lapse_ts: string[];
  /** Latest time a signal marked this KC needs_check (LM-09). */
  check_flag_ts: string | null;
  check_flag_reason: string | null;
  section_hashes: Record<string, string>;
  source_hashes: Record<string, string>;
}

export interface SubjectFacts {
  fields: SubjectFields;
  created_ts: string;
  scope_changes: { ts: string; from: Scope; to: Scope }[];
}

export interface SessionFacts {
  id: string;
  started_ts: string;
  ended_ts: string | null;
  focus_history: { ts: string; subject: string; why: string }[];
  minutes: number;
  carryover: number;
  plan: Plan;
  summary: string | null;
  open_threads: string[];
  next_preview: string | null;
  auto_closed: boolean;
}

export interface MisconceptionFacts {
  id: string;
  kc_ids: string[];
  belief: string;
  first_ts: string;
  explicit_open_ts: string[];
}

export interface QuestionFacts {
  id: string;
  kc_ids: string[];
  created_by: string;
  created_ts: string;
  key_hash: string;
  misconception_ids: string[];
  verdict: 'pending' | 'ok' | 'fix' | 'reject';
  reviewed_by: string | null;
  key_changed_ts: string | null;
}

export interface CardProposalFacts {
  proposal_id: string;
  ts: string;
  session_id: string | null;
  kc_id: string;
  subject: string;
  anchor: boolean;
  front: string;
  back: string;
  extra: string;
  note_type: 'basic' | 'cloze';
  link: string;
}

export interface CardActionFacts {
  action_id: string;
  ts: string;
  kind: CardActionKind;
  subject: string | null;
  kc_ids: string[];
  note_ids: number[];
  card_ids: number[];
  reason: string;
  payload: Record<string, unknown>;
  applied_ts: string | null;
  result: 'applied' | 'queued' | 'aborted' | null;
  approval_quote: string | null;
  created_note_ids: number[];
}

export interface CardFlagFacts {
  ts: string;
  note_id: number | null;
  kc_ids: string[];
  reason: string;
  proposed: string;
}

export interface LearnerFacts {
  version: 1;
  event_count: number;
  event_ids: Record<string, true>;
  kcs: Record<string, KcFacts>;
  subjects: Record<string, SubjectFacts>;
  sessions: Record<string, SessionFacts>;
  session_order: string[];
  attempts: Record<string, AttemptFact>;
  misconceptions: Record<string, MisconceptionFacts>;
  questions: Record<string, QuestionFacts>;
  visuals: Record<string, { id: string; kc_ids: string[]; ts: string; title: string; kind: string }>;
  card_proposals: Record<string, CardProposalFacts>;
  card_actions: Record<string, CardActionFacts>;
  card_flags: CardFlagFacts[];
  anki_review_ids: Record<string, true>;
  anki_reviews: {
    review_id: number;
    card_id: number;
    note_id: number;
    kc_ids: string[];
    subject: string | null;
    anchor: boolean;
    ease: number;
    time_ms: number;
    ts: string;
    lapse: boolean;
  }[];
  last_anki_import_ts: string | null;
  escrow: {
    keys: { ts: string; session_id: string | null; question_id: string }[];
    hints: { ts: string; session_id: string | null; question_id: string; level: number }[];
  };
}

export type { ScaffoldEvent };
