# Questions: writing, linting, reviewing (QB-01 … QB-05)

The bank lives in `Scaffold/Questions/Q-0001.md`. The rules below are the build spec's D4, verbatim, followed by how to apply them with the tools.

{{include references/_d4.md}}

## Writing a bank question (`add_question`)

1. One KC, or one stated relation between two KCs (`kc_ids` has 1 or 2 ids).
2. Choose the `qtype` from D3.5 and the `format`: `free` by default; `numeric` with `numeric: {value, unit, tolerance}` (tolerance as a number in the unit, or a string like `"2%"`); `mc` only for `discriminate`, with `options` and a `misconception_targets` entry for every distractor (`{option_or_belief: "<option text or letter>", misconception_id: "M-…"}`).
3. `answer_key`: the answer itself (for `mc`, the option letter or exact text). `rubric`: 1–4 propositions, each one checkable in the learner's words.
4. `hints`: exactly four, in ladder order: H1 orient, H2 principle, H3 a partial step, H4 the full worked answer.
5. Keep the stem self-contained and answerable in one message; never put the key, the key number or reasoning inside the stem or options; keep options similar in length.
6. `created_by`: your front-end (`claude-desktop`, `claude-code`, `codex`, `pi`).

`add_question` returns the lint result (QB-03). A failing question is kept but never served; fix it in the note (Obsidian) and run `scaffold q lint`.

## Cross-model review (QB-04)

A question written in Claude is reviewed in ChatGPT (Codex), and the other way round. The planner serves only questions with verdict `ok`.

1. Outside a tutoring session, list the queue: `scaffold --json q review --pending` (each row says which model family must review it).
2. For each question you may review: `review_question {question_id}` returns the question, its lint result and the QB-01 checklist.
3. Check every item of QB-01, and solve the question yourself from the stem alone: if your answer differs from the key, the verdict is `fix` (or `reject`) with a note saying why.
4. Record: `review_question {question_id, verdict: "ok" | "fix" | "reject", by: "<your front-end>", notes}`. A reviewer from the author's model family is refused. Changing a key later resets the verdict to pending.

## Improvised questions in a session

Allowed when the plan has no reviewed question. Record them with the full `question_text`; they enter the bank only after review (QB-04). Write them to the same QB-01 standard.

## Escrow (QB-05, TP-08)

`next_questions` returns stems and metadata only. `get_grading_key` needs the learner's verbatim answer (or "skipped"). `get_hint` is for when the learner asks or after a wrong attempt. All three are logged.
