# NBA Dash 2026-27

PowerShell 5.1 + WebView2 dashboard. Favorites float to the front, live scores and box scores, team profiles, standings,
a nightly cache sync, and a secret traffic counter (click the "NBA 2026-27" title 5 times within 3 seconds).

## First run
1. Unzip anywhere (for example `C:\Tools\NBADash`).
2. Double-click `Start-NBADash.bat`. On first run it downloads the WebView2 wrapper DLLs into `lib\` (no admin needed).
   The WebView2 runtime itself ships with Edge.
3. Star your teams in the banner. A newly starred team triggers a quick sync for it right away.
4. Optional: `Register-NBASyncTask.ps1 -RunNow` schedules the nightly sync (04:00) so box scores and rosters are cached
   for the next launch. Use "Watch" on a live game for live box scores (favorites are auto-watched).

## Files
- `Start-NBADash.ps1` window, bridge, worker runspace, sync launcher. `-Debug` enables DevTools and the context menu.
- `modules\Nba.Data.psm1` ESPN fetching, compacting, live worker (30 s polling while games are live).
- `Sync-NBACache.ps1` / `Register-NBASyncTask.ps1` nightly cache sync and its scheduled task.
- `ui\` the web UI. Open `ui\index.html` through any static server for a mock-data preview in a normal browser.

## Data locations
Cache `%LOCALAPPDATA%\NBADash\cache`, settings `%APPDATA%\NBADash\settings.json`, WebView2 profile `%LOCALAPPDATA%\NBADash\webview2`.

## Known limits
- Only the head coach is available from ESPN (no assistants).
- Player headshots load straight from ESPN and are not counted by the traffic counter.
- Box score field names are inferred from the probe; if a column looks wrong, run the sync with `-KeepRaw` and check `cache\raw`.
- Not yet run on a real Windows 5.1 + WebView2 machine; the first launch may need small fixes.

## Repository layout
- `Start-NBADash.ps1`, `Start-NBADash.bat`, `Setup-WebView2.ps1` run the dashboard.
- `Sync-NBACache.ps1`, `Register-NBASyncTask.ps1` the nightly cache sync and its scheduled task.
- `modules\` PowerShell module for live ESPN polling.
- `ui\` the web UI (vanilla ES modules). `ui\dev\mock.js` is the mock host used for browser previews.
- `tools\` the feed probe scripts used to check what ESPN returns.
