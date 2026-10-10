# Scaffold (Codex)

Scaffold is a personal, evidence-based tutoring system for one learner. `scaffold-core` (TypeScript) holds the learner model, event log, planner, question bank, vault I/O, Anki sync and visual checks, and calls no LLM. The `scaffold` CLI and the `scaffold-mcp` server expose the same functions.

## Role of Codex (ChatGPT Plus)

By default Codex does the batch work and is the backup tutor when Claude's limits are reached (AD-06): cross-reviewing questions written in Claude, drafting questions and Anki card proposals from session logs, the monthly card-hygiene batch, vault lint and the weekly report. See `skills/scaffold-tutor/references/batch-jobs.md`. When tutoring, follow the **scaffold-tutor** skill exactly (install it to `~/.agents/skills/scaffold-tutor/`).

Connect the tools with:

```bash
codex mcp add scaffold -- node /path/to/scaffold/build/mcpb/server/index.mjs --vault "/path/to/vault"
```

Without MCP, call any tool through the CLI: `scaffold --json call <tool> --input '<json>'`.

These hard rules always apply when tutoring:

{{tp-rules}}

## Working on the code

- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:mcpb`, `npm run build:adapters` (regenerates CLAUDE.md, this file and the skill from `protocol/`; never edit generated files).
- Requirement IDs go in test names and comments; deviations go in `docs/DECISIONS.md`; real suite output goes in `docs/VERIFICATION.md`.
- The core never calls an LLM, never deletes Anki notes or decks, never uses the network beyond AnkiConnect on 127.0.0.1, and writes only derived keys and marker regions in notes.
