# Decisions and deviations

Every DEFAULT value, every SHOULD that was not done, and every change from the build spec is listed here with its reason (Grading: an undocumented deviation scores 0). Requirement IDs refer to the build spec.

## Owner answers (M0, 2026-10-09)

| ID | Question (C9) | Answer |
|---|---|---|
| D-01a | Repo name, license, visibility | `BasamAhmed640/scaffold`, MIT, public |
| D-01b | Pilot subject | SI/PI transmission-line foundations (DEFAULT) |
| D-01c | Session length | 30 min (DEFAULT) |
| D-01d | Analogies | `sparing` (DEFAULT) |
| D-01e | Concept retention target | 0.85 (DEFAULT) |
| D-01f | Daily Anki minutes | 15, split equally across active `auto` subjects (DEFAULT) |
| D-01g | New cards per day | 4 in total (DEFAULT) |
| D-01h | Carry-over checks per session | up to 2 (DEFAULT) |
| D-01i | Import from `pi-anki` | no (DEFAULT) |
| D-01j | Vault for real use | `C:\Users\basam\Desktop\Basam's_Vault`, only after V-VAULT is green |
| D-01k | Anki mobile app | not asked yet; asked at M9 (only V-UI needs it) |
| D-01l | Project folder | `C:\Users\basam\src\scaffold` |

## Process

| ID | Decision | Reason |
|---|---|---|
| D-02 | AnkiConnect was not installed at M0 (a primary item, so formally STOP). The owner was told, and M1–M5 continue because they do not touch Anki; M6 waits for AnkiConnect for its live smoke test. | Reliability is unaffected (no Anki code runs before M6); the fix is a one-minute owner action. |
| D-03 | TypeScript 6.0.3 instead of the newest 7.0.2. | typescript-eslint 8.71.1 (ESLint is in the C5 stack) supports TypeScript `<6.1.0`. |
| D-04 | npm package name `scaffold-tutor`; the binaries are still `scaffold` and `scaffold-mcp`. | `scaffold` is taken on npm; the repo name stays `scaffold`. |

## Event log (LM-03)

| ID | Decision | Reason |
|---|---|---|
| D-05 | Three event types added to the D2 list: `key_requested` and `hint_requested` (QB-05 requires escrow calls to be logged with timestamps) and `question_updated` (a changed answer key must flag linked cards, ANK-05, and needs a fresh cross-model review, QB-04). | The D2 list has no event for these facts; logging them anywhere else would break event sourcing (ARC-08). |
| D-07 | `confidence` may be `null` only when `grade` is `unanswered`. | "I don't know" has no confidence to rate (LM-07); every other graded answer must carry one (TP-04). |
| D-24 | Attempts carry an optional `step` (pretest, warmup, carryover, …; may be null). | Lets reports and the pedagogy checker tell pretest answers from review answers without guessing. |

## Learner model (LM-05 … LM-09)

| ID | Decision | Reason |
|---|---|---|
| D-06 | "Unassisted correct attempt" in the status rules means correct, unassisted **and confidence ≥ 2**. A guess (confidence 1) is logged but is evidence for no status, not only for mastery. | LM-06 says a guess is not mastery evidence; letting a guess move a KC from `unseen` to `fragile` would contradict "knows what he knows". |
| D-08 | FSRS rating map extensions: `partial` → Hard, `unanswered` → Again. Concept memory starts at the first `taught` event or first evidence-correct answer, so failed pretest answers before teaching create no memory. FSRS runs without fuzz and without short-term (minute) steps. | LM-08 maps only correct/incorrect. Determinism is needed for rebuild equality (ARC-08); concept checks are day-scale. |
| D-09 | An "I don't know" at least 3 days after the last success counts toward `forgotten`, like an incorrect answer. It never opens a misconception and is excluded from calibration. | Failing to retrieve is forgetting; LM-07 only forbids treating it as a wrong guess. |
| D-14 | "The anchor Anki card lapsed since the last sync" is read as: a lapse on the anchor card later than the KC's last evidence-correct concept check. | Makes `forgotten` clear itself after the next successful check instead of sticking until another sync. |
| D-15 | Misconceptions: an exhibit is an incorrect or partial answer citing the misconception id. A new exhibit while open restarts the resolution count. A correct answer "targets" a misconception when the attempt names it or its bank question lists it in `misconception_targets`. Resolution needs ≥ 2 distinct questions and two such answers in different sessions ≥ 20 h apart. Any exhibit after resolution reopens it. Low-confidence single errors with a stated belief are kept as `candidate` so the grader can reuse the id. | Fills in the LM-05 wording precisely enough to test. |
| D-25 | `needs_check` is set by an Anki lapse, leech or stale flag on a linked card, a `card_flagged` event, or reopening the subject; it is cleared by the next attempt on that KC. It applies only to KCs that were learned (status fragile/solid/forgotten) for planning. | LM-09 sets the flag but does not say how it clears. |

## Planner and briefing (LM-10, LM-11, LM-15)

