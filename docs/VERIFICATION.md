# Verification

Real command output for every suite (G7). Sections between `suite:` markers are written by `npx tsx scripts/record-verification.ts [SUITE]`, which runs the command and pastes its output verbatim. Manual checks (V-UI, the Claude Desktop install, V-GRADE labels, V-DOG) are recorded by hand at the end, with what was observed.

<!-- suite:V-CORE:begin -->
### V-CORE: the learner model is correct

`npx vitest run test/core --reporter=verbose` — exit 0 — 2026-10-09T23:40:54.029Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > incorrect → Again 2ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > correct but assisted → Hard 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > correct, confidence 1 → Hard 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > correct, confidence 2 → Hard 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > correct, unassisted, confidence 3 → Good 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > correct, unassisted, confidence 4 → Easy 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > partial → Hard (D-08) 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > unanswered → Again (D-08) 0ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > schedules with desired retention 0.85 and decays retrievability over time 3ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > is deterministic (no fuzz) 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > accepts the example attempt from the spec 5ms
 ✓ test/core/events.test.ts > LM-03 event log schema > covers every event type named in D2 (plus the escrow and question_updated additions) 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: unknown type 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: missing grade 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad grade 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: confidence 5 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad timestamp 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: improvised without question_text 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: missing confidence on a graded answer 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad kc id 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad qtype 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > allows null confidence for "I don't know" (LM-07) 0ms
 ✓ test/core/events.test.ts > LM-04 idempotency > applying the same attempt twice changes nothing 4ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > rejects cycles 0ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > rejects dangling ids and self references 0ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > accepts a DAG with edges across subjects 0ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > orders prerequisites first and finds ancestors 0ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > opens on a confident (≥3) incorrect answer with a stated belief 26ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not open on a single low-confidence error (candidate only) 2ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > opens when the same misconception_id appears twice at any confidence 2ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > LM-07: "I don't know" never opens a misconception 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > resolves after correct unassisted answers to 2 targeting questions in 2 sessions ≥ 20 h apart 4ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not resolve when both correct answers come from one session 2ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not resolve when the sessions are less than 20 h apart 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not resolve with the same question twice 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > guesses and assisted answers do not resolve it 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > reopens when the belief shows up again after resolution 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > opens through an explicit misconception_opened event 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > bank questions that target the misconception count toward resolution 3ms
 ✓ test/core/status.test.ts > LM-05 status rules > no events → unseen 10ms
 ✓ test/core/status.test.ts > LM-05 status rules > taught only → introduced 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > incorrect pretest answer leaves the KC unseen 17ms
 ✓ test/core/status.test.ts > LM-05 status rules > LM-06 guessed correct answer (confidence 1) is not evidence 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > LM-07 "I don't know" is unanswered and leaves the KC unseen 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > assisted correct answer is not evidence (introduced after teaching) 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > one unassisted correct → fragile 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > correct pretest answer (confidence 2) → fragile 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > mastery conditions met → solid 5ms
 ✓ test/core/status.test.ts > LM-05 status rules > two sessions less than 20 h apart do not count 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > no deep question type → fragile 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > confidence 2 answers are not mastery evidence 0ms
 ✓ test/core/status.test.ts > LM-05 status rules > latest attempt incorrect (within 3 days) → fragile, not solid 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > active misconception blocks solid 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > incorrect unassisted attempt ≥ 3 days after the last success → forgotten 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > "I don't know" ≥ 3 days after the last success → forgotten 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > incorrect attempt 2 days after success → fragile, not forgotten 0ms
 ✓ test/core/status.test.ts > LM-05 status rules > anchor Anki card lapse after the last success → forgotten 5ms
 ✓ test/core/status.test.ts > LM-05 status rules > a non-anchor card lapse only marks needs_check 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > retrievability below 0.70 (fake clock +60 days) → forgotten 0ms
 ✓ test/core/status.test.ts > LM-05 status rules > a correct answer after forgetting → fragile again 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > attempts older than the 60-day window do not count toward mastery 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > needs_check from a non-anchor lapse is cleared by the next attempt (LM-09) 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > reopening a subject marks its KCs needs_check (ANK-07) 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > mastery summary counts conditions 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > thresholds are configurable 1ms
 ✓ test/core/planner-edges.test.ts > deterministic ordering helpers > cmp and compareKeys give a total order 2ms
 ✓ test/core/planner-edges.test.ts > deterministic ordering helpers > truncate keeps short strings and marks cuts 0ms
 ✓ test/core/planner-edges.test.ts > planner edges > a forgotten prerequisite in a paused subject is never planned; its dependent waits 29ms
 ✓ test/core/planner-edges.test.ts > planner edges > a forgotten prerequisite shared by two new KCs is listed once 3ms
 ✓ test/core/planner-edges.test.ts > planner edges > KCs with no concept memory rank after those with one in the same category 2ms
 ✓ test/core/planner-edges.test.ts > planner edges > repairs the oldest active misconception first; others wait in the warm-up 3ms
 ✓ test/core/planner-edges.test.ts > planner edges > frontier lists introduced KCs before unseen ones 1ms
 ✓ test/core/planner-edges.test.ts > planner edges > pretest picks the easiest suitable bank question 3ms
 ✓ test/core/planner-edges.test.ts > planner edges > interleaving works whichever KC lists the confusable 3ms
 ✓ test/core/planner-edges.test.ts > focus edges > "all" with no active subjects fails loudly; no subjects at all → no_subjects 2ms
 ✓ test/core/planner-edges.test.ts > focus edges > a blank focus means "not named" 1ms
 ✓ test/core/planner-edges.test.ts > focus edges > last focused subject ignores mixed days and is null without sessions 2ms
 ✓ test/core/planner-edges.test.ts > focus edges > the last-session subject is skipped when no longer active (rule 4 applies) 2ms
 ✓ test/core/planner-edges.test.ts > briefing edges > carries the session id and intake status 9ms
 ✓ test/core/planner-edges.test.ts > briefing edges > mixed review day briefing covers every active subject and has no recap 4ms
 ✓ test/core/planner-edges.test.ts > briefing edges > compaction trims long question lists and long texts in a fixed order 5ms
 ✓ test/core/planner-edges.test.ts > briefing edges > compact plans name the misconception for the repair step 5ms
 ✓ test/core/planner-edges.test.ts > model edges > deriving at an earlier instant ignores later events (time travel) 1ms
 ✓ test/core/planner-edges.test.ts > model edges > attempts on questions missing from the bank are handled 1ms
 ✓ test/core/planner-edges.test.ts > model edges > derived frontmatter carries memory when present and null otherwise 1ms
 ✓ test/core/planner-edges.test.ts > model edges > briefing keeps the session id and compacts a briefing without a recap 4ms
 ✓ test/core/planner-edges.test.ts > model edges > an empty focus string counts as not named 0ms
 ✓ test/core/planner.test.ts > LM-10 planner golden plans > si-pi focus, 30 minutes, carry-over 2 49ms
 ✓ test/core/planner.test.ts > LM-10 planner golden plans > mixed review day (focus: all) matches the golden mixed plan 7ms
 ✓ test/core/planner.test.ts > LM-10 planner golden plans > short 12-minute session trims carry-over first, then new KCs, then warm-up; never repair or exit 4ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > warm-up ranks forgotten > misconception > needs_check > R below target > solid without transfer 3ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > needs_check KCs rank right after active misconceptions 2ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > interleaves confusable pairs next to each other 1ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > a backlog over 8 means no new KCs 4ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > a forgotten prerequisite comes before its dependent, whatever subject it belongs to 2ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > chooses question variants not used in the KC’s last 2 attempts and not worded like its Anki cards 3ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > serves only questions with an `ok` cross-model verdict (QB-04) 6ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > repair uses a question that targets the misconception 3ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > with music theory in focus, other-subject KCs appear only in carry-over (urgent, ≤ carryover) 4ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > carryover 0 plans nothing from other subjects, and paused subjects never appear 4ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > a backlog over 8 in subject A does not block new KCs in B; it produces a briefing warning 3ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > a subject with no KCs returns intake_required 2ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > a subject whose KCs have no attempts starts with a pretest in prerequisite order (at most 8) 4ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > short pretest sessions trim pretest items down to 3 at most 2ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 1. a named subject, matched case-insensitively on id, title or alias 6ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > unknown name → unknown_subject; paused subject → subject_not_active 6ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 2. the only active subject 0ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 3. the focus of the most recent session (mixed days do not count), if still active 3ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 4. otherwise the active subject with the most due KCs (ties by id) 3ms
 ✓ test/core/planner.test.ts > LM-11 briefing > stays within 600 tokens and recaps the last session on the focus subject 3ms
 ✓ test/core/planner.test.ts > LM-11 briefing > recap comes from the last session on that subject, not the most recent session overall 6ms
 ✓ test/core/planner.test.ts > LM-11 briefing > warns about a stale subject with no session in 14 days 3ms
 ✓ test/core/planner.test.ts > LM-11 briefing > compacts large briefings below the budget 5ms
 ✓ test/core/planner.property.test.ts > LM-10 subject isolation (property) > holds for 1,000 random vaults 391ms
 ✓ test/core/rebuild.property.test.ts > ARC-08 rebuild determinism > rebuild(events) equals the incrementally built state (1,000 random logs) 792ms

 Test Files  8 passed (8)
      Tests  115 passed (115)
   Start at  19:40:57
   Duration  1.39s (import 44%, tests 34%, transform 21%, worker 1%)
