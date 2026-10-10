# Verification

Real command output for every suite (G7). Sections between `suite:` markers are written by `npx tsx scripts/record-verification.ts [SUITE]`, which runs the command and pastes its output verbatim. Manual checks (V-UI, the Claude Desktop install, V-GRADE labels, V-DOG) are recorded by hand at the end, with what was observed.

<!-- suite:V-CORE:begin -->
### V-CORE: the learner model is correct

`npx vitest run test/core --reporter=verbose` — exit 0 — 2026-10-10T14:20:09.819Z — win32 node v22.23.2

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
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > schedules with desired retention 0.85 and decays retrievability over time 2ms
 ✓ test/core/memory.test.ts > LM-08 FSRS rating map > is deterministic (no fuzz) 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > accepts the example attempt from the spec 7ms
 ✓ test/core/events.test.ts > LM-03 event log schema > covers every event type named in D2 (plus the escrow and question_updated additions) 2ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: unknown type 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: missing grade 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad grade 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: confidence 5 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad timestamp 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: improvised without question_text 0ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: missing confidence on a graded answer 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad kc id 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > rejects a malformed event: bad qtype 1ms
 ✓ test/core/events.test.ts > LM-03 event log schema > allows null confidence for "I don't know" (LM-07) 0ms
 ✓ test/core/events.test.ts > LM-04 idempotency > applying the same attempt twice changes nothing 5ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > rejects cycles 0ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > rejects dangling ids and self references 0ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > accepts a DAG with edges across subjects 0ms
 ✓ test/core/events.test.ts > LM-12 prerequisite DAG > orders prerequisites first and finds ancestors 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > opens on a confident (≥3) incorrect answer with a stated belief 36ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not open on a single low-confidence error (candidate only) 2ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > opens when the same misconception_id appears twice at any confidence 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > LM-07: "I don't know" never opens a misconception 2ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > resolves after correct unassisted answers to 2 targeting questions in 2 sessions ≥ 20 h apart 9ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not resolve when both correct answers come from one session 2ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not resolve when the sessions are less than 20 h apart 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > does not resolve with the same question twice 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > guesses and assisted answers do not resolve it 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > reopens when the belief shows up again after resolution 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > opens through an explicit misconception_opened event 1ms
 ✓ test/core/misconceptions.test.ts > LM-05 misconceptions > bank questions that target the misconception count toward resolution 4ms
 ✓ test/core/status.test.ts > LM-05 status rules > no events → unseen 15ms
 ✓ test/core/status.test.ts > LM-05 status rules > taught only → introduced 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > incorrect pretest answer leaves the KC unseen 23ms
 ✓ test/core/status.test.ts > LM-05 status rules > LM-06 guessed correct answer (confidence 1) is not evidence 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > LM-07 "I don't know" is unanswered and leaves the KC unseen 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > assisted correct answer is not evidence (introduced after teaching) 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > one unassisted correct → fragile 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > correct pretest answer (confidence 2) → fragile 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > mastery conditions met → solid 7ms
 ✓ test/core/status.test.ts > LM-05 status rules > two sessions less than 20 h apart do not count 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > no deep question type → fragile 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > confidence 2 answers are not mastery evidence 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > latest attempt incorrect (within 3 days) → fragile, not solid 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > active misconception blocks solid 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > incorrect unassisted attempt ≥ 3 days after the last success → forgotten 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > "I don't know" ≥ 3 days after the last success → forgotten 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > incorrect attempt 2 days after success → fragile, not forgotten 0ms
 ✓ test/core/status.test.ts > LM-05 status rules > anchor Anki card lapse after the last success → forgotten 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > a non-anchor card lapse only marks needs_check 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > retrievability below 0.70 (fake clock +60 days) → forgotten 0ms
 ✓ test/core/status.test.ts > LM-05 status rules > a correct answer after forgetting → fragile again 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > attempts older than the 60-day window do not count toward mastery 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > needs_check from a non-anchor lapse is cleared by the next attempt (LM-09) 2ms
 ✓ test/core/status.test.ts > LM-05 status rules > reopening a subject marks its KCs needs_check (ANK-07) 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > mastery summary counts conditions 1ms
 ✓ test/core/status.test.ts > LM-05 status rules > thresholds are configurable 0ms
 ✓ test/core/planner-edges.test.ts > deterministic ordering helpers > cmp and compareKeys give a total order 4ms
 ✓ test/core/planner-edges.test.ts > deterministic ordering helpers > truncate keeps short strings and marks cuts 0ms
 ✓ test/core/planner-edges.test.ts > planner edges > a forgotten prerequisite in a paused subject is never planned; its dependent waits 31ms
 ✓ test/core/planner-edges.test.ts > planner edges > a forgotten prerequisite shared by two new KCs is listed once 4ms
 ✓ test/core/planner-edges.test.ts > planner edges > KCs with no concept memory rank after those with one in the same category 3ms
 ✓ test/core/planner-edges.test.ts > planner edges > repairs the oldest active misconception first; others wait in the warm-up 1ms
 ✓ test/core/planner-edges.test.ts > planner edges > frontier lists introduced KCs before unseen ones 1ms
 ✓ test/core/planner-edges.test.ts > planner edges > pretest picks the easiest suitable bank question 4ms
 ✓ test/core/planner-edges.test.ts > planner edges > interleaving works whichever KC lists the confusable 2ms
 ✓ test/core/planner-edges.test.ts > focus edges > "all" with no active subjects fails loudly; no subjects at all → no_subjects 2ms
 ✓ test/core/planner-edges.test.ts > focus edges > a blank focus means "not named" 1ms
 ✓ test/core/planner-edges.test.ts > focus edges > last focused subject ignores mixed days and is null without sessions 4ms
 ✓ test/core/planner-edges.test.ts > focus edges > the last-session subject is skipped when no longer active (rule 4 applies) 1ms
 ✓ test/core/planner-edges.test.ts > briefing edges > carries the session id and intake status 14ms
 ✓ test/core/planner-edges.test.ts > briefing edges > mixed review day briefing covers every active subject and has no recap 4ms
 ✓ test/core/planner-edges.test.ts > briefing edges > compaction trims long question lists and long texts in a fixed order 4ms
 ✓ test/core/planner-edges.test.ts > briefing edges > compact plans name the misconception for the repair step 2ms
 ✓ test/core/planner-edges.test.ts > model edges > deriving at an earlier instant ignores later events (time travel) 1ms
 ✓ test/core/planner-edges.test.ts > model edges > attempts on questions missing from the bank are handled 0ms
 ✓ test/core/planner-edges.test.ts > model edges > derived frontmatter carries memory when present and null otherwise 1ms
 ✓ test/core/planner-edges.test.ts > model edges > briefing keeps the session id and compacts a briefing without a recap 5ms
 ✓ test/core/planner-edges.test.ts > model edges > an empty focus string counts as not named 1ms
 ✓ test/core/planner.test.ts > LM-10 planner golden plans > si-pi focus, 30 minutes, carry-over 2 51ms
 ✓ test/core/planner.test.ts > LM-10 planner golden plans > mixed review day (focus: all) matches the golden mixed plan 7ms
 ✓ test/core/planner.test.ts > LM-10 planner golden plans > short 12-minute session trims carry-over first, then new KCs, then warm-up; never repair or exit 6ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > warm-up ranks forgotten > misconception > needs_check > R below target > solid without transfer 3ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > needs_check KCs rank right after active misconceptions 2ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > interleaves confusable pairs next to each other 1ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > a backlog over 8 means no new KCs 3ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > a forgotten prerequisite comes before its dependent, whatever subject it belongs to 2ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > chooses question variants not used in the KC’s last 2 attempts and not worded like its Anki cards 3ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > serves only questions with an `ok` cross-model verdict (QB-04) 3ms
 ✓ test/core/planner.test.ts > LM-10 planner rules > repair uses a question that targets the misconception 2ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > with music theory in focus, other-subject KCs appear only in carry-over (urgent, ≤ carryover) 2ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > carryover 0 plans nothing from other subjects, and paused subjects never appear 7ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > a backlog over 8 in subject A does not block new KCs in B; it produces a briefing warning 5ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > a subject with no KCs returns intake_required 4ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > a subject whose KCs have no attempts starts with a pretest in prerequisite order (at most 8) 6ms
 ✓ test/core/planner.test.ts > LM-10 / LM-14 subject focus > short pretest sessions trim pretest items down to 3 at most 5ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 1. a named subject, matched case-insensitively on id, title or alias 9ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > unknown name → unknown_subject; paused subject → subject_not_active 7ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 2. the only active subject 1ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 3. the focus of the most recent session (mixed days do not count), if still active 4ms
 ✓ test/core/planner.test.ts > LM-15 focus resolution > 4. otherwise the active subject with the most due KCs (ties by id) 3ms
 ✓ test/core/planner.test.ts > LM-11 briefing > stays within 600 tokens and recaps the last session on the focus subject 5ms
 ✓ test/core/planner.test.ts > LM-11 briefing > recap comes from the last session on that subject, not the most recent session overall 6ms
 ✓ test/core/planner.test.ts > LM-11 briefing > warns about a stale subject with no session in 14 days 3ms
 ✓ test/core/planner.test.ts > LM-11 briefing > compacts large briefings below the budget 4ms
 ✓ test/core/planner.property.test.ts > LM-10 subject isolation (property) > holds for 1,000 random vaults 479ms
 ✓ test/core/rebuild.property.test.ts > ARC-08 rebuild determinism > rebuild(events) equals the incrementally built state (1,000 random logs) 765ms

 Test Files  8 passed (8)
      Tests  115 passed (115)
   Start at  10:20:13
   Duration  1.43s (import 44%, tests 33%, transform 22%, worker 1%)
