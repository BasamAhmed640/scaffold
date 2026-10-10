# Signs the standalone Claude Code CLI in with your Claude subscription, for headless V-PED runs and
# batch jobs. Run from a normal terminal (a Claude page opens in the browser: click Authorize):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\claude-login.ps1
# Subscription login only (ARC-01/02). Outside the Claude Desktop session that may have launched this
# terminal (D-78): the host's CLAUDE*/ANTHROPIC*/MCP_* variables are cleared for this process only.
Get-ChildItem Env: | Where-Object { $_.Name -match '^(CLAUDE|ANTHROPIC|MCP_)' } | ForEach-Object { Remove-Item "Env:$($_.Name)" }
# Claude Desktop is an MSIX app: %APPDATA%\Claude exists only inside its package; outside, the files
# live under %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude (D-88).
$roots = @("$env:APPDATA\Claude\claude-code") + (Get-ChildItem "$env:LOCALAPPDATA\Packages" -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'LocalCache\Roaming\Claude\claude-code' })
$exe = $roots | Where-Object { Test-Path $_ } | ForEach-Object { Get-ChildItem $_ -Recurse -Filter claude.exe -ErrorAction SilentlyContinue } | Sort-Object FullName | Select-Object -Last 1
if (-not $exe) { Write-Host "claude.exe not found under: $($roots -join '; ')"; exit 1 }
Write-Host ""
Write-Host "Signing Claude Code in with your Claude subscription."
Write-Host "A Claude page opens in your browser: click Authorize. If it then shows a code, paste it here and press Enter."
Write-Host ""
& $exe.FullName auth login --claudeai
Write-Host ""
& $exe.FullName auth status
