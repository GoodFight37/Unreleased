@echo off
setlocal
cd /d "%~dp0"

if /i "%~1"=="--raccourci" goto shortcuts

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron est absent. Lancez npm install dans ce dossier.
  pause
  exit /b 1
)
rem Reconstruit dist si absent, ou si un fichier de src\ ou electron\ est plus recent que lui.
set "REBUILD="
if not exist "dist\index.html" set "REBUILD=1"
if not defined REBUILD (
  powershell -NoProfile -Command "$d=(Get-Item 'dist\index.html').LastWriteTime; if (Get-ChildItem src,electron,package.json -Recurse -File | Where-Object { $_.LastWriteTime -gt $d } | Select-Object -First 1) { exit 1 }"
  if errorlevel 1 set "REBUILD=1"
)
if defined REBUILD (
  echo Mise a jour de l'application avec les derniers changements...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" . --load-dist
exit /b 0

:shortcuts
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $lnk = $ws.CreateShortcut((Join-Path $dir 'Unreleased Glass.lnk')); $lnk.TargetPath = '%~f0'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = (Join-Path '%~dp0' 'electron\icon.ico'); $lnk.WindowStyle = 7; $lnk.Description = 'Lancer Unreleased Glass (Liquid Glass)'; $lnk.Save() }" >nul 2>&1
echo Raccourcis "Unreleased Glass" crees sur le Bureau et dans le Menu Demarrer.
exit /b 0
