@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $lnk = $ws.CreateShortcut((Join-Path $dir 'Unreleased Glass.lnk')); $lnk.TargetPath = '%~f0'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = (Join-Path '%~dp0' 'electron\icon.ico'); $lnk.WindowStyle = 7; $lnk.Description = 'Lancer Unreleased Glass (Liquid Glass)'; $lnk.Save() }" >nul 2>&1

if /i "%~1"=="--raccourci" (
  echo Raccourcis "Unreleased Glass" crees sur le Bureau et dans le Menu Demarrer.
  exit /b 0
)

if "%~1"=="" (
  start "Unreleased Glass" /min "%~f0" --run
  exit /b 0
)

node -e "const n=require('net'),s=n.connect(3018,'127.0.0.1');s.setTimeout(400);s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));s.on('timeout',()=>{s.destroy();process.exit(1)})" >nul 2>&1
if %ERRORLEVEL%==0 (
  call npx electron . --remote-debugging-port=9222
  exit /b 0
)

call npm start