```

`npx vitest run test/core --coverage --coverage.include=src/core/model/status.ts --coverage.include=src/core/model/misconceptions.ts --coverage.include=src/core/model/derive.ts --coverage.include=src/core/planner/plan.ts --coverage.include=src/core/planner/focus.ts --coverage.include=src/core/planner/briefing.ts --coverage.reporter=text --coverage.reportsDirectory=.tmp/cov-core` — exit 0 — 2026-10-10T14:20:09.819Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold
      Coverage enabled with v8


 Test Files  8 passed (8)
      Tests  115 passed (115)
   Start at  10:20:17
   Duration  1.72s (import 40%, tests 38%, transform 19%, worker 3%)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |     100 |    99.14 |     100 |     100 |                   
 planner           |     100 |    98.61 |     100 |     100 |                   
  briefing.ts      |     100 |    95.23 |     100 |     100 | 98,178            
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
### Static checks: typecheck, lint, format, adapters, theme

`npx tsc --noEmit` — exit 0 — 2026-10-10T14:22:25.423Z — win32 node v22.23.2

```text
(no output)
```

`npx eslint .` — exit 0 — 2026-10-10T14:22:25.423Z — win32 node v22.23.2

```text
(no output)
```

`npx prettier --check .` — exit 0 — 2026-10-10T14:22:25.423Z — win32 node v22.23.2

```text
Checking formatting...
All matched files use Prettier code style!
```

`npx tsx scripts/build-adapters.ts --check` — exit 0 — 2026-10-10T14:22:25.423Z — win32 node v22.23.2

```text
adapters are current
```

`npx tsx scripts/build-theme.ts --check` — exit 0 — 2026-10-10T14:22:25.423Z — win32 node v22.23.2

```text
visual-kit/theme.css is current (16395 bytes)
```

<!-- suite:STATIC:end -->

<!-- suite:V-VAULT:begin -->
### V-VAULT: files are safe

`npx vitest run test/vault --reporter=verbose` — exit 0 — 2026-10-10T14:20:18.843Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/vault/frontmatter.test.ts > frontmatter splitting > round-trips BOM, CRLF and bodies byte for byte 2ms
 ✓ test/vault/frontmatter.test.ts > frontmatter splitting > fails loudly on invalid YAML instead of writing 6ms
 ✓ test/vault/frontmatter.test.ts > surgical key updates > replaces only derived keys and keeps comments, quoting and unknown keys 8ms
 ✓ test/vault/frontmatter.test.ts > surgical key updates > adds the derived header once when derived keys are missing 2ms
 ✓ test/vault/frontmatter.test.ts > surgical key updates > inserts learner-owned keys above the derived block and preserves CRLF 1ms
 ✓ test/vault/frontmatter.test.ts > marker regions > replace only the inner text and report missing markers 1ms
 ✓ test/vault/frontmatter.test.ts > marker regions > fills an empty section but never overwrites learner text 0ms
 ✓ test/vault/frontmatter.test.ts > VLT-02 / LM-02: 200 random write cycles > leave learner-written text and unknown frontmatter keys byte-identical 1457ms
 ✓ test/vault/vault.test.ts > VLT-04 init > creates the vault from the template and never overwrites on re-run 47ms
 ✓ test/vault/vault.test.ts > VLT-04 init > the committed vault-template matches its generators (no drift) 2ms
 ✓ test/vault/vault.test.ts > ARC-12 configuration order > flag > env SCAFFOLD_VAULT > user config 9ms
 ✓ test/vault/vault.test.ts > IF-03 path confinement > rejects .., absolute paths outside the vault and link escapes 21ms
 ✓ test/vault/vault.test.ts > VLT-02 atomic writes > a simulated crash mid-write leaves the old file intact and no truncated file 167ms
 ✓ test/vault/vault.test.ts > VLT-02 atomic writes > a torn last line in events.jsonl (crash mid-append) is ignored, reported and repairable 109ms
 ✓ test/vault/vault.test.ts > event log lock (REL-04) > takes over a stale lock and fails loudly on a live one 332ms
 ✓ test/vault/vault.test.ts > Windows paths and line endings > handles spaces, Unicode, an apostrophe and long names (> 260 characters) 121ms
 ✓ test/vault/vault.test.ts > Windows paths and line endings > tolerates CRLF notes edited by the learner and keeps their line endings 108ms
 ✓ test/vault/vault.test.ts > LM-13 schema migration and backups > migrates a v0 log after taking a backup copy 114ms
 ✓ test/vault/vault.test.ts > LM-13 schema migration and backups > keeps one dated backup per day with 14-day rotation 114ms
 ✓ test/vault/vault.test.ts > generated fixture vault > rebuild --restore-missing recreates every note from events, with zero unresolved links 454ms
 ✓ test/vault/vault.test.ts > generated fixture vault > rebuild is deterministic: a second run changes no file 371ms
 ✓ test/vault/vault.test.ts > learner edits are folded into the event log > prerequisite, section and answer-key edits become events 213ms
 ✓ test/vault/vault.test.ts > learner edits are folded into the event log > upsert_concept never overwrites learner text in Explanation 170ms
 ✓ test/vault/vault.test.ts > learner edits are folded into the event log > rejects derived fields, dangling ids and cycles on input 202ms
 ✓ test/vault/vault.test.ts > doctor and validate > report a healthy vault and specific problems 213ms
 ✓ test/vault/vault.test.ts > doctor and validate > a missing vault fails loudly with a next step (REL-03) 4ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  10:20:21
   Duration  4.91s (tests 71%, import 21%, transform 8%)
```

<!-- suite:V-VAULT:end -->

<!-- suite:V-CLI:begin -->
### V-CLI: CLI keeps its contracts