```

`npx vitest run test/core --coverage --coverage.include=src/core/model/status.ts --coverage.include=src/core/model/misconceptions.ts --coverage.include=src/core/model/derive.ts --coverage.include=src/core/planner/plan.ts --coverage.include=src/core/planner/focus.ts --coverage.include=src/core/planner/briefing.ts --coverage.reporter=text --coverage.reportsDirectory=.tmp/cov-core` — exit 0 — 2026-10-09T23:40:54.029Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold
      Coverage enabled with v8


 Test Files  8 passed (8)
      Tests  115 passed (115)
   Start at  19:41:01
   Duration  1.62s (import 40%, tests 38%, transform 19%, worker 3%)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    99.14 |     100 |     100 |                   
 planner           |     100 |    98.61 |     100 |     100 |                   
  briefing.ts      |     100 |    95.23 |     100 |     100 | 96,176            
  focus.ts         |     100 |    97.36 |     100 |     100 | 59                
-------------------|---------|----------|---------|---------|-------------------

=============================== Coverage summary ===============================
Statements   : 100% ( 510/510 )
Branches     : 99.14% ( 347/350 )
Functions    : 100% ( 156/156 )
Lines        : 100% ( 416/416 )
================================================================================
```

<!-- suite:V-CORE:end -->

<!-- suite:STATIC:begin -->
### Static checks: typecheck, lint, adapters

