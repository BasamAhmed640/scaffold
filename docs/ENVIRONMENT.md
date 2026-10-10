# Environment (M0 spike)

Recorded on the owner's PC on 2026-10-09. Re-run the probes in `scripts/probes/` after any upgrade and update this file.

## Machine

| Item | Value | Result |
|---|---|---|
| OS | Windows 11 Home (10.0.26200), time zone Eastern Standard Time (`America/New_York`) | pass |
| Node.js | v22.23.2 (LTS line 22), npm 10.9.8 | pass |
| git / GitHub CLI | git 2.55.0.windows.3, gh 2.101.0, logged in as `BasamAhmed640` | pass |
| WSL | not installed; not needed (Codex runs natively, see below) | n/a |

## Front-ends

| Item | Value | Result |
|---|---|---|
| Claude Desktop | installed (`claude-desktop.exe`); config at `%APPDATA%\Claude\claude_desktop_config.json` | pass (installed) |
| Claude Desktop: local MCP "hello" tool, uploaded skill and inline visual in one chat | needs the owner; see "Manual checks" below | **pending (owner)** |
| Claude Code | 2.1.295, bundled with Claude Desktop at `%APPDATA%\Claude\claude-code\2.1.295\…\claude.exe` (not on `PATH`) | pass |
| Claude Code headless | `claude -p` (print mode), `--resume <session-id>`, `--continue`, `--output-format stream-json`, `--mcp-config` all listed in `--help` | pass (flags present) |
| Claude Code login (standalone CLI) | It was not logged in at first: the Desktop Code tab uses the app's own login. On 2026-10-10 `scripts/setup/claude-login.ps1` ran `claude auth login --claudeai` from a normal terminal, and the owner clicked Authorize. `claude auth status` now reports `loggedIn: true`, `authMethod: claude.ai`, subscription `pro` (D-78, D-89). | pass |
| Codex CLI | codex-cli 0.160.1 at `%LOCALAPPDATA%\OpenAI\Codex\bin\…\codex.exe` (not on `PATH`), `codex login status` → "Logged in using ChatGPT" | pass |
| Codex headless | `codex exec`, `codex exec resume [SESSION_ID] [PROMPT]` / `--last`, `--json` | pass (flags present) |
| Codex MCP | `codex mcp add <name> -- <command>` | pass (command present) |
| Codex skills path | user level `~/.agents/skills/<name>/SKILL.md`; repo level `.agents/skills/` (OpenAI docs, "Build skills", fetched 2026-10-09). Requires `name` and `description` frontmatter. | pass (documented) |
| pi | 0.99.2 (optional front-end) | pass |

## Knowledge base and memory

| Item | Value | Result |
|---|---|---|
| Obsidian | installed; main vault `C:\Users\basam\Desktop\Basam's_Vault` (chosen for real use once V-VAULT passes) | pass |
| Anki | installed (`%LOCALAPPDATA%\Programs\Anki`), profile "User 1" | pass |
| AnkiConnect | Installed 2026-10-10 from AnkiWeb (add-on 2055492159, build of 2025-11-06, for Anki 26.9.3, point version 260903) into `%APPDATA%\Anki2\addons21\2055492159` with `scripts/setup/install-ankiconnect.ps1`. It listens on `127.0.0.1:8765` and reports API version 6. | pass |

AnkiConnect was missing at M0 (D-02) and was installed on 2026-10-10. The disposable **Scaffold Smoke** profile (sync off, no AnkiWeb key) was added for the live tests by `scripts/setup/anki-smoke-profile.ps1`, which backs up `prefs21.db` first. The owner's own profile was not opened or changed by these tests.

## Libraries (pinned exact versions)

| Package | Version | Probe |
|---|---|---|
| typescript | 6.0.3 | TS 7.0.2 exists, but typescript-eslint 8.71.1 supports `<6.1.0`, so 6.0.3 is used (D-03) |
| zod | 4.6.5 | `z.toJSONSchema()` built in; MCP SDK accepts zod `^3.25 || ^4.0` |
| @modelcontextprotocol/sdk | 1.32.1 | `scripts/probes/mcp-client-probe.mjs`: stdio server + client, `registerTool` with a zod v4 shape, list + call in ~400 ms cold start |
| ts-fsrs | 5.4.2 (`FSRSVersion` = "v5.4.2 using FSRS-6.0") | `scripts/probes/fsrs-probe.mjs`: `fsrs({request_retention: 0.85, enable_fuzz: false, enable_short_term: false})`; Good on a new card → S 2.31 d, due in 4 d; R at due 0.858 |
| yaml | 2.9.1 | used for frontmatter parsing with source ranges |
| commander | 15.0.0 (needs Node ≥ 22.12) | CLI |
| vitest / @vitest/coverage-v8 | 5.0.3 | tests and coverage |
| fast-check | 4.10.2 | property tests |
| @anthropic-ai/mcpb | 2.1.2 | `mcpb init/validate/pack/info`; manifest_version 0.3 (spec in modelcontextprotocol/mcpb `MANIFEST.md`) |
| playwright | 1.64.0 (optional dependency) | Render checker. On 2026-10-10 `%LOCALAPPDATA%\ms-playwright` held only build 1246, and `chromium.launch()` failed, so checks used the Edge fallback (`msedge 154.0.4258.62`). With the owner's approval, `npx playwright install chromium` then installed `chromium_headless_shell-1248` (Chrome Headless Shell 156.0.8078.4, 118 MiB). Checks now run on that build, and Edge remains the fallback (D-77). |
| eslint / typescript-eslint / prettier | 10.12.0 / 8.71.1 / 3.9.9 | lint and format |

## Manual checks (owner)

1. **AnkiConnect**: **pass, 2026-10-10** (VERIFICATION.md, V-ANKI live). Steps: install as above; then run `scaffold doctor`. Then the V-ANKI live smoke test (M6): in Anki, File → Switch Profile → Add a disposable profile named **Scaffold Smoke**, open it, and run `npx tsx scripts/anki-smoke.ts` (it refuses any other profile). It adds 3 notes through the proposal/approval path, reviews them, syncs, and checks that an anchor lapse produces an event and a status change; raw AnkiConnect responses go to `local/anki-smoke/` to confirm D-53, D-54 and D-66. Also: close Anki, run three operations (e.g. `scaffold subject add`, `scaffold anki flag`, an approved action), reopen Anki, `scaffold anki sync`, and check each was applied once (ANK-09).
2. **Claude Desktop, same chat**: (a) add the hello server from `scripts/probes/hello-mcp.mjs` (or the Scaffold `.mcpb` after M4), (b) upload the skill ZIP after M5 (Customize → Skills; Code execution on), (c) ask for an inline visual. Record pass/fail here with a screenshot.
3. **Inline visual through the theme shim (V-VIS, VIS-04)**:
   - In Claude Desktop, ask for an inline diagram that uses the visualizer classes (`.c-<ramp>`, `.t`, `.ts`), and save its SVG.
   - Register it with `scaffold visual add figure.svg …`, then run `scaffold visual check <id>`.
   - Compare `preview.png` and the Obsidian embed with a screenshot of the chat, in light and dark mode.
   - Add any variable or class that renders differently to `src/core/visuals/theme.ts` (D-68).
   - Sign off here.