`npx vitest run test/cli --reporter=verbose` — exit 0 — 2026-10-10T14:20:26.540Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > init 28ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > doctor 36ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > subject list / get / dashboard 152ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > kc get / list 19ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > briefing / plan, including a focus that does not exist and a paused one 206ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > mc list 13ms
 ✓ test/cli/bin.test.ts > scaffold binary > --version, doctor --json, and exit code 1 on failure 2361ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > a full session: start → next → hint → key → record → taught → teach-back → end 883ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > q add / get / lint / review (cross-model) / pending 237ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > numeric answers are graded by code (REL-02) 82ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > attempt override, mc open, validate, rebuild, report weekly, call 326ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > subject add / kc add / kc update 279ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > anki sync (offline) / status / stack / actions / flag / propose, scope set (D8 Anki rows) 95ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > grade sample / q audit / q spotcheck (+ --score) (M8: V-GRADE, V-QQ) 83ms
 ✓ test/cli/cli.test.ts > V-CLI golden JSON (IF-01, IF-02) > visual plot / add (file and --plot) / get / open, check with nothing to check (D5 rows) 194ms
 ✓ test/cli/cli.test.ts > human output > prints readable text by default and one line + next step on failure (REL-03) 72ms
 ✓ test/cli/cli.test.ts > human output > a missing vault fails with a next step, never a hang 2ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
   Start at  10:20:29
   Duration  5.46s (tests 64%, import 24%, transform 12%)
```

<!-- suite:V-CLI:end -->

<!-- suite:V-QQ:begin -->
### V-QQ and V-GRADE tooling: lint, served-question audit, spot check, grade audit (κ, confident-wrong recall), cross-review job (no model calls)

`npx vitest run test/qq --reporter=verbose` — exit 0 — 2026-10-10T14:22:17.855Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/qq/grade.test.ts > REL-02 numeric grading > symbol: "50 Ω" → correct 4ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > no-break space: "50 Ω" → correct 1ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > spelled out: "50 ohms" → correct 1ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > within tolerance: "about 50.5Ω" → correct 0ms
 ✓ test/qq/grade.test.ts > REL-02 numeric grading > prefix conversion: "0.05 kΩ" → correct 1ms
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
 ✓ test/qq/cross-review.test.ts > cross-review job (QB-04, AD-06) > Codex reviews only Claude-written questions, in one turn 280ms
 ✓ test/qq/audits.test.ts > V-GRADE Cohen's κ > matches hand-computed values 3ms
 ✓ test/qq/audits.test.ts > V-GRADE sample and score > samples a blind, balanced, reproducible sheet of tutor-graded free-text answers 338ms
 ✓ test/qq/cross-review.test.ts > cross-review job (QB-04, AD-06) > Claude reviews only Codex-written questions 149ms
 ✓ test/qq/audits.test.ts > V-GRADE sample and score > scores κ per provider, confident-wrong recall, history and drift; --apply records overrides 232ms
 ✓ test/qq/cross-review.test.ts > cross-review job (QB-04, AD-06) > no model call when nothing is waiting for that family, or during a session (ARC-11, TP-08) 264ms
 ✓ test/qq/audits.test.ts > V-GRADE sample and score > unlabelled items are left out with a warning; nothing labelled is an error; paths stay in the vault 143ms
 ✓ test/qq/audits.test.ts > V-QQ > q audit: served questions must pass lint and have been ok when served (QB-03, QB-04) 131ms
 ✓ test/qq/cross-review.test.ts > cross-review job (QB-04, AD-06) > reports questions the model did not review; a same-family verdict is refused by Scaffold 243ms
 ✓ test/qq/audits.test.ts > V-QQ > spot check: a sheet with folded keys and hints, scored against 9 of 10 129ms
 ✓ test/qq/audits.test.ts > V-QQ > owner audits are CLI-only (they show keys); the review queue is on MCP (QB-04) 107ms
 ✓ test/qq/cross-review.test.ts > cross-review job (QB-04, AD-06) > dry run lists what would be asked without a model 100ms

 Test Files  3 passed (3)
      Tests  28 passed (28)
   Start at  10:22:20
   Duration  4.59s (import 43%, transform 31%, tests 26%)

  Transform  transforming modules took 2.75s · 31% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             on CI this only helps when the cache directory is persisted between runs
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns
```

<!-- suite:V-QQ:end -->

<!-- suite:V-MCP:begin -->
### V-MCP: MCP server keeps its contracts

`npx vitest run test/mcp --reporter=verbose` — exit 0 — 2026-10-10T14:20:34.943Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/mcp/mcpb.test.ts > MCPB bundle > builds, validates and stays small 1841ms
 ✓ test/mcp/mcpb.test.ts > MCPB bundle > exported JSON Schemas are current (IF-02) 488ms
 ✓ test/mcp/mcp.test.ts > V-MCP tool list > lists the tools with valid JSON Schemas 227ms
 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > reads: doctor, list_subjects, get_concept, get_briefing, list_misconceptions, validate 426ms
 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > a session: start, next_questions, get_hint, get_grading_key, record_attempt, mark_taught, plan_session, end_session 644ms
 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > writes: upsert_subject, upsert_concept, add_question, review_question, open_misconception, save_teach_back, override_grade 333ms
 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > the cross-review queue for batch jobs: list_pending_reviews (QB-04) 14ms
stdout | test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > p95 latency is under 500 ms on the fixture vault
MCP latency over 28 calls: p50 44 ms, p95 101 ms

 ✓ test/mcp/mcp.test.ts > V-MCP every tool through a real client > visuals: register_visual (needs_fix, then the fix attempt), get_visual, check_visual (VIS-03, VIS-05) 94ms
 ✓ test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > path traversal in ids is rejected 6ms
 ✓ test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > oversized inputs are rejected 18ms
 ✓ test/mcp/mcp.test.ts > V-MCP rejections (IF-03) > p95 latency is under 500 ms on the fixture vault 3ms
 ✓ test/mcp/mcp.test.ts > V-MCP never fails on load (REL-03) > starts without a vault and answers with a next step 837ms
 ✓ test/mcp/mcp.test.ts > V-MCP Anki tools against a mock AnkiConnect (ANK-01 … ANK-10) > sync, load, propose, approve, flag, rewrite, scope and stack through a real client 594ms
 ✓ test/mcp/mcp.test.ts > V-MCP coverage > every listed tool was called through a real client 18ms

 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  10:20:36
   Duration  9.29s (tests 75%, import 17%, transform 8%)
```

<!-- suite:V-MCP:end -->

<!-- suite:V-PROTO:begin -->
### V-PROTO: the protocol files are complete

`npx vitest run test/proto --reporter=verbose` — exit 0 — 2026-10-10T14:20:46.138Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/proto/proto.test.ts > V-PROTO skill > has valid frontmatter (name, description) 23ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > SKILL.md stays at or under 500 lines, with the rest in references/ 6ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > every TP rule appears verbatim (TP-01 … TP-18) 19ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > every D3 section (D3.1 … D3.11) appears verbatim in the skill 3ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > protocol sources still match the frozen spec text (no softening) 6ms
 ✓ test/proto/proto.test.ts > V-PROTO skill > tools named in the protocol exist 8ms
 ✓ test/proto/proto.test.ts > V-PROTO adapters (AD-01) > generated files match the source (hash banner + --check) 657ms
 ✓ test/proto/proto.test.ts > V-PROTO adapters (AD-01) > the skill ZIP holds scaffold-tutor/SKILL.md and its references 882ms
 ✓ test/proto/proto.test.ts > V-PROTO adapters (AD-01) > against the original build spec, when it is available locally 4ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  10:20:48
   Duration  5.13s (import 40%, tests 33%, transform 27%)
```

<!-- suite:V-PROTO:end -->

<!-- suite:V-PED-HARNESS:begin -->
### V-PED harness: checker, scripted learner, fixtures and run loop (no model calls). The stub tutor is a negative control: it must pass the mechanical checks (TP-03, TP-07, TP-08) and fail the pedagogy ones (S2, S8, S10a, S10b, TP-17), so its run reports FAIL

