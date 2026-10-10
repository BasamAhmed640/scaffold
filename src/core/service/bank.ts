import { z } from 'zod';
import { sha256 } from '../ids.js';
import type { BankQuestion } from '../planner/plan.js';
import { Question, QuestionInput, QuestionReview, QuestionStats } from '../schemas/question.js';
import { QuestionId } from '../schemas/common.js';
import { FOLDERS } from '../vault/vault.js';
import type { Scaffold } from './scaffold.js';

// QB-02: the question bank lives in Scaffold/Questions/Q-0001.md. Content fields are learner-owned
// (editable in Obsidian); `review` and `stats` are written by the core.

export interface BankEntry {
  question: Question;
  rel: string;
}

export interface BankLoad {
  entries: BankEntry[];
  issues: { rel: string; message: string }[];
}

const FileQuestion = QuestionInput.extend({
  id: QuestionId,
  review: QuestionReview.default({ by: null, verdict: 'pending', notes: '' }),
  stats: QuestionStats.default({ attempts: 0, correct_rate: null, last_used: null }),
});

/** Hash of everything that defines the correct answer (ANK-05: a changed key flags linked cards). */
export function keyHash(q: Pick<Question, 'answer_key' | 'numeric' | 'rubric' | 'options'>): string {
  return sha256(JSON.stringify([q.answer_key, q.numeric ?? null, q.rubric, q.options ?? null])).slice(0, 16);
}

export function loadBank(sc: Scaffold): BankLoad {
  const entries: BankEntry[] = [];
  const issues: BankLoad['issues'] = [];
  for (const rel of sc.vault.listMarkdown(FOLDERS.questions)) {
    try {
      const note = sc.vault.readNote(rel);
      if (!note) continue;
      const parsed = FileQuestion.safeParse(note.data);
      if (!parsed.success) {
        issues.push({
          rel,
          message: parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        });
        continue;
      }
      const expected = rel.split('/').pop()!.replace(/\.md$/, '');
      if (parsed.data.id !== expected) {
        issues.push({ rel, message: `id ${parsed.data.id} does not match the file name ${expected}` });
        continue;
      }
      entries.push({ question: Question.parse(parsed.data), rel });
    } catch (e) {
      issues.push({ rel, message: (e as Error).message });
    }
  }
  return { entries, issues };
}

/** Planner view of the bank: verdicts come from the event log (QB-04). */
export function bankForPlanner(sc: Scaffold, load: BankLoad = loadBank(sc)): BankQuestion[] {
  const facts = sc.facts();
  return load.entries.map(({ question: q }) => ({
    id: q.id,
    kc_ids: q.kc_ids,
    qtype: q.qtype,
    difficulty: q.difficulty,
    stem: q.stem,
    misconception_ids: q.misconception_targets.map((t) => t.misconception_id).filter((x): x is string => !!x),
    verdict: facts.questions[q.id]?.verdict ?? 'pending',
  }));
}

export const QuestionFileSchema = FileQuestion;
export type QuestionFile = z.infer<typeof FileQuestion>;
