@echo off
rem Starts a tiny local web server (needs Python) and opens the game.
cd /d "%~dp0"
start "" http://localhost:8137/index.html
python -m http.server 8137
