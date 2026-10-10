# Getting started (Windows)

Scaffold keeps a model of what you know, have forgotten and misremember. It lives as notes in your Obsidian vault, in a `Scaffold/` folder. Scaffold itself never calls an AI. Your Claude and ChatGPT subscriptions do the teaching: they reach Scaffold through its MCP server and follow the **scaffold-tutor** skill.

| Front-end | Subscription | Use it for |
|---|---|---|
| **Claude Desktop** (a normal chat) | Claude Pro | Everyday tutoring. It draws visuals inline and handles teach-backs. |
| **Codex** (app or CLI, signed in with ChatGPT) | ChatGPT Plus | Backup tutor when Claude's limits are reached, and batch jobs. |
| Claude Code (optional) | Claude Pro | The same tutoring from a terminal. |

The ChatGPT website and app cannot reach programs on your computer, so your ChatGPT plan reaches Scaffold through Codex. All front-ends share one vault, so whichever one you open picks up where the last one stopped.

## Set up (once)

1. **Install** [Node.js](https://nodejs.org) 22 or later and [Git](https://git-scm.com). Then get Scaffold:

   ```powershell
   git clone https://github.com/BasamAhmed640/scaffold; cd scaffold; npm install
   ```

2. **Double-click `Update Scaffold.cmd`** in the scaffold folder. The first time, it asks where your Obsidian vault is. Then it:
   - builds Scaffold and runs its tests;
   - adds a `Scaffold/` folder to your vault (your own notes are not touched) and checks its health;
   - creates a **Scaffold Tutor** folder for Codex and marks it trusted in Codex (it keeps a backup of your Codex settings);
   - opens Claude Desktop's installer for the Scaffold extension, shows you the skill file, and waits while you do the next step.

3. **In Claude Desktop** (two clicks only you can make):
   - **Extension:** click **Install**, and choose your vault folder when it asks for **Obsidian vault**.
   - **Skill:** in Settings → Capabilities, turn on code execution. Then under Skills, choose Upload skill and pick `scaffold-tutor-skill.zip` (the update window shows you where it is).

   Press Enter in the update window after each one.

4. **In Obsidian:** Settings → Appearance → CSS snippets → turn on **scaffold**, then open `Scaffold/Home.md`. The health check tells you if the snippet is still off.

Optional extras:

- **Anki:** with Anki closed, run `scripts\setup\install-ankiconnect.ps1`. Or in Anki, go to Tools → Add-ons → Get Add-ons and enter code `2055492159`. While you study, keep Anki open. Cards you approve are added straight away. While Anki is closed, they wait in a queue and go in at the next sync.
- **Claude Code:** run `claude` in the Scaffold Tutor folder and approve the `scaffold` server once. If the CLI is not signed in, run `scripts\setup\claude-login.ps1`.

Use `Update Scaffold.cmd` or a normal terminal rather than an AI app's built-in terminal. Claude Desktop is a packaged app, and files it writes into AppData can end up in a private copy (DECISIONS.md D-88).

## Turning Scaffold on and off

- **Claude Desktop:** Settings → Extensions → **Scaffold tutor** is the switch. When it is off, your chats are ordinary chats. The skill stays installed but keeps out of the way (D-93).
- **Codex:** Scaffold exists only inside the Scaffold Tutor folder. Your other projects never see it.

## After a change

Double-click `Update Scaffold.cmd` again (or run `npm run update`). If a test fails, it stops before Codex or Claude change. Otherwise it brings everything up to date and only asks you for what changed:

- Reinstall the Claude Desktop extension, if the server changed.
- Re-upload the skill, if the skill changed.

**Where to make changes:**

- **How the tutor behaves:** the Markdown files in `protocol/`. Never edit `CLAUDE.md`, `AGENTS.md` or `skills/`; they are generated from `protocol/`.
- **How Scaffold decides** (planner, scoring, tools): `src/core/`.

Or ask Claude Code or Codex to make the change in this repo; `CLAUDE.md` and `AGENTS.md` tell them the rules.

## A tutoring session

- **Start:** "Start a session", or "Start a session on music theory, 20 minutes".
- **New subject:** the tutor offers to create it and maps it with you before teaching, starting from at most 5 concepts.
- **Answer with a confidence from 1 to 4**, for example "50 Ω, 3". "I don't know" is a fine answer. Ask for a hint at any time.
- **Change of plan:** say so ("switch to SI/PI", "I only have 10 minutes") and the tutor replans.
- **Anki cards are only proposed.** Nothing is added until you say yes, and nothing is ever deleted.
- **Stop:** say you need to stop. You get a short exit question, and the session log is written to `Scaffold/Sessions/`.
- **One session at a time,** in one front-end.

## Batch jobs (Codex by default)

Ask in the Scaffold Tutor folder (see `references/batch-jobs.md` in the skill):

- "Run the cross-review batch job." Each AI reviews questions the other one wrote. A question is only asked in sessions after it passes review. To run it without opening Codex: `npx tsx scripts/jobs/cross-review.ts --provider codex`.
- "Draft bank questions for the improvise items", "Monthly card hygiene", "Vault lint", "Weekly report".

## Where to look

- **Obsidian:** `Scaffold/Home.md` (dashboard), concept notes (status, misconceptions, visuals, questions), `Scaffold/Sessions/` (logs) and `Scaffold/Visuals/`. Interactive visuals open from their note in your browser.
- **Health check:** `npm run doctor`.
- **Terminal (optional):** `node dist\cli\index.js briefing`, `report weekly` and `anki sync`.
- **Monthly checks:**
  - Grading: `grade sample`, label the sheet in Obsidian, then `grade score`.
  - Questions: `q spotcheck`, then `q spotcheck --score`.
  - See VERIFICATION.md (V-GRADE, V-QQ).

## Usage limits

Tutoring uses your plans' normal allowance. Claude Desktop chats and Claude Code share one Claude limit. When it runs out, continue in Codex: the vault is the same.
