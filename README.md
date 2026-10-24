# NBA Dash 2026-27

PowerShell 5.1 + WebView2 dashboard. Favorites float to the front, live scores and box scores, team profiles, standings,
a nightly cache sync, and a secret traffic counter (click the "NBA 2026-27" title 5 times within 3 seconds).

## First run
1. Unzip anywhere (for example `C:\Tools\NBADash`).
2. Double-click `Start-NBADash.bat`. On first run it downloads the WebView2 wrapper DLLs into `lib\` (no admin needed).
   The WebView2 runtime itself ships with Edge.
3. Star your teams in the banner. A newly starred team triggers a quick sync for it right away.
4. Optional: turn on the nightly sync in Settings (pick any time, change or remove it later), or run `Register-NBASyncTask.ps1 -Time 04:00 -RunNow`. Either way it schedules the nightly sync (default 04:00, this computer's local time) so box scores and rosters are cached
   for the next launch. Use "Watch" on a live game for live box scores (favorites are auto-watched).

## Files
- `Start-NBADash.ps1` window, bridge, worker runspace, sync launcher. `-Debug` enables DevTools and the context menu.
- `modules\Nba.Data.psm1` ESPN fetching, compacting, live worker (30 s polling while games are live).
- `Sync-NBACache.ps1` / `Register-NBASyncTask.ps1` nightly cache sync and its scheduled task.
- `Update-NBADash.ps1` / `Apply-Update.ps1` update check, verified download, and the install-and-roll-back helper.
- `ui\` the web UI. Open `ui\index.html` through any static server for a mock-data preview in a normal browser.

## Player search and comparison
Type in the search box next to Leaderboards (press `/` to jump to it). Suggestions appear as you type: Tab or the
right arrow completes the top name, Enter opens it, and the box offers your recent players when it is empty. Names come
from the cached rosters; if nothing matches there, ESPN's player search is asked (this also finds retired players).

- A player page shows the photo, a bio table (height, weight, age, birth date and place, draft, experience), this
  season's per-game stats and totals, and a season-by-season history. Stats and bios come from ESPN and are cached for
  3 hours in `%LOCALAPPDATA%\NBADash\cache\players`. A player with no games yet this season shows that plainly.
- Use **+ Compare** in the results or **Add to comparison** on a player page (up to 5 players). The tray at the bottom
  opens a side-by-side table for this season, last season or career, with the best number in each row highlighted.

## Season history and weeks

The home page shows today and last night. Everything earlier lives under the **Week** links below the team banner (Week 1 = Oct 20-26, 2026, and so on). A week link only appears once games for it are saved on your computer.

- The first time you open the app (and whenever days are missing) it quietly downloads one scoreboard per day since opening night, politely, a few requests per second at most.
- Settings has **Fill in season history** (scoreboards only) and **Download full season history** (also every missing box score, about 8 KB per game). Both can be cancelled and pick up where they stopped.
- Everything is fetched straight from ESPN to your own computer; nothing is shared or uploaded.

## Manual refresh by default, optional automatic refresh

Out of the box NBADash **does not poll ESPN on its own**. It contacts ESPN only when you press the refresh button (top right, or F5), open or refresh a box score, run a sync from Settings, or search for a player. The nightly scheduled task (if you registered one) is separate and still runs when you scheduled it.

You can opt in to automatic refresh in Settings. It shows a warning (ESPN publishes no limits for this API, and polling too often can get you rate-limited or blocked) and needs a confirmation. Once on, you control the cadence: live-score interval, idle scoreboard interval, how often finished days and standings/injuries are re-checked, and how fresh a sync treats saved team files, standings and injuries. Values are clamped to safe ranges and **Reset to defaults** restores them. Auto-watching favorite games and the startup season-history fill are only active in automatic mode. The sync values are also used by the nightly task, which reads them from your settings file.

## Team Rankings and Report Card

The Team Rankings tab ranks all 30 teams per category (Leaders and Losers tabs): point differential, scoring, offensive and defensive rating, net rating, shooting, rebounds, assists, steals, blocks and turnovers. Ratings are estimated points per 100 possessions.

The Report Card tab gives each team an overall, offense and defense letter grade, curved against the rest of the league. Grades stay hidden until Week 3 is complete (from Nov 10); tick "Show grades anyway" to preview them early.

## Live game cards

Live cards show the status ("Q2 5:14", "HALFTIME", "END Q1"). Once a box score has been loaded for a live game (the "Box score" button on the card, or auto-watch in automatic mode), the card also shows the latest basket: points and type (3PT, 2PT, FT), who scored, and when. It comes from the play-by-play that already ships with the box score, so it costs no extra request. ESPN does not flag timeouts or commercial breaks, only halftime and the end of a period.

## Updating
The version number next to the settings button (for example `v0.2.0`) opens the update window. It checks the latest
GitHub release of this repository, shows its release notes, downloads the update package, verifies its SHA-256 against the
checksum published with the release, and installs it after you click **Restart now**. By default it also checks once
a few seconds after the app starts (turn this off in Settings); it never downloads or installs anything on its own.

- Only `api.github.com` and GitHub's release download hosts are contacted. Nothing is sent about you or your machine.
- Your favorites, settings, cached data and the `lib\` folder are never touched. Only the app's own files are replaced.
- The previous version is kept in `%LOCALAPPDATA%\NBADash\update\backup`. If the new version does not start, it is
  restored automatically and the app tells you.
- The checksum comes from the same release as the download, so it protects against a damaged or cut-off download, not
  against someone who controls the repository. The packages are not code-signed.
- Updates arrive as a zip named `NBADash-vX.Y.Z.zip` that a GitHub Actions workflow builds when a release is published.

## Data locations
Cache `%LOCALAPPDATA%\NBADash\cache`, settings `%APPDATA%\NBADash\settings.json`, WebView2 profile `%LOCALAPPDATA%\NBADash\webview2`, update work folder `%LOCALAPPDATA%\NBADash\update`.

## Known limits
- Only the head coach is available from ESPN (no assistants).
- Player headshots load straight from ESPN and are not counted by the traffic counter.
- Box score field names are inferred from the probe; if a column looks wrong, run the sync with `-KeepRaw` and check `cache\raw`.
- Not yet run on a real Windows 5.1 + WebView2 machine; the first launch may need small fixes.

## Repository layout
- `Start-NBADash.ps1`, `Start-NBADash.bat`, `Setup-WebView2.ps1` run the dashboard.
- `Sync-NBACache.ps1`, `Register-NBASyncTask.ps1` the nightly cache sync and its scheduled task.
- `Update-NBADash.ps1`, `Apply-Update.ps1`, `VERSION`, `.github\workflows\release.yml` the updater and the release packaging.
- `modules\` PowerShell module for live ESPN polling.
- `ui\` the web UI (vanilla ES modules). `ui\dev\mock.js` is the mock host used for browser previews.
- `tools\` the feed probe scripts used to check what ESPN returns.

## Disclaimer

NBA Dash is an independent, unofficial hobby project. It is not affiliated with, endorsed by or sponsored by ESPN, The Walt Disney Company, the NBA or any team. All names, logos and trademarks belong to their owners.

This repository contains no ESPN or NBA data. The app runs on your own computer and fetches publicly available scores and statistics from ESPN's unofficial web endpoints, which have no published terms, limits or guarantees and can change or stop working at any time. It is provided for personal, noncommercial use. Automatic refresh is off by default for that reason. You are responsible for how you use it, including compliance with the terms of the sites it contacts. The software is provided "as is" under the MIT license, without warranty of any kind.

## License
MIT. See `LICENSE`. Data comes from ESPN's public endpoints; team names and logos belong to their owners.
