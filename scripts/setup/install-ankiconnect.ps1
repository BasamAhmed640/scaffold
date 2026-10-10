# Installs AnkiConnect (AnkiWeb add-on 2055492159) into Anki's add-on folder, the same files Anki's
# own "Get Add-ons" would fetch. Run it from a normal terminal with Anki closed:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup\install-ankiconnect.ps1
# (Not from inside Claude Desktop's tools: that app is packaged, and its writes to AppData can land in
# a private copy that Anki never sees, D-88.)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:APPDATA 'Anki2'
$app = Join-Path $env:LOCALAPPDATA 'Programs\Anki'
if (Get-Process -Name anki -ErrorAction SilentlyContinue) { Write-Host 'Anki is running: close it, then run this again.'; exit 1 }
if (-not (Test-Path $base)) { Write-Host "No Anki data folder at $base. Open Anki once first."; exit 1 }

# AnkiWeb serves the build for the Anki version asking (point version YYMMPP, e.g. 26.9.3 -> 260903).
$point = 250000
$info = Get-ChildItem (Join-Path $app 'app_packages') -Directory -Filter 'aqt-*.dist-info' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($info -and $info.Name -match '^aqt-(\d+)\.(\d+)\.(\d+)') { $point = [int]('{0:D2}{1:D2}{2:D2}' -f [int]$Matches[1], [int]$Matches[2], [int]$Matches[3]) }
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('ankiconnect-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
$zip = Join-Path $tmp 'ankiconnect.zip'
Invoke-WebRequest -UseBasicParsing -Uri "https://ankiweb.net/shared/download/2055492159?v=2.1&p=$point" -OutFile $zip
Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'files')
if (-not (Test-Path (Join-Path $tmp 'files\__init__.py'))) { Write-Host 'The download is not an Anki add-on.'; exit 1 }

$addon = Join-Path $base 'addons21\2055492159'
New-Item -ItemType Directory -Force $addon | Out-Null
Copy-Item -Force (Join-Path $tmp 'files\*') $addon
$meta = @{ name = 'AnkiConnect'; mod = [int][double]::Parse((Get-Date -UFormat %s)); disabled = $false } | ConvertTo-Json
Set-Content -Encoding utf8 (Join-Path $addon 'meta.json') $meta
Remove-Item -Recurse -Force $tmp
Write-Host "AnkiConnect installed in $addon (for Anki point version $point). It listens on 127.0.0.1:8765 while Anki is open."
