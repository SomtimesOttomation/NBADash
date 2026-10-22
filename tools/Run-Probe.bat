@echo off
setlocal
cd /d "%~dp0"

rem Run-Probe.bat          -> test run: Toronto only (full run, league-wide feeds too)
rem Run-Probe.bat -all     -> the other 14 teams (team-only), then combines all reports
rem Keep this file and Probe-NBAFeeds.ps1 in the same folder.

set "PROBE=%~dp0Probe-NBAFeeds.ps1"
set "OUT=%~dp0probe-output"

if not exist "%PROBE%" (
    echo Cannot find Probe-NBAFeeds.ps1 next to this batch file.
    pause
    exit /b 1
)

if /i "%~1"=="-all"  goto :ALL
if /i "%~1"=="/all"  goto :ALL
if /i "%~1"=="all"   goto :ALL

:TEST
echo.
echo ===== TOR test run (team + scoreboard, standings, injuries, NBA.com) =====
powershell -NoProfile -ExecutionPolicy Bypass -File "%PROBE%" -Team TOR -OutDir "%OUT%\TOR"
echo.
if exist "%OUT%\TOR\probe-report.txt" (
    echo Test run finished. Check %OUT%\TOR\probe-report.txt
    echo If it looks good, run:  Run-Probe.bat -all
) else (
    echo No report was written. Check the messages above before running -all.
)
pause
goto :EOF

:ALL
if not exist "%OUT%\TOR\probe-report.txt" (
    echo Run the Toronto test first:  Run-Probe.bat
    pause
    exit /b 1
)

for %%T in (NYK BOS DET PHI OKC SAS GSW DEN LAL MIA MIL CLE PHX MIN) do (
    echo.
    echo ===== %%T ^(team only^) =====
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PROBE%" -Team %%T -OutDir "%OUT%\%%T" -TeamOnly
)

echo.
echo Combining reports...
if exist "%OUT%\ALL-reports.txt" del "%OUT%\ALL-reports.txt"
for /d %%D in ("%OUT%\*") do (
    if exist "%%D\probe-report.txt" (
        echo ===================== %%~nxD ===================== >> "%OUT%\ALL-reports.txt"
        type "%%D\probe-report.txt" >> "%OUT%\ALL-reports.txt"
        echo. >> "%OUT%\ALL-reports.txt"
    )
)

echo.
echo Done. Send back %OUT%\ALL-reports.txt
pause
endlocal
