# Scaffold

A personal, evidence-based tutor for one learner. Scaffold keeps an inspectable model of what you know, don't know, have forgotten and misremember, as notes in your Obsidian vault. Your Claude and ChatGPT subscriptions do the teaching through Scaffold's MCP tools and the **scaffold-tutor** skill: they ask before they tell, never reveal an answer before you try, show visuals, and propose Anki cards (only for what you have recalled correctly, and only with your OK).

Scaffold itself never calls an AI and never goes online (except AnkiConnect on 127.0.0.1). Your data stays in your vault.

## Quick start (Windows)

```powershell
git clone https://github.com/BasamAhmed640/scaffold; cd scaffold; npm install
```

Then double-click **`Update Scaffold.cmd`**. It asks for your vault once, then sets up your vault, Codex and Claude Desktop, and tells you the two clicks Claude Desktop needs from you. Run it again after any change. Full guide: [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).

## What's inside

| Part                                                                                  | Where                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Learner model, event log, planner, question bank, vault I/O, Anki sync, visual checks | `src/core/` (TypeScript, no LLM calls)            |
| `scaffold` CLI and `scaffold-mcp` server (the same tools)                             | `src/cli/`, `src/mcp/`                            |
| The Tutor Protocol (source of the skill and adapters)                                 | `protocol/` → `skills/`, `CLAUDE.md`, `AGENTS.md` |
| Vault template and visual kit                                                         | `vault-template/`, `visual-kit/`                  |
| Decisions and test evidence                                                           | `docs/DECISIONS.md`, `docs/VERIFICATION.md`       |

Development: `npm test`, `npm run typecheck`, `npm run lint`, then `npm run update`.

## License

MIT
