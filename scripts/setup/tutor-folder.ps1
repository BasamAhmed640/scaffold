# Creates (or refreshes) a "Scaffold Tutor" folder that Codex and Claude Code open for tutoring:
# the scaffold-tutor skill and adapters for both, and the Scaffold MCP server for this folder only,
# so your other Codex and Claude Code projects are unchanged. Run from a normal terminal in the repo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\tutor-folder.ps1 -Vault "<your vault>"
# Optional: -Folder "<where>" (default: "Scaffold Tutor" in your user folder). Re-run after updates.
param(
  [Parameter(Mandatory = $true)][string]$Vault,
  [string]$Folder = (Join-Path $env:USERPROFILE 'Scaffold Tutor')
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$server = Join-Path $repo 'build\mcpb\server\index.mjs'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'Node.js is not on PATH.'; exit 1 }
if (-not (Test-Path $server)) { Write-Host "Missing $server - run: npm run build:mcpb"; exit 1 }
if (-not (Test-Path (Join-Path $Vault 'Scaffold'))) { Write-Host "No Scaffold/ in $Vault - run scaffold init first (see docs/GETTING-STARTED.md)."; exit 1 }

New-Item -ItemType Directory -Force $Folder | Out-Null
# Adapters and the skill (generated from protocol/; refreshed on every run)
Copy-Item -Force (Join-Path $repo 'AGENTS.md') $Folder
Copy-Item -Force (Join-Path $repo 'CLAUDE.md') $Folder
foreach ($dir in '.agents\skills', '.claude\skills') {
  $target = Join-Path $Folder "$dir\scaffold-tutor"
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
  Copy-Item -Recurse (Join-Path $repo 'skills\scaffold-tutor') $target
}

# Codex: project config (loaded once you trust the folder). Scaffold's tools are pre-approved for this
# server only, so Codex does not stop to ask before recording an answer (D-79).
$toml = { param($s) '"' + ($s -replace '\\', '\\' -replace '"', '\"') + '"' }
# UTF-8 without a byte-order mark (Windows PowerShell's -Encoding utf8 adds one; TOML/JSON readers may reject it)
$utf8 = New-Object System.Text.UTF8Encoding($false)
$write = { param($path, $lines) [System.IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $utf8) }
$codex = Join-Path $Folder '.codex'
New-Item -ItemType Directory -Force $codex | Out-Null
& $write (Join-Path $codex 'config.toml') @(
  '# Scaffold MCP server for this folder only (scripts/setup/tutor-folder.ps1).',
  '[mcp_servers.scaffold]',
  "command = $(& $toml $node)",
  "args = [$(& $toml $server), `"--vault`", $(& $toml $Vault)]",
  'startup_timeout_sec = 30',
  'tool_timeout_sec = 60',
  'default_tools_approval_mode = "approve"'
)

# Claude Code: project MCP config (Claude Code asks once to approve it)
$json = @{ mcpServers = @{ scaffold = @{ command = $node; args = @($server, '--vault', $Vault) } } } | ConvertTo-Json -Depth 5
& $write (Join-Path $Folder '.mcp.json') @($json)

# Codex looks for AGENTS.md and .agents/skills from the project (git) root
if (-not (Test-Path (Join-Path $Folder '.git'))) { git -C $Folder init -q }

Write-Host "Ready: $Folder"
Write-Host '  Codex app: open this folder as a project (trust it when asked), then say "Start a session".'
Write-Host '  Claude Code: run claude in this folder (approve the scaffold server once).'
