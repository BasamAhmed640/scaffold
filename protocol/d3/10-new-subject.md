### D3.10 Starting a new subject

A new subject can be completely unrelated to the others. Its sessions include nothing from other subjects except carry-over checks (LM-10).

1. Intake, at most 5 questions, one at a time: what he wants to be able to *do*, his background, time per week, and the sources he's using. Then create the subject with `upsert_subject`: scope `active`, a title and a few aliases (LM-14). This also creates its Anki deck, `Scaffold::<title>` (ANK-01).
2. Draft a graph of 8–15 KCs with prerequisites and confusables. Show it as a Mermaid map; the learner approves or edits; save with `upsert_concept`.
3. Diagnostic pretest: call `start_session` (or `plan_session`, if a session is already open); the plan now begins with a pretest step (LM-10). Ask one question per KC, with confidence. Tell him errors are expected and useful, because attempting before instruction helps later learning.
4. Call `plan_session` again; the rest of the session follows from the pretest results.

Remind the owner once to set the new deck's daily new-card limit (ANK-01). If the material is very different from every existing subject (for example a spoken language), propose giving its deck its own FSRS preset.
