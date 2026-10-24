# Changelog

Changes are grouped by label: Feature, Bug/Fix, Redesign, Housekeeping. Every merged change lands under Unreleased first and moves to a version heading when that release is published.

Release rhythm: changes are merged as they are done without changing VERSION, and released in batches on Mondays and Thursdays. Real user-facing bugs can be released right away.

## Unreleased

**Feature**
- Hover any calculated stat to see its formula and reasoning.
- New Ratings formula setting: Native (counted possessions), Basketball-Reference or NBA.com.

**Bug/Fix**
- Team ratings now count possessions the same way as player ratings.

**Redesign**
- Settings split into General, Data and Sync tabs.

## Released

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