`npx tsc --noEmit` — exit 0 — 2026-10-10T00:40:16.619Z — win32 node v22.23.2

```text
(no output)
```

`npx eslint .` — exit 0 — 2026-10-10T00:40:16.619Z — win32 node v22.23.2

```text
(no output)
```

<!-- suite:STATIC:end -->

<!-- suite:V-VAULT:begin -->
### V-VAULT: files are safe

`npx vitest run test/vault --reporter=verbose` — exit 0 — 2026-10-10T00:09:21.590Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/vault/vault.test.ts > VLT-04 init > creates the vault from the template and never overwrites on re-run 47ms
 ✓ test/vault/vault.test.ts > VLT-04 init > the committed vault-template matches its generators (no drift) 1ms
 ✓ test/vault/vault.test.ts > ARC-12 configuration order > flag > env SCAFFOLD_VAULT > user config 10ms
 ✓ test/vault/vault.test.ts > IF-03 path confinement > rejects .., absolute paths outside the vault and link escapes 28ms
 ✓ test/vault/vault.test.ts > VLT-02 atomic writes > a simulated crash mid-write leaves the old file intact and no truncated file 138ms
 ✓ test/vault/vault.test.ts > VLT-02 atomic writes > a torn last line in events.jsonl (crash mid-append) is ignored, reported and repairable 95ms
 ✓ test/vault/vault.test.ts > event log lock (REL-04) > takes over a stale lock and fails loudly on a live one 300ms
 ✓ test/vault/vault.test.ts > Windows paths and line endings > handles spaces, Unicode, an apostrophe and long names (> 260 characters) 103ms
 ✓ test/vault/frontmatter.test.ts > frontmatter splitting > round-trips BOM, CRLF and bodies byte for byte 4ms
 ✓ test/vault/frontmatter.test.ts > frontmatter splitting > fails loudly on invalid YAML instead of writing 17ms
 ✓ test/vault/frontmatter.test.ts > surgical key updates > replaces only derived keys and keeps comments, quoting and unknown keys 18ms
 ✓ test/vault/frontmatter.test.ts > surgical key updates > adds the derived header once when derived keys are missing 4ms
 ✓ test/vault/frontmatter.test.ts > surgical key updates > inserts learner-owned keys above the derived block and preserves CRLF 2ms
 ✓ test/vault/frontmatter.test.ts > marker regions > replace only the inner text and report missing markers 1ms
 ✓ test/vault/frontmatter.test.ts > marker regions > fills an empty section but never overwrites learner text 1ms
 ✓ test/vault/frontmatter.test.ts > VLT-02 / LM-02: 200 random write cycles > leave learner-written text and unknown frontmatter keys byte-identical 1683ms
 ✓ test/vault/vault.test.ts > Windows paths and line endings > tolerates CRLF notes edited by the learner and keeps their line endings 107ms
 ✓ test/vault/vault.test.ts > LM-13 schema migration and backups > migrates a v0 log after taking a backup copy 132ms
 ✓ test/vault/vault.test.ts > LM-13 schema migration and backups > keeps one dated backup per day with 14-day rotation 114ms
 ✓ test/vault/vault.test.ts > generated fixture vault > rebuild --restore-missing recreates every note from events, with zero unresolved links 411ms
 ✓ test/vault/vault.test.ts > generated fixture vault > rebuild is deterministic: a second run changes no file 478ms
 ✓ test/vault/vault.test.ts > learner edits are folded into the event log > prerequisite, section and answer-key edits become events 165ms
 ✓ test/vault/vault.test.ts > learner edits are folded into the event log > upsert_concept never overwrites learner text in Explanation 108ms
 ✓ test/vault/vault.test.ts > learner edits are folded into the event log > rejects derived fields, dangling ids and cycles on input 112ms
 ✓ test/vault/vault.test.ts > doctor and validate > report a healthy vault and specific problems 140ms
 ✓ test/vault/vault.test.ts > doctor and validate > a missing vault fails loudly with a next step (REL-03) 6ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  20:09:24
   Duration  4.21s (tests 74%, import 16%, transform 9%)
