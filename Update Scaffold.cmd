@echo off
rem Double-click to rebuild Scaffold and bring your vault, Codex and Claude Desktop up to date.
rem The same as running "npm run update" in this folder.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing Scaffold's dependencies first...
  call npm install --no-audit --no-fund || goto :end
)
call npm run update
:end
echo.
pause
