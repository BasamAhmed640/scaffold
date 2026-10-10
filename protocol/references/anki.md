# Anki: the memory maintenance layer (D7)

The rules below are the build spec's D7, verbatim, followed by the tool workflow.

{{include references/_d7.md}}

## Tool workflow

- **Proposing cards (TP-14, ANK-03):** only for a KC that `record_attempt` marked `card_eligible` this session. `propose_cards {cards: [{kc_id, front, back, extra?, anchor?, note_type?, admission: {rederive, instant, worth}}]}`. Each admission answer is one line. The first card of a KC must be its anchor. The core rejects a proposal beyond 3 cards per KC, without admission answers, without a correct retrieval this session, or beyond the subject's yearly intake budget, each with a specific message. Show the learner the proposals; they approve or edit.
- **Applying:** `apply_card_actions {action_ids, approval: {learner_quote}, edits?}` with the learner's own words of approval; `edits` holds their changes to a proposed card (`{"CA-0003": {back: "…"}}`). Nothing reaches Anki without it. If Anki is closed the operations are queued and replayed by `anki_sync`. `list_card_actions {}` shows what waits for approval.
- **Card hygiene (TP-17, ANK-05):** when a deep check, teach-back or explanation shows a linked card is wrong, outdated or oversimplified: `flag_card {note_id, detail, proposed: "retire" | "rewrite" | "keep" | "check"}` (or `kc_ids` when you don't know the note). Then `propose_card_actions {actions: [{kind, note_ids, reason, fields?, retire_reason?}]}` with kind `rewrite`, `rewrite_reset`, `retire` or `keep`; for a rewrite, `fields` holds the new text. A changed answer resets the card's scheduling (`forgetCards`). Apply only after explicit approval. A card edited in Anki after the proposal is never overwritten: the apply is aborted and you re-propose from the current text.
- **Scope (ANK-07):** `set_subject_scope {subject, scope}` records the change and proposes dormancy (pause/close) or unsuspension plus `needs_check` (reopen).
- **Load and budget (ANK-06):** `get_anki_load {}` (every subject and the total); the briefing shows minutes against budget, active cards and yearly intake for the focus subject. When a subject is over budget, the core proposes pausing its new cards first.
- **Custom stacks (ANK-01):** `anki_stack {name, subject?, kc_ids?, tags?, status?}` prints a filtered-deck search string; the owner creates the filtered deck in Anki (Tools → Create Filtered Deck).
- **Sync:** `anki_sync {}` replays queued operations, pushes nothing else, and pulls cards and reviews (lapses, leeches and stale flags feed the learner model, LM-09).
