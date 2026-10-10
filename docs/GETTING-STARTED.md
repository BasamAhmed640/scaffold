# Getting started (Windows)

Scaffold keeps a model of what you know, have forgotten and misremember. It lives as notes in your Obsidian vault, in a `Scaffold/` folder. Scaffold itself never calls an AI. Your Claude and ChatGPT subscriptions do the teaching: they reach Scaffold through its MCP server and follow the **scaffold-tutor** skill.

| Front-end | Subscription | Use it for |
|---|---|---|
| **Claude Desktop** (a normal chat) | Claude Pro | Everyday tutoring. It draws visuals inline and handles teach-backs. |
| **Codex** (app or CLI, signed in with ChatGPT) | ChatGPT Plus | Backup tutor when Claude's limits are reached, and batch jobs. |
| Claude Code (optional) | Claude Pro | The same tutoring from a terminal. |

The ChatGPT website and app cannot reach programs on your computer, so your ChatGPT plan reaches Scaffold through Codex. All front-ends share one vault, so whichever one you open picks up where the last one stopped.

## One-time setup

Run the commands in a normal PowerShell window, from the repo folder. Don't run them from inside an AI app's tools: Claude Desktop is a packaged app, and files it writes into AppData can end up in a private copy (DECISIONS.md D-88).

1. **Build** after cloning or updating:

   ```powershell
   npm install; npm run build; npm run build:mcpb; npm run build:adapters
   ```

2. **Add Scaffold to your vault.** This only creates a `Scaffold/` folder and a CSS snippet; your existing notes are not touched:

   ```powershell
   node dist\cli\index.js init "C:\path\to\your vault" --set-default
   ```

   In Obsidian, go to Settings → Appearance → CSS snippets and enable **scaffold**. Then open `Scaffold/Home.md`.

3. **Claude Desktop.** UI labels may differ slightly between versions.
   - **Extension:** double-click `dist\scaffold-mcp.mcpb`, or use Settings → Extensions → Advanced settings → Install extension. When it asks for **Obsidian vault**, choose your vault folder. Keep the extension enabled.
   - **Skill:** in Settings → Capabilities, turn on code execution. Then under Skills, choose Upload skill and pick `dist\scaffold-tutor-skill.zip`.

4. **Codex.** This command creates a "Scaffold Tutor" folder in your user folder, with the skill and Scaffold's tools connected to that folder only. Your other Codex projects are unchanged.

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\tutor-folder.ps1 -Vault "C:\path\to\your vault"
   ```

   In the Codex app, open that folder as a project and trust it when asked. Codex only loads a folder's settings once you trust it. With the CLI: `cd "$HOME\Scaffold Tutor"` and then `codex`.

5. **Claude Code (optional).** The same folder works: run `claude` in it and approve the `scaffold` server once. If the CLI is not signed in, run `scripts\setup\claude-login.ps1`.

6. **Anki (optional).**
   - **Install AnkiConnect:** with Anki closed, run `scripts\setup\install-ankiconnect.ps1`. Or in Anki, go to Tools → Add-ons → Get Add-ons and enter code `2055492159`.
   - **While you study:** keep Anki open. Cards you approve are added straight away. While Anki is closed, they wait in a queue and go in at the next sync.

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
- **Terminal (optional):** `node dist\cli\index.js doctor`, plus `briefing`, `report weekly` and `anki sync`.
- **Monthly checks:**
  - Grading: `grade sample`, label the sheet in Obsidian, then `grade score`.
  - Questions: `q spotcheck`, then `q spotcheck --score`.
  - See VERIFICATION.md (V-GRADE, V-QQ).

## Usage limits

Tutoring uses your plans' normal allowance. Claude Desktop chats and Claude Code share one Claude limit. When it runs out, continue in Codex: the vault is the same.
