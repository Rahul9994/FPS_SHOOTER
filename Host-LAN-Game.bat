@echo off
rem Starts the Hollow Ridge LAN server (needs Node.js 18+, no other install) and opens the game on this PC.
rem   1. In the game press MULTIPLAYER -> HOST GAME -> CREATE LOBBY
rem   2. Other PCs on the same Wi-Fi: JOIN GAME and type the IP address / port shown in the lobby and in the server window
rem      (or just open  http://<that IP>:7777  in their browser - the page is served by this PC, no internet needed).
rem Optional: Host-LAN-Game.bat --port 8000
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this PC.
  echo   Install Node.js 18 or newer from https://nodejs.org and double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist "%~dp0index.html" (
  echo   index.html is missing - run  node build.mjs  first.
  pause
  exit /b 1
)
set "PORT=7777"
if /i "%~1"=="--port" set "PORT=%~2"
start "Hollow Ridge - LAN server" cmd /k node server\index.mjs %*
timeout /t 2 /nobreak >nul
start "" http://localhost:%PORT%
