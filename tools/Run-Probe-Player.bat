@echo off
rem Runs the player probe and keeps the window open so you can read the result.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Probe-NBAPlayer.ps1"
pause