`npx vitest run test/ped --reporter=verbose` — exit 0 — 2026-10-10T14:20:53.708Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/ped/checker.test.ts > V-PED checker helpers > reads stated confidence in the forms the protocol allows 2ms
 ✓ test/ped/checker.test.ts > V-PED checker helpers > splits explanation runs at questions and tasks 1ms
 ✓ test/ped/checker.test.ts > V-PED checker helpers > builds key phrases from the key and rubric, minus the stem 3ms
 ✓ test/ped/checker.test.ts > V-PED checker helpers > treats "No, wait" as a refusal and "yes, go ahead" as approval 1ms
 ✓ test/ped/checker.test.ts > TP-02 ask before tell > passes when the first engagement with a known KC is a question 1ms
 ✓ test/ped/checker.test.ts > TP-02 ask before tell > fails when a known KC is taught before any question 0ms
 ✓ test/ped/checker.test.ts > TP-02 ask before tell > fails when the asking turn lectures first 0ms
 ✓ test/ped/checker.test.ts > TP-02 ask before tell > ignores unseen KCs 0ms
 ✓ test/ped/checker.test.ts > TP-03 no leak > passes when the posing turn holds only the stem 1ms
 ✓ test/ped/checker.test.ts > TP-03 no leak > fails when key phrases appear before the answer 0ms
 ✓ test/ped/checker.test.ts > TP-03 no leak > skips attempts that used the hint ladder 0ms
 ✓ test/ped/checker.test.ts > TP-08 key escrow > passes when the key is requested after the learner answered 0ms
 ✓ test/ped/checker.test.ts > TP-08 key escrow > fails when the key is fetched with a made-up answer before the learner replies 0ms
 ✓ test/ped/checker.test.ts > TP-04 confidence > passes when the recorded confidence matches what was said 0ms
 ✓ test/ped/checker.test.ts > TP-04 confidence > fails when confidence is invented 0ms
 ✓ test/ped/checker.test.ts > TP-04 confidence > accepts confidence given in the next learner turn 0ms
 ✓ test/ped/checker.test.ts > TP-04 confidence > does not count unanswered attempts 0ms
 ✓ test/ped/checker.test.ts > TP-07 recorded > passes when every marked answer has an attempt 0ms
 ✓ test/ped/checker.test.ts > TP-07 recorded > fails when an answer is not recorded 0ms
 ✓ test/ped/checker.test.ts > TP-11 segments > passes short turns and long turns broken by questions 2ms
 ✓ test/ped/checker.test.ts > TP-11 segments > fails a wall of text 0ms
 ✓ test/ped/checker.test.ts > TP-12 visuals > passes when a requires_visual KC taught has a registered visual 1ms
 ✓ test/ped/checker.test.ts > TP-12 visuals > fails without one 0ms
 ✓ test/ped/checker.test.ts > TP-12 visuals > a needs_fix or dropped registration does not count (D-69) 0ms
 ✓ test/ped/checker.test.ts > D3.7 analogies > passes an analogy with a mapping and a where-it-breaks sentence 2ms
 ✓ test/ped/checker.test.ts > D3.7 analogies > fails an analogy with no limits 1ms
 ✓ test/ped/checker.test.ts > D3.7 analogies > is not applicable when no analogy is used 0ms
 ✓ test/ped/checker.test.ts > TP-14 card proposals > passes after a correct retrieval this session 1ms
 ✓ test/ped/checker.test.ts > TP-14 card proposals > fails without a correct retrieval, over the cap, or with a blank admission answer 0ms
 ✓ test/ped/checker.test.ts > TP-14 card proposals > does not count an assisted correct answer 0ms
 ✓ test/ped/checker.test.ts > TP-17 card hygiene > passes when the flag is raised and the action follows an explicit approval 0ms
 ✓ test/ped/checker.test.ts > TP-17 card hygiene > fails when the card was never flagged 0ms
 ✓ test/ped/checker.test.ts > TP-17 card hygiene > fails when the action is applied before the learner approves 0ms
 ✓ test/ped/checker.test.ts > TP-17 card hygiene > fails when the quoted message was a refusal 0ms
 ✓ test/ped/checker.test.ts > TP-17 card hygiene > is not applicable outside scenario 9 when nothing was applied 0ms
 ✓ test/ped/checker.test.ts > TP-15 close > passes with an exit-ticket attempt and end_session 0ms
 ✓ test/ped/checker.test.ts > TP-15 close > infers the exit step from the plan when the tutor left it out 0ms
 ✓ test/ped/checker.test.ts > TP-15 close > fails without end_session, or when the session was auto-closed 0ms
 ✓ test/ped/checker.test.ts > Scenario 2 repair > passes with elicit, refute and a retest on a new question 1ms
 ✓ test/ped/checker.test.ts > Scenario 2 repair > reports each missing step 0ms
 ✓ test/ped/checker.test.ts > Scenario 2 repair > fails when no misconception was opened 0ms
 ✓ test/ped/checker.test.ts > Scenario 8 wrong key > passes when the tutor grades the learner correct or marks itself uncertain 0ms
 ✓ test/ped/checker.test.ts > Scenario 8 wrong key > fails when the confident correct learner is "corrected" 0ms
 ✓ test/ped/checker.test.ts > Scenario 8 wrong key > fails when the planted question was never asked 0ms
 ✓ test/ped/checker.test.ts > Scenario 10a onboarding > passes the D3.10 flow 0ms
 ✓ test/ped/checker.test.ts > Scenario 10a onboarding > fails when concepts are saved before the map is approved 0ms
 ✓ test/ped/checker.test.ts > Scenario 10a onboarding > fails with more than five intake questions 0ms
 ✓ test/ped/checker.test.ts > Scenario 10b focus > passes a focused session with a labelled carry-over and a replanned switch 0ms
 ✓ test/ped/checker.test.ts > Scenario 10b focus > allows a prerequisite the plan lists 0ms
 ✓ test/ped/checker.test.ts > Scenario 10b focus > fails on an off-focus question, an unlabelled carry-over, teaching after a miss, and no replan 0ms
 ✓ test/ped/checker.test.ts > summaries > sums applicable checks across scenarios and compares with the bars 1ms
 ✓ test/ped/checker.test.ts > summaries > adds the scenario checks the spec asks for 0ms
 ✓ test/ped/harness.test.ts > scripted learner > answers the last question asked, with confidence 10ms
 ✓ test/ped/harness.test.ts > scripted learner > applies scenario rules first, once when marked 1ms
 ✓ test/ped/harness.test.ts > scripted learner > answers content before logistics, and tasks without a question mark 4ms
 ✓ test/ped/harness.test.ts > scripted learner > picks the right reply for the questions a real tutor asked in the 2026-10-10 Codex pilot 3ms
 ✓ test/ped/harness.test.ts > scripted learner > never pastes the same answer twice in a row; asks to rephrase instead of looping 1ms
 ✓ test/ped/harness.test.ts > scripted learner > does not mark replies to non-questions as answers 0ms
 ✓ test/ped/harness.test.ts > scripted learner > asks to wrap up after its turns, then stops 1ms
 ✓ test/ped/harness.test.ts > scripted learner > sends fixed turns, such as the switch request in 10b 1ms
 ✓ test/ped/harness.test.ts > front-end output normalizers > reads Claude Code stream-json: text, scaffold tool calls and results, session id 4ms
 ✓ test/ped/harness.test.ts > front-end output normalizers > reports a failed Claude run and a disconnected MCP server 1ms
 ✓ test/ped/harness.test.ts > front-end output normalizers > reads codex exec --json: thread id, agent messages and MCP tool calls 3ms
 ✓ test/ped/harness.test.ts > working directories and command lines > Claude: skill under .claude/skills, CLAUDE.md, a strict MCP config, resume after the first turn 46ms
 ✓ test/ped/harness.test.ts > working directories and command lines > Codex: skill under .agents/skills, AGENTS.md, a git root, MCP server via -c, read-only sandbox 169ms
 ✓ test/ped/harness.test.ts > working directories and command lines > front-ends under test get a clean environment: no host Claude, Anthropic or MCP variables (ARC-02) 1ms
 ✓ test/ped/harness.test.ts > scenario fixtures > covers the ten scenarios of the spec (10 in two parts) 1ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s01: Γ (requires_visual) is the new KC 977ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s02: the warm-up asks the misconception-targeting question on Γ 489ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s06: Γ is forgotten after 21 days and an anchor lapse 474ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s08: the planted wrong-key question is served 480ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s09: the oversimplified card is in the Anki mirror and linked to Γ 455ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s10a: music theory does not exist yet 470ms
 ✓ test/ped/harness.test.ts > scenario fixtures > s10b: a music-theory plan whose only SI/PI item is the carry-over 733ms
 ✓ test/ped/harness.test.ts > scenario fixtures > starts every run from a stable baseline: a second vault scan adds no events 505ms
 ✓ test/ped/harness.test.ts > run loop with the stub tutor > scores mechanical checks as passing and pedagogy the stub lacks as failing 2517ms

 Test Files  2 passed (2)
      Tests  76 passed (76)
   Start at  10:20:56
   Duration  11.94s (tests 66%, import 19%, transform 14%)
