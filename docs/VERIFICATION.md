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

`npx tsc --noEmit` — exit 0 — 2026-10-09T23:41:03.317Z — win32 node v22.23.2

```text
(no output)
```

`npx eslint .` — exit 0 — 2026-10-09T23:41:03.317Z — win32 node v22.23.2

```text
(no output)
```

<!-- suite:STATIC:end -->