| ID | Decision | Reason |
|---|---|---|
| D-10 | The review backlog (for the "> 8 blocks new KCs" rule and briefing warnings) counts warm-up categories 1–4: forgotten, active misconception, `needs_check`, retrievability below target. "Solid, never tested with transfer" is warm-up material but not backlog. | An untested-transfer check is enrichment, not decay; counting it would block new learning for strong learners. |
| D-11 | Exit ticket: "from today" = KCs that were new, repaired or pretested today; "older" = KCs learned before today, lowest retrievability first (warm-up KCs count as older). | Otherwise every warm-up KC is "today" and the "at least 1 older" rule never applies. |
| D-12 | A forgotten prerequisite in a paused or closed subject is never planned (the property test says paused subjects never contribute). Its dependent new KC waits, with a plan note saying to reopen that subject. | Resolves "a forgotten prerequisite is reviewed first, whatever subject it belongs to" against "paused and closed subjects never contribute" in favour of the stricter rule that V-CORE tests. |
| D-13 | Time estimates (DEFAULT, in `config.json`): pretest item 1 min, warm-up item 1, carry-over item 1, prerequisite review 1, repair 5, new KC 6.5, exit ticket 5 (fixed). | D3.3 gives ~5/2/5/15/5 minutes; 6.5 min per new KC makes a full plan (5 warm-up + 2 carry-over + repair + 2 new + exit) fit exactly 30 min. |
| D-16 | Frontier = `unseen` or `introduced` KCs whose prerequisites are all fragile, solid or forgotten (a forgotten prerequisite is reviewed first). Introduced KCs come first, then prerequisite depth, then id. KCs with an active misconception go to repair, not new learning. | Introduced-but-never-retrieved KCs are continuing work. |
| D-17 | Question choice per step uses a fixed preference order of question types (warm-up: free recall first; repair: diagnose/discriminate; pretest/new: predict, easiest first). A "solid, never tested with transfer" item needs a `transfer` question; with none in the bank the plan asks the tutor to improvise one. Questions worded like the KC's Anki cards (token Jaccard ≥ 0.6) are skipped. | Implements "choose question variants…" and QB-01 item 6 deterministically. |
| D-18 | Briefing size is estimated as JSON characters ÷ 3 (conservative for JSON) and compacted in a fixed order until ≤ 600. | No offline tokenizer for either provider; ÷ 3 over-counts, so the real size stays under the limit. |

## Vault (M2: LM-01, LM-02, LM-13, VLT-01 … VLT-05)

| ID | Decision | Reason |
|---|---|---|
| D-26 | Concept notes get two derived keys beyond LM-01's list: `needs_check` (LM-09) and `due` (true when the KC is in the review backlog, D-10). | Obsidian Bases cannot reliably filter on nested `memory.next_check`; flat booleans make `due.base` and the Home dashboard robust. |
| D-27 | The v0 → v1 migration (`kc` → `kc_ids`) is synthetic: no v0 vault ever shipped. It exists so the LM-13 path (backup, pure migration, version bump) is exercised by a test. | LM-13 requires tested migrations from the first release. |
| D-28 | Note files are named by stable id (`Concepts/kc-….md`, `Subjects/<id>.md`); titles live in frontmatter and the H1. | LM-01: ids are never renamed; title edits must not break links or history. |
| D-29 | Learner edits made in Obsidian (KC fields, Explanation/Worked example text, source notes, question keys, subject fields) are folded into the event log by a vault scan at session start, briefing, plan, validate and rebuild. A scope edited by hand is recorded as a scope change with a warning (LM-14 says scope changes go through `set_subject_scope`; ignoring the edit would leave the note and the model disagreeing). | Keeps events the single history (ARC-08) and makes staleness detectable (ANK-05). |
| D-30 | `upsert_concept` writes Explanation/Worked example only when those sections are empty; otherwise it warns and leaves the learner's text alone. | LM-02 / VLT-02: never alter learner-written text. |
| D-31 | `scaffold rebuild` rewrites derived parts only; recreating deleted notes from event snapshots needs `--restore-missing`. | A deleted note may be the learner's intent. |
| D-32 | Questions write `rubric`, `hints`, `misconception_targets`, `options` and subject `goals` in block YAML; every other list or map is written in flow style, like the LM-01 example. | Long lists of objects are unreadable on one line. |
| D-33 | Source references (`sources: ["[[Bogatin SPI ch7 notes]]"]`) resolve Obsidian-style: a vault path, then `Scaffold/Sources/`, then a unique file name anywhere in the vault (bounded walk of 20,000 entries). | ANK-05 needs to notice source-note changes without a plugin. |
| D-34 | Event-log writes take a lock file (`_system/events.lock`, stale after 30 s, 2 attempts). Atomic renames retry once on Windows `EPERM/EBUSY/EACCES`. | Claude Desktop (MCP) and the CLI may write at the same time; Windows briefly locks files that Obsidian or antivirus has open. Both are REL-04 retry sites. |
