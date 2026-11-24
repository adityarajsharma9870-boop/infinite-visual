@echo off
title Ghostflix Streamer
cd /d "%~dp0"
echo ========================================================
echo   Starting Ghostflix / Netflix Free Streaming App...
echo ========================================================
echo.
start "" "http://localhost:3000/#play?id=1311031&type=movie"
node server.js
pause

