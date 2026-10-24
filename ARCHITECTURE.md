# Architecture

How NBA Dash is put together, written so the pieces can be reused for another sport or a multi-sport launcher.
Windows PowerShell 5.1 + WebView2. No installer, no admin rights, no build step.

## The shape

```
Start-NBADash.bat          checks lib\ (WebView2 DLLs), starts the hidden PowerShell host
Start-NBADash.ps1          thin host: WinForms window + WebView2, virtual hosts, navigation lock, 250 ms event timer
modules\NBADash.Host.psm1  the backend (dash contract): settings, command bridge, worker, child processes, host lock
dash.json                  manifest DashLauncher reads to show NBA Dash as a tab
modules\Nba.Data.psm1      worker runspace: fetches live data, converts it to compact models, pushes events
Sync-NBACache.ps1          child process: bulk cache sync (teams, rosters, standings, scoreboards, box scores)
Update-NBADash.ps1        child process: checks GitHub releases, downloads + verifies an update
Apply-Update.ps1           child process: swaps the files after the app closes, rolls back on failure
Register-NBASyncTask.ps1   optional nightly Windows scheduled task
ui\                        plain HTML/CSS/ES modules (no framework, no bundler)
```

Everything the UI shows comes from either the **cache** (JSON files under `%LOCALAPPDATA%\NBADash\cache`, served to the
page through a virtual host) or an **event** pushed by the worker.

## Host <-> page bridge

- The page calls `bridge.request(cmd, args)`; the host replies `{id, ok, data|error}`.
- The host pushes `{event, data}` messages (scoreboard, box, live, sync, standings, injuries, update, player, psearch).
- Commands are a `switch` behind `Invoke-DashCommand` in `modules\NBADash.Host.psm1`. Every argument is validated (ids are digits, modes are whitelisted,
  file names come from an allow-list). The page is treated as untrusted input.
- A dev mock (`ui\dev\mock.js`) implements the same commands so the UI runs in a normal browser for testing.

## Three kinds of background work

1. **Worker runspace** (in-process): live scores, watched box scores, one-off requests (player page, player search).
   The host puts requests on a queue; the worker pushes results on another; a 250 ms timer drains it to the page.
2. **Sync child process**: slow bulk jobs. Progress is reported on stdout as `##PROGRESS pct|text`; a mutex allows
   one sync at a time; `sync-state.json` remembers the last fully completed day so a cancelled run resumes.
3. **Updater child processes**: check, stage (download + SHA-256 verify + safe unzip), apply (swap + relaunch + rollback).

## Fetching policy (important)

Nothing contacts a third-party server on its own by default. Fetching happens when the person presses refresh, opens a
box score, runs a sync or searches. Automatic refresh and the nightly task are opt-in, behind a plain warning and an
acknowledgement, and every interval is adjustable and clamped. New data sources need their terms read first.
The app bundles no third-party data; it fetches on the user's machine and caches locally.

## UI

- `store.js`: one state object, `notify(topics)` batched with requestAnimationFrame, loaders for cache files.
- `app.js`: hash router (`#/`, `#/team/X`, `#/game/ID`, `#/standings`, `#/leaders`, `#/player/ID`, `#/compare/..`, `#/week/N`),
  top bar, sync strip, update chip, toasts.
- `views\*.js`: each view exports `mount(ctx)` and `update(topics, ctx)`.
- `components.js`: cards, banner, avatars, week bar. `stats.js`: all derived numbers (ratings, leaders, splits, efficiency).
- Theme through CSS variables; light/dark/system.

## Releases and updates

- `VERSION` is the single source. Publishing a GitHub release with tag `vX.Y.Z` runs `.github/workflows/release.yml`,
  which checks tag == VERSION, checks scripts are ASCII-only, builds `NBADash-vX.Y.Z.zip` and a `.sha256`, and attaches them.
- The in-app updater only talks to `api.github.com` and its download hosts, verifies the checksum, refuses unsafe zip
  paths, backs up the current files, swaps, relaunches and restores the backup if the new version does not confirm in 60 seconds.
  `lib\`, the cache and settings are never touched.

## What is sport-specific (rewrite per sport)

- `Nba.Data.psm1` converters and `Sync-NBACache.ps1` endpoints.
- `stats.js`, `arenas.js`, `players.js`, and the team/game/standings/leaders/player views.
- The cached file shapes (`teams.json`, `scoreboards\day.json`, `boxscores\id.json`).

## What is generic (reuse)

Host window and bridge, worker/queue pattern, sync child-process pattern, settings and risk-acknowledgement UI,
nightly-task registration, updater and release workflow, store/router/components, dev mock, test approach.

## Multi-sport launcher

NBA Dash follows DashLauncher's dash contract: see
[DASH-CONTRACT.md](https://github.com/SomtimesOttomation/DashLauncher/blob/main/DASH-CONTRACT.md) in the DashLauncher
repo. Standalone, `Start-NBADash.ps1` is the host; inside DashLauncher, the launcher is.

## PowerShell 5.1 gotchas learned

Avoid the automatic variable names `$home`, `$pid`, `$args`, `$input`, `$error`, `$event` as your own. Keep scripts ASCII.
Single-element arrays unroll in `ConvertTo-Json` (the UI normalises with `asArray`). Cross-platform path joins matter if you
test under PowerShell 7 on Linux.
