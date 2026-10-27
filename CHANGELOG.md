# Changelog

Changes are grouped by label: Feature, Bug/Fix, Redesign, Housekeeping. Every merged change lands under Unreleased first and moves to a version heading when that release is published.

Release rhythm: changes are merged as they are done without changing VERSION, and released in batches on Mondays and Thursdays. Real user-facing bugs can be released right away.

## Unreleased

_Nothing yet._

## Released

### v0.13.0

**Feature**
- Team pages get a Strength of Schedule square: how hard the remaining games are, ranked against the league.
- Week pages show the best and worst 3 players of the week (worst counts rotation players only).
- New Fewest Points (Starters) card, first on the Losers tab.
- New Free Agents page: recently waived players (including ESPN's official transactions list, loaded on request), a watch list with notes, and a notice when a watched player signs.

**Bug/Fix**
- Weeks now run Monday to Sunday.
- Losers cards need a fair sample: 10+ minutes per game played, 5+ free throws for Worst FT%, 10+ threes for Worst 3P%.
- Fixed bug with injury tags not showing on team rosters.
- Box scores now list inactive players, with their injury status when known.
- Fixed bug with player pictures not loading until a player was opened.

**Redesign**
- New navigation bar under the week bar: back, forward, home and a wider player search.

### v0.12.0

**Feature**
- Hover any calculated stat to see its formula and reasoning.
- New Ratings formula setting: Native (counted possessions), Basketball-Reference or NBA.com.
- Team Rankings adds Simple Rating System (SRS) and Strength of Schedule.
- New Game Flow section on game pages: win probability and score margin charts, biggest swing, runs, droughts, lead changes, ties and clutch points.
- New Form rating (DARKO-style) on Leaderboards and player pages, with an on/off switch in Settings > Data.

**Bug/Fix**
- Team ratings now count possessions the same way as player ratings.
- DashLauncher's stop button now pauses data refresh only; update checks keep working.

**Redesign**
- Settings split into General, Data and Sync tabs.
- Report Card grades now account for strength of schedule.

**Housekeeping**
- Reorganised the app so DashLauncher can host it as a tab. No visible change when run on its own.

### v0.11.0

**Feature**
- New Transactions tab, league-wide and on each team page, tracking trades, signings and waivers.
- Roster shows a New tag for recent arrivals.

**Housekeeping**
- Added a changelog and an architecture overview.

### v0.10.0
**Feature**
- Team pages now show a team grade square, click to reveal.
- Teams and players with more games played get a small edge in Leaderboards and Team Rankings.

**Redesign**
- League Leaders renamed to Leaderboards.
- Team roster now shows shooting, defense, turnovers, fouls and +/- per game.

### v0.9.1
**Bug/Fix**
- Fixed bug with League Leaders missing stats from games finished the same day.

### v0.9.0
**Feature**
- New Team Rankings tab with team Leaders and Losers by category, including offensive, defensive and net rating.
- New Report Card tab with overall, offense and defense letter grades. Grades stay hidden until Week 3 is complete, with an optional "Show grades anyway" toggle.

**Housekeeping**
- Reworded the refresh timing settings (Live Data Interval, Fetch Interval Outside of Live Games, Historical Data Sync). Defaults unchanged.

### v0.8.1
**Bug/Fix**
- Fixed bug with League Leaders showing the lowest values first.

### v0.8.0
**Feature**
- League Leaders now has Leaders and Losers tabs, plus new eFG%, Shooting Splits and Efficiency cards.

### v0.7.2
**Bug/Fix**
- Week page sorts newest first; Check for updates re-checks when clicked.

### v0.7.1
**Bug/Fix**
- Fixed bug with standings not displaying the correct leader.

### v0.7.0
**Feature**
- The nightly sync time is now configurable.
