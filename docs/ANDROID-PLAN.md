# Android version: plan (parked)

Discussed 2026-10-28. Not started. Revisit later; it would get its own repo and chat, like F1Dash and FADash.

## Approach: Capacitor
Wrap the existing `ui/` (HTML/JS) in a Capacitor Android app. The page already talks to its backend only through
`ui/js/bridge.js` (`{id,cmd,args}` requests, `{event,data}` events), so a JavaScript engine can replace the PowerShell one
behind that bridge without the views knowing.

| Part | Android plan |
|---|---|
| Views, stats, formulas, Rookie Watch, East-West Report, Game Flow | Reused as is |
| `modules/Nba.Data.psm1`, `modules/NBADash.Host.psm1`, `Sync-NBACache.ps1` | Rewritten in JS (biggest piece): live loop, box scores + play-by-play, possessions, flow, rosters, transactions, standings, injuries |
| ESPN requests | Capacitor native HTTP (avoids browser CORS); same endpoints, same manual-first policy |
| Cache files (`league-stats.json`, boxscores, teams, ...) | App-private storage, same JSON shapes |
| Pause switch (live status) | Kept: stops the JS engine's requests |
| Nightly scheduled task | Dropped (Android limits background work; manual-first anyway) |
| DashLauncher contract | Not applicable |
| Self-updater | Replaced by an "update available" link to the newest APK on GitHub Releases |
| Build | GitHub Actions builds the APK on each release and attaches it; no Android Studio needed locally |

## Phone layout work
- Team banner and the 483px search bar
- Wide tables (standings, box scores, Rookie Watch, leaders rows): scroll or card layouts
- Hover formula cards become tap cards
- Navigation bar likely moves to the bottom of the screen

## Rejected: PWA
Needs public hosting, browser CORS on ESPN's endpoints would likely need a proxy server, and a public site conflicts with the
conservative stance on third-party data.

## Distribution and Google developer verification
- From 2026-09-30 (Brazil, Indonesia, Singapore, Thailand) and globally in 2027 (includes Canada), certified Android devices
  require apps, sideloaded included, to come from verified developers.
- Hobbyist account: up to 20 devices, reportedly no ID or fee. Verify before relying on it (pseudonym rule).
- Otherwise: Android's advanced sideloading flow (24-hour wait) or install over USB with ADB.
- Play Store: ruled out (needs a real-identity developer account).

## First milestone
Manual refresh, scores, box scores, standings. Leaders, Rookie Watch and the reports follow almost for free once box scores save.

## Rough size
Engine port ≈ several NBADash releases of work; phone layout ≈ one solid release; packaging/APK workflow small.