```

<!-- suite:V-VAULT:end -->

<!-- suite:V-CLI:begin -->
### V-CLI: CLI keeps its contracts

`npx vitest run test/cli --reporter=verbose` — exit 0 — 2026-10-10T00:26:32.627Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > init 24ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > doctor 24ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > subject list / get / dashboard 161ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > kc get / list 21ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > briefing / plan, including a focus that does not exist and a paused one 135ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > mc list 5ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > a full session: start → next → hint → key → record → taught → teach-back → end 539ms
 ✓ test/cli/bin.test.ts > scaffold binary > --version, doctor --json, and exit code 1 on failure 2148ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > q add / get / lint / review (cross-model) / pending 239ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > numeric answers are graded by code (REL-02) 117ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > attempt override, mc open, validate, rebuild, report weekly, call 572ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > subject add / kc add / kc update 404ms
 ✓ test/cli/cli.test.ts > human output > prints readable text by default and one line + next step on failure (REL-03) 138ms
 ✓ test/cli/cli.test.ts > human output > a missing vault fails with a next step, never a hang 2ms

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  20:26:35
   Duration  4.51s (tests 66%, import 22%, transform 12%)
```

<!-- suite:V-CLI:end -->

<!-- suite:V-QQ:begin -->
### V-QQ: questions are good (lint)

`npx vitest run test/qq --reporter=verbose` — exit 0 — 2026-10-10T00:26:40.306Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/qq/grade.test.ts > REL-02 numeric grading > symbol: "50 Ω" → correct 2ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > no-break space: "50 Ω" → correct 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > spelled out: "50 ohms" → correct 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > within tolerance: "about 50.5Ω" → correct 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > prefix conversion: "0.05 kΩ" → correct 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > after an equals sign: "Z0 = 50 ohm" → correct 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > unit missing: "50" → partial 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > outside tolerance: "75 Ω" → incorrect 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > wrong unit: "50 V" → incorrect 1ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > I don’t know (LM-07): "no idea" → unanswered 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > no number: "fifty" → incorrect 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > relative tolerance and compound units 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > dimensionless keys (Γ = −0.33) and scientific notation 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > parses units 1ms
 ✓ test/qq/grade.test.ts > REL-02 multiple-choice grading > accepts a letter, a letter with words, or the option text 1ms
 ✓ test/qq/grade.test.ts > REL-02 multiple-choice grading > recognizes "I don't know" variants (LM-07) 0ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  20:26:42
   Duration  506ms (import 59%, transform 31%, worker 5%, tests 4%)
