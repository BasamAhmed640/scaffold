import { z } from 'zod';
import {
  gradeSample,
  GradeSampleInput,
  gradeScore,
  GradeScoreInput,
  qqAudit,
  spotCheckScore,
  SpotCheckInput,
  spotCheckSheet,
  SpotScoreInput,
} from '../service/ops/audits.js';
import { pendingReviews } from '../service/ops/questions.js';
import type { ToolDef } from './tools.js';

// M8 rows: the cross-review queue (QB-04, for batch jobs over MCP) and the owner's audits
// (V-GRADE, V-QQ). The audits show keys, so they are CLI-only (TP-08 escrow).

const Empty = z.object({});

export const AUDIT_TOOLS: ToolDef[] = [
  {
    name: 'list_pending_reviews',
    title: 'Questions waiting for review',
    description:
      'Bank questions without an `ok` verdict, with the model family that must review each (QB-04). Batch job: review only the rows whose reviewer_family is yours, outside tutoring sessions.',
    input: Empty,
    readOnly: true,
    handler: (sc) => ({ pending: pendingReviews(sc) }),
  },
  {
    name: 'grade_sample',
    title: 'Grade audit: sample',
    description: 'V-GRADE: write a blind labelling sheet of tutor-graded free-text answers (owner only).',
    input: GradeSampleInput,
    cliOnly: true,
    handler: (sc, i, w) => gradeSample(sc, i, w),
  },
  {
    name: 'grade_score',
    title: 'Grade audit: score',
    description: "V-GRADE: Cohen's κ per provider, confident-wrong recall and drift from the owner's labels.",
    input: GradeScoreInput,
    cliOnly: true,
    handler: (sc, i, w) => gradeScore(sc, i, w),
  },
  {
    name: 'qq_audit',
    title: 'Question quality audit',
    description:
      'V-QQ: every served bank question passes lint (QB-03) and had an ok verdict when served (QB-04).',
    input: Empty,
    readOnly: true,
    cliOnly: true,
    handler: (sc) => qqAudit(sc),
  },
  {
    name: 'qq_spotcheck',
    title: 'Question spot check: sheet',
    description: 'V-QQ: write the monthly sheet of 10 ok questions for the owner to check against QB-01.',
    input: SpotCheckInput,
    cliOnly: true,
    handler: (sc, i, w) => spotCheckSheet(sc, i, w),
  },
  {
    name: 'qq_spotcheck_score',
    title: 'Question spot check: score',
    description: 'V-QQ: count the acceptable questions in a marked spot-check sheet (target 9 of 10).',
    input: SpotScoreInput,
    cliOnly: true,
    handler: (sc, i, w) => spotCheckScore(sc, i, w),
  },
];
