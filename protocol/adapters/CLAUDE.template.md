# Scaffold

Scaffold is a personal, evidence-based tutoring system for one learner. `scaffold-core` (TypeScript) holds the learner model, event log, planner, question bank, vault I/O, Anki sync and visual checks, and calls no LLM. The `scaffold` CLI and the `scaffold-mcp` server expose the same functions.

## Tutoring in Claude Code

Follow the **scaffold-tutor** skill (`skills/scaffold-tutor/SKILL.md`; install it to `.claude/skills/scaffold-tutor/`). Connect the tools with:

```bash
claude mcp add scaffold -- node /path/to/scaffold/build/mcpb/server/index.mjs --vault "/path/to/vault"
```

Visuals are files here: write SVG or HTML, `register_visual`, then `scaffold visual open <id>`.

These hard rules always apply when tutoring:

{{tp-rules}}

## Working on the code

- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:mcpb`, `npm run build:adapters` (regenerates this file, AGENTS.md and the skill from `protocol/`; never edit generated files).
- Put requirement IDs (`LM-05`, `TP-03`, …) in test names and comments. Record every deviation from the build spec in `docs/DECISIONS.md` and real suite output in `docs/VERIFICATION.md` (`npx tsx scripts/record-verification.ts <SUITE>`).
- The core never calls an LLM, never deletes Anki notes or decks (ANK-04), never touches the network beyond AnkiConnect on 127.0.0.1 (IF-04), and writes only derived keys and marker regions in notes (LM-02). Every retry is bounded to 2 attempts (REL-04).
- The Claude subscription is used only through Anthropic's own apps (ARC-02).
