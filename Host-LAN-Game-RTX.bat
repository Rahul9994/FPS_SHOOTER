@echo off
rem Same as Host-LAN-Game.bat, but opens the game in its own Edge/Chrome window forced onto the dedicated GPU
rem (NVIDIA RTX / AMD) - see Play-RTX.bat. Needs Node.js 18+.
setlocal enabledelayedexpansion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js was not found. Install Node.js 18 or newer from https://nodejs.org and try again.
  pause
  exit /b 1
)
set "BROWSER="
for %%P in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"
)
if not defined BROWSER (
  echo   Could not find Microsoft Edge or Google Chrome.
  pause
  exit /b 1
)
set "PORT=7777"
if /i "%~1"=="--port" set "PORT=%~2"
start "Hollow Ridge - LAN server" cmd /k node server\index.mjs %*
timeout /t 2 /nobreak >nul
start "" "%BROWSER%" --user-data-dir="%LocalAppData%\HollowRidge\browser-profile-lan" --force_high_performance_gpu --disable-sync --no-first-run --no-default-browser-check --start-maximized --app=http://localhost:%PORT%
