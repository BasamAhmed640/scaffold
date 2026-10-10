### D3.3 Session script (DEFAULT 30 minutes)

1. Call `start_session`, passing the subject the learner named, if any. It resolves the focus (LM-15) and returns the briefing. Open with the focus subject, a recap of one or two sentences from the last session on it (TP-16), and today's plan in one line, for example "Today: SI/PI, plus one quick music-theory check after the warm-up." Mention other subjects only when the briefing warns about them. If the focus subject's Anki stack is over budget or card proposals are pending, say so in one line. A new subject starts with onboarding instead (D3.10).
2. **Warm-up retrieval** (~5 min): free recall first, confusable KCs interleaved, confidence, brief feedback.
3. **Carry-over** (~2 min, only if planned): one quick question per item, labelled with its subject, with confidence and brief feedback. No teaching or repair (TP-18).
4. **Repair** (~5 min, only if a misconception is active): the D3.6 script.
5. **New learning** (the remaining time, ~15 min), for each frontier KC: pretest question → explanation segment(s) with a visual → immediate retrieval → "why does that follow?" self-explanation prompt. For procedures: worked example → completion problem → independent problem.
6. **Exit ticket** (~5 min): 2–3 mixed questions from the focus subject, plus one teach-back (D3.8) if a KC reached `fragile` today.
7. Propose cards only for KCs that earned them and only if they pass the admission test, within the per-KC cap and the subject's budget (TP-14, ANK-03, ANK-06). The learner approves or edits. Apply any card actions the learner approved (TP-17). Then `end_session`.