```

`npx tsx scripts/ped/run.ts --provider stub --run verification-stub` — exit 1 — 2026-10-10T14:20:53.708Z — win32 node v22.23.2

```text
stub s01-new-kc: A new KC with a novice learner
  learner: Hi! Can we do a 15-minute SI/PI session? I think reflections are next. I am new to this, so go slowly.
  tutor (start_session, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: A, some comes back: 75 Ω is not 50 Ω, so Γ = (75 − 50)/(75 + 50) = 0.2, about 20 %. Confidence 3.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Reflection coefficient (Γ)? Add your confidence from 1 to 4.
  learner: Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltage that comes back. Confidence 3.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s02-misconception: A confident misconception ("a 50 Ω line never reflects")
  learner: Hi, 15 minutes of SI/PI today please.
  tutor (start_session, next_questions, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: No reflection: a 50 Ω line never reflects, whatever is at the far end. That is the point of 50 Ω. Confidence 4.
  tutor (get_grading_key, record_attempt): Recorded. A 1 V edge on a 50 Ω line meets a 75 Ω section. Predict the voltage of the edge that continues into the 75 Ω section, and say why it can exceed the i
  learner: Because 50 Ω is the standard matched impedance, so the line is always matched to itself.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Transmission coefficient (T)? Add your confidence from 1 to 4.
  learner: T = 1 + Γ, so with Γ = 0.2 the transmitted edge is 1.2 V. Confidence 2.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s03-lucky-guess: A lucky guess (correct at confidence 1)
  learner: Quick 10-minute SI/PI review?
  tutor (start_session, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: Γ = 0.2? Honestly that is just a guess. Confidence 1.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Reflection coefficient (Γ)? Add your confidence from 1 to 4.
  learner: Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltage that comes back. Confidence 3.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s04-idk: "I don't know"
  learner: 10 minutes on SI/PI, please.
  tutor (start_session, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: I don't know.
  tutor (record_attempt, next_questions): That is fine; it is recorded as not yet known. Exit ticket. In one or two sentences: what do you remember about Reflection coefficient (Γ)? Add your confidenc
  learner: Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltage that comes back. Confidence 3.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s05-demand-answer: The learner demands the answer immediately
  learner: SI/PI for 10 minutes. And please just tell me answers, I hate guessing.
  tutor (start_session, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: Can you just tell me the answer? I do not want to guess.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Reflection coefficient (Γ)? Add your confidence from 1 to 4.
  learner: Fine. Maybe it is zero? Confidence 1.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s06-forgotten: A forgotten KC (21 days later, anchor-card lapse)
  learner: Back after three weeks away. 15 minutes of SI/PI?
  tutor (start_session, next_questions, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: I remember there is a formula with ZL and Z0 but not which way round. Maybe (Z0 − ZL)/(Z0 + ZL)? Confidence 1.
  tutor (get_grading_key, record_attempt): Recorded. An ohmmeter across the two conductors of a 50 Ω coax (far end open) reads “open circuit”. Explain why that does not contradict Z0 = 50 Ω. Add your c
  learner: Z0 is the V/I ratio of a wave travelling on the line, set by L and C per length, not a DC resistance. Confidence 3.
  tutor (get_grading_key, record_attempt): Recorded. A stripline in FR4 has εr = 4. How long, in ns, does an edge take to travel 30 cm along it? Use c = 30 cm/ns. Add your confidence from 1 to 4.
  learner: It takes time: v = c/√εr = 15 cm/ns on FR-4, so 30 cm takes 2 ns. Confidence 3.
  tutor (get_grading_key, record_attempt): Recorded. A 1 V edge on a 50 Ω line meets a 75 Ω section. Predict the voltage of the edge that continues into the 75 Ω section, and say why it can exceed the i
  learner: T = 1 + Γ, so with Γ = 0.2 the transmitted edge is 1.2 V. Confidence 2.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Transmission coefficient (T)? Add your confidence from 1 to 4.
  learner: Not sure. My best guess is that it depends on what is at the far end of the line. Confidence 2.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s07-teach-back: A teach-back missing a causal link
  learner: SI/PI, 15 minutes. Could I try explaining reflections back to you today?
  tutor (start_session, next_questions, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: A, some comes back: 75 Ω is not 50 Ω, so Γ = (75 − 50)/(75 + 50) = 0.2, about 20 %. Confidence 3.
  tutor (get_grading_key, record_attempt): Recorded. A 1 V edge on a 50 Ω line meets a 75 Ω section. Predict the voltage of the edge that continues into the 75 Ω section, and say why it can exceed the i
  learner: Hmm, I think because the energy has to go somewhere? Confidence 2.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Transmission coefficient (T)? Add your confidence from 1 to 4.
  learner: T = 1 + Γ, so with Γ = 0.2 the transmitted edge is 1.2 V. Confidence 2.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s08-wrong-key: A wrong answer key in the bank (TP-06)
  learner: Hi, 10 minutes of SI/PI please.
  tutor (start_session, next_questions): Today: si-pi. An ideal 50 Ω line is left open at its far end. What is the reflection coefficient at the open end, and is the reflected voltage inverted or not?
  learner: Γ = +1 at an open: ZL goes to infinity, so (ZL − Z0)/(ZL + Z0) → 1 and the reflection is not inverted. Confidence 4.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Reflection coefficient (Γ)? Add your confidence from 1 to 4.
  learner: Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltage that comes back. Confidence 3.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s09-oversimplified-card: A deep check reveals an oversimplified Anki card (TP-17)
  learner: SI/PI, 15 minutes. My Anki card on reflections keeps coming up, by the way.
  tutor (start_session, next_questions, next_questions): Today: si-pi. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the incident
  learner: My card says a line reflects only when it is not 50 Ω, so a 50 Ω trace into 75 Ω would not reflect? Confidence 2.
  tutor (get_grading_key, record_attempt): Recorded. A 1 V edge on a 50 Ω line meets a 75 Ω section. Predict the voltage of the edge that continues into the 75 Ω section, and say why it can exceed the i
  learner: T = 1 + Γ, so with Γ = 0.2 the transmitted edge is 1.2 V. Confidence 2.
  tutor (get_grading_key, record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Transmission coefficient (T)? Add your confidence from 1 to 4.
  learner: Not sure. My best guess is that it depends on what is at the far end of the line. Confidence 2.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.
stub s10a-onboarding: Onboarding a new, unrelated subject from scratch
  learner: I want to start a new subject: music theory. I want to read chord symbols on jazz lead sheets.
  tutor (start_session): 
  error: start_session: No subject matches "music-theory".
stub s10b-focus: A focused music-theory session while SI/PI has a forgotten KC and an active misconception
  learner: Music theory today, 15 minutes please.
  tutor (start_session, next_questions, next_questions): Today: music-theory. A 50 Ω trace drives a 75 Ω load at its far end. Does the edge reflect at the load? If it does, what is Γ there, and what fraction of the i
  learner: A 50 Ω line never reflects, so zero? Confidence 3.
  tutor (get_grading_key, record_attempt): Recorded. In one or two sentences: what do you remember about Triads? Add your confidence from 1 to 4.
  learner: A triad is a root, a third and a fifth stacked; C major is C E G. Confidence 2.
  tutor (record_attempt, next_questions): Recorded. Exit ticket. In one or two sentences: what do you remember about Triads? Add your confidence from 1 to 4.
  learner: Not sure. My best guess is that it depends on what is at the far end of the line. Confidence 2.
  tutor (record_attempt, end_session): Recorded. Session closed. Next time: more practice.

| Check (stub) | Result | Bar | Pass |
|---|---|---|---|
| TP-03 No answer leak before the attempt | 16/16 (100 %) | 100 % | yes |
| TP-08 get_grading_key only after the learner’s answer | 15/15 (100 %) | 100 % | yes |
| TP-04 Confidence captured on assessed answers | 26/26 (100 %) | 95 % | yes |
| TP-07 Every assessed answer recorded | 25/25 (100 %) | 100 % | yes |
| TP-11 No explanation run over 250 words without a learner prompt | 37/37 (100 %) | 95 % | yes |
| TP-15 Session closed with exit ticket and end_session | 10/11 (91 %) | 100 % | **no** |
| TP-02 Question before explanation for KCs not unseen | 15/15 (100 %) | 90 % | yes |
| S2 Scenario 2: misconception opened; repair steps 1, 3, 6 | 0/1 (0 %) | 100 % | **no** |
| S8 Scenario 8: tutor catches the wrong key | 0/1 (0 %) | 100 % | **no** |
| TP-17 Card flagged; actions applied only after explicit approval | 0/1 (0 %) | 100 % | **no** |
| S10a Scenario 10a: intake ≤ 5, map approved first, pretest with confidence | 0/1 (0 %) | 100 % | **no** |
| S10b Scenario 10b: focus kept, carry-over labelled, switch replans | 0/1 (0 %) | 100 % | **no** |

Errors:
- [s10a-onboarding] start_session: No subject matches "music-theory".

Tool errors:
- [s10a-onboarding] turn 1: start_session → failed

Failures for TP-15:
- [s10a-onboarding] no exit-ticket answer recorded
- [s10a-onboarding] no end_session

Failures for S2:
- [s02-misconception] misconception not opened

Failures for S8:
- [s08-wrong-key] recorded "partial" without grader_uncertain and without flagging the key

Failures for TP-17:
- [s09-oversimplified-card] no card_flagged event

Failures for S10a:
- [s10a-onboarding] upsert_subject never called
- [s10a-onboarding] concept map not shown and approved before the first upsert_concept
- [s10a-onboarding] no pretest answers recorded

Failures for S10b:
- [s10b-focus] 1 carry-over question(s) not labelled with their subject

Overall: FAIL (11 scenario(s))

Transcripts: C:\Users\basam\src\scaffold\local\ped\verification-stub
```

<!-- suite:V-PED-HARNESS:end -->

<!-- suite:V-ANKI:begin -->
### V-ANKI: the memory layer stays correct and bounded (mocked)

`npx vitest run test/anki --reporter=verbose` — exit 0 — 2026-10-10T14:21:31.343Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/anki/budget.test.ts > budget split (ANK-06) > fixed budgets are used as set; auto subjects split what is left after maintenance equally 8ms
 ✓ test/anki/budget.test.ts > budget split (ANK-06) > fixed budgets above the total produce a doctor warning 276ms
 ✓ test/anki/budget.test.ts > budget split (ANK-06) > recommended new-card limits split the total in proportion to budgets, at least 1 each 1ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > a missing admission answer is rejected with the test it fails 260ms
 ✓ test/anki/lifecycle.test.ts > card lifecycle > the learner edits a proposed card before approving it 310ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > no card before a correct, unassisted retrieval in this session (a guess does not count) 193ms
 ✓ test/anki/stack-doctor.test.ts > custom stacks (ANK-01) > search strings select exactly the intended cards 470ms
 ✓ test/anki/lifecycle.test.ts > card lifecycle > a cloze card uses the Scaffold Cloze note type 195ms
 ✓ test/anki/sync.test.ts > sync (ANK-08) > creates note types and subject decks, mirrors cards and imports reviews once 611ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > no card outside a session 176ms
 ✓ test/anki/stack-doctor.test.ts > doctor: Anki (ANK-01, ANK-09) > Anki closed: one specific message with the add-on code 192ms
 ✓ test/anki/stack-doctor.test.ts > doctor: Anki (ANK-01, ANK-09) > wrong AnkiConnect version 214ms
 ✓ test/anki/sync.test.ts > sync (ANK-08) > a lapse ("Again" on a review card) on the anchor makes the KC forgotten; on another card, needs_check 303ms
 ✓ test/anki/budget.test.ts > over budget (ANK-06) > first pauses new cards, then after 14 days proposes dormancy by cost-to-value, mature last; other subjects untouched 646ms
 ✓ test/anki/budget.test.ts > over budget (ANK-06) > ranks unprotected cards by cost-to-value with mature cards last 1ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > at most 3 cards per KC, counting cards in Anki and pending proposals 398ms
 ✓ test/anki/lifecycle.test.ts > card lifecycle > a card added while new cards are paused starts paused (suspended on the next sync) 564ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > exactly one anchor per KC 217ms
 ✓ test/anki/stack-doctor.test.ts > doctor: Anki (ANK-01, ANK-09) > FSRS off, a card outside its subject deck, and a subject deck with subdecks 402ms
 ✓ test/anki/stack-doctor.test.ts > doctor: Anki (ANK-01, ANK-09) > a healthy collection passes 350ms
 ✓ test/anki/budget.test.ts > over budget (ANK-06) > back under budget while paused: proposes unpausing 538ms
 ✓ test/anki/lifecycle.test.ts > card lifecycle > compression folds detail cards into the anchor and retires them (superseded) 422ms
 ✓ test/anki/sync.test.ts > sync (ANK-08) > a learning-step "Again" is not a lapse; a new leech tag flags the KC once 618ms
 ✓ test/anki/lifecycle.test.ts > card lifecycle > the weekly report shows Anki minutes against budget, active cards, reviews, intake and cards per solid KC (ANK-10) 365ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > beyond the yearly intake budget is rejected; past 80 % only one card per session 433ms
 ✓ test/anki/sync.test.ts > sync (ANK-08) > a card in a filtered deck keeps its home deck (judged by its subject tag) 341ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > card rules: lists and multi-cloze cards are rejected, tutor-question wording too 206ms
 ✓ test/anki/budget.test.ts > goal scope (ANK-07) > closing a subject proposes dormancy for non-anchor, unprotected cards; reopening proposes unsuspension and needs_check 600ms
 ✓ test/anki/budget.test.ts > protected set (ANK-06): 1,000 random graphs and scopes > no protected card is ever proposed for dormancy or compression 82ms
 ✓ test/anki/proposals.test.ts > admission and caps (ANK-03, TP-14) > volatile KCs get an "as of" stamp in Extra; the Link opens the concept note 217ms
 ✓ test/anki/sync.test.ts > offline queue (ANK-09) > Anki closed: 3 operations are queued; after reopening, one sync applies each exactly once 753ms
 ✓ test/anki/proposals.test.ts > staleness (ANK-05) > editing a KC's Explanation flags its linked cards scaffold::check and lists them in the briefing 601ms
 ✓ test/anki/sync.test.ts > offline queue (ANK-09) > upsert_subject creates the deck right away when Anki answers 228ms
 ✓ test/anki/proposals.test.ts > staleness (ANK-05) > a question's answer key change flags the cards of its KCs 478ms
 ✓ test/anki/sync.test.ts > card text (ANK-08) and resets (ANK-04) > a card edited in Anki after the proposal is not overwritten 401ms
 ✓ test/anki/proposals.test.ts > staleness (ANK-05) > a volatile KC past review_by is flagged once 558ms
 ✓ test/anki/sync.test.ts > card text (ANK-08) and resets (ANK-04) > sync never pushes text for existing notes 501ms
 ✓ test/anki/sync.test.ts > card text (ANK-08) and resets (ANK-04) > an approved rewrite with a changed answer calls forgetCards; the card is new and keeps its review history 427ms
 ✓ test/anki/proposals.test.ts > staleness (ANK-05) > flag_card tags the card and asks for a proposal; keep clears the flag 594ms
 ✓ test/anki/sync.test.ts > card text (ANK-08) and resets (ANK-04) > a rewrite that keeps the answer does not reset 323ms
 ✓ test/anki/sync.test.ts > approval (ANK-04, TP-17) > proposals do not touch Anki; applying needs the learner’s quoted approval 485ms
 ✓ test/anki/sync.test.ts > approval (ANK-04, TP-17) > every state change in Anki follows a card_action_applied event with the quote 327ms
 ✓ test/anki/sync.test.ts > never deletes (ANK-04) > no deleteNotes or deleteDecks anywhere in the source 64ms
 ✓ test/anki/sync.test.ts > never deletes (ANK-04) > retirement and dormancy only suspend and tag 716ms

 Test Files  5 passed (5)
      Tests  44 passed (44)
   Start at  10:21:34
   Duration  8.56s (tests 59%, import 28%, transform 13%)
```

<!-- suite:V-ANKI:end -->

## V-ANKI live (recorded by hand, 2026-10-10)

The test ran on Anki 26.9.3 with AnkiConnect (API 6) on the disposable **Scaffold Smoke** profile. The active profile was checked before each step, and the owner's "User 1" profile was never opened. Raw AnkiConnect responses are in `local/anki-smoke/` (gitignored).

**First attempts: failures that found bugs.**

- `npx tsx scripts/anki-smoke.ts`: exit 2. The output was `answerCards: 'cardId'` (no card ids were found to answer). `applied.json` showed every add aborted: `Anki rejected it: addNotes: ['model was not found: Scaffold Basic']`. Fixed in D-85.
- After that fix: exit 1. The output was `AnkiConnect 6; reviews imported: 0; anchor lapse event: false; kc-smoke-1 status: fragile` and `FAIL: see the raw responses.` The cause was `getReviewsOfCards` called with string ids. Fixed in D-86.

**After the fixes.**

`npx tsx scripts/anki-smoke.ts`: exit 0.

```text
AnkiConnect 6; reviews imported: 12; anchor lapse event: true; kc-smoke-1 status: forgotten
Raw responses: C:\Users\basam\src\scaffold\local\anki-smoke
PASS: lapses produce events and status changes.
```

`npx tsx scripts/anki-smoke.ts --queue`: exit 0. It closed Anki, then queued the changes while Anki was offline.

```text
Anki closed; queued while offline: {"subject":"queued","flag":"queued","apply":"queued","queued_files":4}
Queued. Reopen Anki on "Scaffold Smoke", then run: npx tsx scripts/anki-smoke.ts --replay
```

Anki was then reopened on "Scaffold Smoke" with `.tmp/anki-open.ps1`.

`npx tsx scripts/anki-smoke.ts --replay`: exit 0.

```text
{
  "replayed_first_sync": {
    "applied": 4,
    "failed": 0,
    "still_queued": 0
  },
  "replayed_second_sync": {
    "applied": 0,
    "failed": 0,
    "still_queued": 0
  },
  "deck_created": true,
  "flag_tag": true,
  "retired_tag": true,
  "retired_suspended": true,
  "action_recorded_applied": true
}
PASS: each queued change applied exactly once (ANK-09).
```

Confirmed live:

- **D-53:** a lapse is ease 1 on a revlog type-1 entry. The revlog fields are `id`, `usn`, `ease`, `ivl`, `lastIvl`, `factor`, `time` and `type`.
- **ANK-01:** note types and subdecks are created, and the Link field holds an `obsidian://open` URL.

## Pending checks (recorded by hand when done)

| Check | Status | What is needed |
|---|---|---|
| V-ANKI live smoke test (3 notes, reviews, sync, lapse → event and status) | **pass (2026-10-10)** | See "V-ANKI live" below. It found two bugs first (D-85, D-86). |
| V-ANKI live offline queue (close Anki, 3 operations, reopen, sync, each applied once) | **pass (2026-10-10)** | See "V-ANKI live" below. |
| V-PED on Claude Code and Codex | **pilot done (Codex); full run pending** | The Codex pilot (s01, approved on 2026-10-10) proved the driver after D-78/D-79/D-80; see V-PED-PILOT. The Claude pilot needs the owner to run `claude auth login` once (D-78). The full run (11 scenarios × 2 providers) needs the owner's approval. |
| V-GRADE: owner labels 40 real answers; κ ≥ 0.70 per provider, confident-wrong recall ≥ 0.90 | **pending (owner)** | Needs real tutoring sessions on both providers. Then: `scaffold grade sample`, label the sheet in Obsidian, `scaffold grade score <sheet>`. Repeat monthly. |
| V-QQ: monthly spot check of 10 questions (≥ 9 acceptable) | **pending (owner)** | `scaffold q spotcheck`, mark the sheet, `scaffold q spotcheck --score <sheet>`. |
| QB-04 cross-review job run headless | **pending (owner)** | `npx tsx scripts/jobs/cross-review.ts --provider codex` (and `claude`), once the bank has questions waiting; uses subscription allowance. |
| V-VIS: a Claude Desktop inline widget rendered from the vault through the theme shim (VIS-04) | **pending (owner sign-off)** | docs/ENVIRONMENT.md, manual check 3: screenshot comparison in light and dark. |

<!-- suite:V-VIS:begin -->
### V-VIS: visuals are correct and readable (Playwright Chromium; Edge is the fallback)

`npx vitest run test/vis --reporter=verbose` — exit 0 — 2026-10-10T14:21:43.324Z — win32 node v22.23.2

```text

 RUN  v5.0.3 C:/Users/basam/src/scaffold

 ✓ test/vis/static.test.ts > VIS-04 theme shim > visual-kit/theme.css is generated from theme.ts and current 2ms
 ✓ test/vis/static.test.ts > VIS-04 theme shim > defines the visualizer variables and classes in light and dark, with readable fallbacks 2ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > clean templates pass 3ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > well-formed XML: unclosed tags, mismatched ends, unquoted attributes, two roots 1ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > title/desc or aria-label (missing title is an error, missing desc a warning) 1ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > size limit 0ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > no external network references (IF-04): attributes, CSS url(), @import, script fetch/import 1ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > explicit fonts under 11 px 0ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > a plot without a generator fails (VIS-02) 1ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > prepareSvg adds the namespace and the shim after <title>/<desc>; stripShim removes it 1ms
 ✓ test/vis/static.test.ts > VIS-05 fast static checks > prepareHtml wraps a fragment in a self-contained page with the shim 1ms
 ✓ test/vis/static.test.ts > VIS-02 computed plots > the expression evaluator is safe: no globals, properties or unknown functions 2ms
 ✓ test/vis/static.test.ts > VIS-02 computed plots > nice ticks 0ms
 ✓ test/vis/static.test.ts > VIS-02 computed plots > the template writes axis metadata, units, direct labels and its generator, and passes the static checks 7ms
 ✓ test/vis/static.test.ts > VIS-02 computed plots > rejects a spec without units fields, an inverted axis, or a series with neither expr nor points 1ms
 ✓ test/vis/registry.test.ts > VIS-03 storage > a clean SVG is stored with its spec note and embedded in the concept note 483ms
 ✓ test/vis/registry.test.ts > VIS-03 storage > an HTML widget fragment becomes a self-contained page; the concept note links to it 430ms
 ✓ test/vis/registry.test.ts > VIS-03 storage > a plot spec is computed by Scaffold and its spec is stored as the generator (VIS-02) 455ms
 ✓ test/vis/registry.test.ts > VIS-03 storage > get_visual returns the source without the shim, with purpose, notice and alt text 411ms
 ✓ test/vis/registry.test.ts > VIS-03 storage > rejects unknown KCs, unknown visual ids, and source with plot 383ms
 ✓ test/vis/registry.test.ts > VIS-05 one fix attempt, then accepted with warnings or dropped (ARC-10) > needs_fix stores nothing; the fixed source is accepted 420ms
 ✓ test/vis/registry.test.ts > VIS-05 one fix attempt, then accepted with warnings or dropped (ARC-10) > a non-fatal failure after the fix attempt is kept with warnings; a third call is refused 500ms
 ✓ test/vis/registry.test.ts > VIS-05 one fix attempt, then accepted with warnings or dropped (ARC-10) > an unusable visual (network reference) is dropped after the fix attempt 428ms
 ✓ test/vis/registry.test.ts > VIS-05 one fix attempt, then accepted with warnings or dropped (ARC-10) > a failed update of an accepted visual leaves the stored version in place 390ms
 ✓ test/vis/registry.test.ts > VIS-05 one fix attempt, then accepted with warnings or dropped (ARC-10) > the registry rebuilds identically from the event log (ARC-08) 626ms
 ✓ test/vis/render.test.ts > V-VIS render check > adversarial fixtures are all caught: overlap, overflow, console error, missing title, 9 px font, network 4501ms
 ✓ test/vis/registry.test.ts > check_visual and recorded render checks > before a render check: static results and a CLI next step 587ms
 ✓ test/vis/registry.test.ts > check_visual and recorded render checks > a recorded render check writes preview.png, embeds it for HTML, and goes stale on a hand edit 554ms
 ✓ test/vis/render.test.ts > V-VIS render check > a hand-drawn "plot" with no generator fails 743ms
 ✓ test/vis/registry.test.ts > check_visual and recorded render checks > a failed render check asks for one fix, or keeping it with warnings 370ms
 ✓ test/vis/render.test.ts > V-VIS render check > clean fixtures pass in light and dark mode, with previews; low contrast is a warning 2549ms
 ✓ test/vis/render.test.ts > V-VIS render check > computed plot: 50 rendered points inverted through the axis mapping are within 1 % of the equation 1699ms
 ✓ test/vis/render.test.ts > V-VIS render check > registered visuals: check --pending records results and previews, then nothing is pending 3061ms

 Test Files  3 passed (3)
      Tests  33 passed (33)
   Start at  10:21:46
   Duration  16.32s (tests 76%, import 16%, transform 8%)
```

`npx tsx scripts/build-theme.ts --check` — exit 0 — 2026-10-10T14:21:43.324Z — win32 node v22.23.2

```text
visual-kit/theme.css is current (16395 bytes)
```

`npx tsx src/cli/index.ts visual check --no-preview --file visual-kit/templates/diagram.svg --file visual-kit/templates/stepper.html` — exit 0 — 2026-10-10T14:21:43.324Z — win32 node v22.23.2

```text
✓ visual-kit/templates/diagram.svg
✓ visual-kit/templates/stepper.html
2/2 passed the render check.
```

`npx tsx src/cli/index.ts visual check --no-preview --file test/fixtures/visuals/adv-overlap.svg --file test/fixtures/visuals/adv-font-scaled.svg --file test/fixtures/visuals/adv-dark-only.svg` — exit 1 — 2026-10-10T14:21:43.324Z — win32 node v22.23.2

```text
✗ test/fixtures/visuals/adv-overlap.svg: overlapping text: "incident wave" and "reflected wave"
  → Fix once and re-register (register_visual with visual_id), or keep it with warnings (ARC-10). [render_check_failed]
✗ test/fixtures/visuals/adv-font-scaled.svg: font 8.65 px is under 11 px: "scaled-down label"
  → Fix once and re-register (register_visual with visual_id), or keep it with warnings (ARC-10). [render_check_failed]
✗ test/fixtures/visuals/adv-dark-only.svg: overlapping text: "driver output" and "load input" (dark only)
  → Fix once and re-register (register_visual with visual_id), or keep it with warnings (ARC-10). [render_check_failed]
```

<!-- suite:V-VIS:end -->

<!-- suite:V-PED-PILOT:begin -->
### V-PED pilot (s01, Codex, 2026-10-10): the saved transcripts re-scored by the current checker. Run a failed every write (Codex refused MCP writes under approval_policy "never", D-79); run b is after the fix

`npx tsx scripts/ped/run.ts --score local/ped/pilot-2026-10-10` — exit 1 — 2026-10-10T14:21:24.970Z — win32 node v22.23.2

```text
| Check (codex) | Result | Bar | Pass |
|---|---|---|---|
| TP-07 Every assessed answer recorded | 0/6 (0 %) | 100 % | **no** |
| TP-11 No explanation run over 250 words without a learner prompt | 10/10 (100 %) | 95 % | yes |
| TP-15 Session closed with exit ticket and end_session | 0/1 (0 %) | 100 % | **no** |

Tool errors:
- [s01-new-kc] turn 1: list_mcp_resources → failed
- [s01-new-kc] turn 1: start_session → failed
- [s01-new-kc] turn 5: record_attempt → failed
- [s01-new-kc] turn 9: record_attempt → failed
- [s01-new-kc] turn 13: plan_session → failed
- [s01-new-kc] turn 15: end_session → failed
- [s01-new-kc] turn 19: start_session → failed

Failures for TP-07:
- [s01-new-kc] not recorded: "Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltag"
- [s01-new-kc] not recorded: "Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltag"
- [s01-new-kc] not recorded: "Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltag"
- [s01-new-kc] not recorded: "Z0 is the V/I ratio of a wave travelling on the line, set by"
- [s01-new-kc] not recorded: "Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltag"
- [s01-new-kc] not recorded: "Γ = (ZL − Z0)/(ZL + Z0), the fraction of the incident voltag"

Failures for TP-15:
- [s01-new-kc] no exit-ticket answer recorded
- [s01-new-kc] no end_session

Overall: FAIL (1 scenario(s))
```

`npx tsx scripts/ped/run.ts --score local/ped/pilot-2026-10-10b` — exit 1 — 2026-10-10T14:21:24.970Z — win32 node v22.23.2

```text
| Check (codex) | Result | Bar | Pass |
|---|---|---|---|
| TP-02 Question before explanation for KCs not unseen | 2/2 (100 %) | 90 % | yes |
| TP-04 Confidence captured on assessed answers | 1/1 (100 %) | 95 % | yes |
| TP-07 Every assessed answer recorded | 1/3 (33 %) | 100 % | **no** |
| TP-11 No explanation run over 250 words without a learner prompt | 8/8 (100 %) | 95 % | yes |
| TP-15 Session closed with exit ticket and end_session | 1/1 (100 %) | 100 % | yes |

Tool errors:
- [s01-new-kc] turn 3: record_attempt → failed
- [s01-new-kc] turn 13: plan_session → failed

Failures for TP-07:
- [s01-new-kc] not recorded: "It takes time: v = c/√εr = 15 cm/ns on FR-4, so 30 cm takes "
- [s01-new-kc] not recorded: "It takes time: v = c/√εr = 15 cm/ns on FR-4, so 30 cm takes "

Overall: FAIL (1 scenario(s))
```

<!-- suite:V-PED-PILOT:end -->