```

<!-- suite:V-QQ:end -->

<!-- suite:V-MCP:begin -->
### V-MCP: MCP server keeps its contracts

`npx vitest run test/mcp --reporter=verbose` — exit 0 — 2026-10-10T00:32:57.402Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/mcp/mcpb.test.ts > MCPB bundle > builds, validates and stays small 1378ms
 ✓ test/mcp/mcpb.test.ts > MCPB bundle > exported JSON Schemas are current (IF-02) 406ms
 ✓ test/mcp/mcp.test.ts > V-MCP tool list > lists the tools with valid JSON Schemas 91ms
 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > reads: doctor, list_subjects, get_concept, get_briefing, list_misconceptions, validate 225ms
 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > a session: start, next_questions, get_hint, get_grading_key, record_attempt, mark_taught, plan_session, end_session 507ms
stdout | test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > p95 latency is under 500 ms on the fixture vault
MCP latency over 23 calls: p50 31 ms, p95 84 ms

 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > writes: upsert_subject, upsert_concept, add_question, review_question, open_misconception, save_teach_back, override_grade 183ms
 ✓ test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > path traversal in ids is rejected 3ms
 ✓ test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > oversized inputs are rejected 10ms
 ✓ test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > p95 latency is under 500 ms on the fixture vault 1ms
 ✓ test/mcp/mcp.test.ts > V-MCP never fails on load (REL-03) > starts without a vault and answers with a next step 562ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Start at  20:32:59
   Duration  3.81s (tests 77%, import 14%, transform 8%)
```

<!-- suite:V-MCP:end -->

<!-- suite:V-PROTO:begin -->
### V-PROTO: the protocol files are complete

`npx vitest run test/proto --reporter=verbose` — exit 0 — 2026-10-10T00:40:10.808Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/proto/proto.test.ts > V-PROTO skill > has valid frontmatter (name, description) 10ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > SKILL.md stays at or under 500 lines, with the rest in references/ 2ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > every TP rule appears verbatim (TP-01 … TP-18) 4ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > every D3 section (D3.1 … D3.11) appears verbatim in the skill 1ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > protocol sources still match the frozen spec text (no softening) 1ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > tools named in the protocol exist (or are pending a later milestone) 1ms
 ✓ test/proto/proto.test.ts > V-PROTO adapters (AD-01) > generated files match the source (hash banner + --check) 584ms
 ✓ test/proto/proto.test.ts > V-PROTO adapters (AD-01) > the skill ZIP holds scaffold-tutor/SKILL.md and its references 458ms
 ✓ test/proto/proto.test.ts > V-PROTO adapters (AD-01) > against the original build spec, when it is available locally 3ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  20:40:13
   Duration  3.26s (import 41%, tests 35%, transform 23%)
```

<!-- suite:V-PROTO:end -->
