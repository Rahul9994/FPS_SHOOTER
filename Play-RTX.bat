@echo off
rem Opens Hollow Ridge in its own Edge/Chrome window, forced onto the high-performance GPU (e.g. your NVIDIA RTX)
rem instead of the Intel/AMD integrated one. Needs no Python or server - it opens index.html directly.
rem A separate browser profile is used so the GPU flag is honoured even when Edge/Chrome is already open
rem (the game's settings are stored in that profile, not in your normal browser).
rem Extra arguments are passed on to the browser.
setlocal enabledelayedexpansion
set "BROWSER="
for %%P in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if not defined BROWSER if exist "%%~P" set "BROWSER=%%~P"
)
if not defined BROWSER (
  echo Could not find Microsoft Edge or Google Chrome.
  pause
  exit /b 1
)
set "URL=file:///%~dp0index.html"
set "URL=!URL:\=/!"
set "URL=!URL: =%%20!"
start "" "%BROWSER%" --user-data-dir="%LocalAppData%\HollowRidge\browser-profile" --force_high_performance_gpu --disable-sync --no-first-run --no-default-browser-check --start-maximized %* --app="!URL!"
