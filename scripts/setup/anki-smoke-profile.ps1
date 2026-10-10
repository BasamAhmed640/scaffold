# Adds the disposable "Scaffold Smoke" Anki profile (sync off) and opens Anki on it, for the V-ANKI
# live smoke test (scripts/anki-smoke.ts). Your other profiles are not opened or changed; prefs21.db is
# backed up first. Run from a normal terminal in the repo:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\anki-smoke-profile.ps1
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:APPDATA 'Anki2'
$anki = Join-Path $env:LOCALAPPDATA 'Programs\Anki\Anki.exe'
$prefs = Join-Path $base 'prefs21.db'
$running = Get-Process -Name anki -ErrorAction SilentlyContinue
if (-not $running) {
  if (-not (Test-Path $prefs)) { Write-Host "No Anki profiles at $prefs. Open Anki once first."; exit 1 }
  $backup = "$prefs.before-scaffold-smoke-" + (Get-Date -Format yyyyMMdd-HHmmss)
  Copy-Item $prefs $backup
  Write-Host "Backed up prefs21.db to $backup"
  npx --no-install tsx (Join-Path $PSScriptRoot 'anki-profile.ts') $prefs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  Start-Process -FilePath $anki -ArgumentList '-p', '"Scaffold Smoke"'
  Write-Host 'Anki is starting on the "Scaffold Smoke" profile.'
} else {
  Write-Host 'Anki is already running. Close it first (the profile list can only change while Anki is closed).'
  exit 1
}
