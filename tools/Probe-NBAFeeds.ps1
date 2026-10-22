<#
.SYNOPSIS
  Phase 0 probe for the NBA dashboard (PowerShell 5.1).

.DESCRIPTION
  Calls each ESPN and NBA.com feed the design doc relies on, saves the raw JSON
  samples, checks that the fields we need are present (arena, head coach, roster,
  schedule, box score, standings, injuries), measures request time and bytes, and
  checks the machine for WebView2. Read-only; nothing is installed or changed.
  About 15 requests total, paced with a short delay.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Probe-NBAFeeds.ps1
  powershell -ExecutionPolicy Bypass -File .\Probe-NBAFeeds.ps1 -Team BOS

  Output goes to .\probe-output\ (probe-report.txt, teams.csv and one .json per call).
#>
[CmdletBinding()]
param(
    [string]$Team = 'NYK',
    [int]$Season = 2027,          # ESPN names the 2026-27 season by its ending year
    [string]$OutDir = '',
    [int]$DelayMs = 400,
    [switch]$TeamOnly             # skip league-wide checks (scoreboard, standings, injuries, NBA.com)
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $OutDir) {
    $base = $PSScriptRoot
    if (-not $base) { $base = (Get-Location).Path }
    $OutDir = Join-Path $base 'probe-output'
}
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$script:Requests = New-Object System.Collections.ArrayList
$script:Findings = New-Object System.Collections.ArrayList
$script:Report   = New-Object System.Text.StringBuilder
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NBADash-Probe/0.1'

function Out-Line {
    param([string]$Text = '')
    Write-Host $Text
    [void]$script:Report.AppendLine($Text)
}

function Add-Finding {
    param([string]$Area, [string]$Check, [bool]$Ok, [string]$Detail = '')
    $result = 'MISSING'
    if ($Ok) { $result = 'FOUND' }
    [void]$script:Findings.Add([pscustomobject]@{
        Area = $Area; Check = $Check; Result = $result; Detail = $Detail
    })
}

function Get-Feed {
    param([string]$Name, [string]$Url, [hashtable]$Headers = @{})
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $row = [ordered]@{ Name = $Name; Status = 0; Ms = 0; Bytes = 0; Error = ''; Url = $Url }
    $json = $null
    try {
        $h = @{ 'Accept' = 'application/json' }
        foreach ($k in $Headers.Keys) { $h[$k] = $Headers[$k] }
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -UserAgent $UA -Headers $h -TimeoutSec 30
        $row.Status = [int]$r.StatusCode
        $row.Bytes  = [Text.Encoding]::UTF8.GetByteCount($r.Content)
        $file = Join-Path $OutDir ($Name + '.json')
        [IO.File]::WriteAllText($file, $r.Content, (New-Object Text.UTF8Encoding($false)))
        try { $json = $r.Content | ConvertFrom-Json }
        catch { $row.Error = 'JSON parse failed: ' + $_.Exception.Message }
    }
    catch {
        $row.Error = $_.Exception.Message
        if ($_.Exception.Response) { $row.Status = [int]$_.Exception.Response.StatusCode }
    }
    $sw.Stop()
    $row.Ms = [int]$sw.ElapsedMilliseconds
    [void]$script:Requests.Add([pscustomobject]$row)
    Start-Sleep -Milliseconds $DelayMs
    return $json
}

function Get-Binary {
    param([string]$Name, [string]$Url)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $row = [ordered]@{ Name = $Name; Status = 0; Ms = 0; Bytes = 0; Error = ''; Url = $Url }
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -UserAgent $UA -TimeoutSec 30
        $row.Status = [int]$r.StatusCode
        $row.Bytes  = $r.RawContentLength
    }
    catch {
        $row.Error = $_.Exception.Message
        if ($_.Exception.Response) { $row.Status = [int]$_.Exception.Response.StatusCode }
    }
    $sw.Stop()
    $row.Ms = [int]$sw.ElapsedMilliseconds
    [void]$script:Requests.Add([pscustomobject]$row)
    Start-Sleep -Milliseconds $DelayMs
}

# ---------------------------------------------------------------- environment
Out-Line '=== ENVIRONMENT ==='
Out-Line ("PowerShell : " + $PSVersionTable.PSVersion)
Out-Line ("OS         : " + [Environment]::OSVersion.VersionString)
$net = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue).Release
Out-Line (".NET FW rel: " + $net + "  (461808 or higher = 4.7.2+)")
$wvGuid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$wvPaths = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$wvGuid",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$wvGuid",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$wvGuid"
)
$wvVersion = $null
foreach ($p in $wvPaths) {
    $v = (Get-ItemProperty $p -ErrorAction SilentlyContinue).pv
    if ($v) { $wvVersion = $v; break }
}
if ($wvVersion) { Out-Line ("WebView2   : runtime $wvVersion") }
else { Out-Line 'WebView2   : runtime NOT FOUND (install the Evergreen Runtime before Phase 1)' }
Out-Line ''

# ---------------------------------------------------------------- dates (Eastern)
$et    = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Eastern Standard Time')
$today = $et.ToString('yyyyMMdd')
$yday  = $et.AddDays(-1).ToString('yyyyMMdd')
$espn  = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
Out-Line "Eastern date now: $today   'last night' date: $yday   team: $Team   season: $Season"
Out-Line ''

# ---------------------------------------------------------------- 1. teams
$t = Get-Feed 'espn-teams' "$espn/teams"
$teams = @($t.sports[0].leagues[0].teams | ForEach-Object { $_.team })
Add-Finding 'Teams' 'Exactly 30 teams' ($teams.Count -eq 30) ("{0} teams" -f $teams.Count)
$teams | Sort-Object displayName | ForEach-Object {
    [pscustomobject]@{
        Id = $_.id; Abbr = $_.abbreviation; Name = $_.displayName; Location = $_.location
        Color = $_.color; AltColor = $_.alternateColor; Logo = $_.logos[0].href
    }
} | Export-Csv -Path (Join-Path $OutDir 'teams.csv') -NoTypeInformation -Encoding UTF8
$sample = $teams | Select-Object -First 1
Add-Finding 'Teams' 'Logo URL on each team' (-not [string]::IsNullOrEmpty($sample.logos[0].href)) $sample.logos[0].href
Add-Finding 'Teams' 'Team colors' (-not [string]::IsNullOrEmpty($sample.color)) ("$($sample.color) / $($sample.alternateColor)")

# ESPN uses short codes for a few teams (NY, GS, SA, NO, UTAH, WSH); accept the common ones too
$aliases = @{ 'NYK' = 'NY'; 'GSW' = 'GS'; 'SAS' = 'SA'; 'NOP' = 'NO'; 'UTA' = 'UTAH'; 'WAS' = 'WSH' }
$want = $Team.ToUpper()
if ($aliases.ContainsKey($want)) { $want = $aliases[$want] }
$me = $teams | Where-Object { $_.abbreviation -eq $want } | Select-Object -First 1
if (-not $me) {
    Out-Line "Team '$Team' not found, falling back to $($teams[0].abbreviation)"
    $me = $teams[0]
}

# ---------------------------------------------------------------- 2. team detail
$d  = Get-Feed 'espn-team-detail' "$espn/teams/$($me.id)"
$tm = $d.team
Add-Finding 'Team detail' 'Arena (franchise.venue)' (-not [string]::IsNullOrEmpty($tm.franchise.venue.fullName)) ("$($tm.franchise.venue.fullName), $($tm.franchise.venue.address.city)")
Add-Finding 'Team detail' 'Record summary' (-not [string]::IsNullOrEmpty($tm.record.items[0].summary)) ("$($tm.record.items[0].summary)")
Add-Finding 'Team detail' 'Standing summary' (-not [string]::IsNullOrEmpty($tm.standingSummary)) ("$($tm.standingSummary)")
Add-Finding 'Team detail' 'Next event' ($null -ne $tm.nextEvent) ("$($tm.nextEvent[0].shortName)")

# ---------------------------------------------------------------- 3. roster + coach
$r = Get-Feed 'espn-roster' "$espn/teams/$($me.id)/roster"
$athletes = @($r.athletes)
Add-Finding 'Roster' 'Players listed' ($athletes.Count -gt 0) ("{0} players" -f $athletes.Count)
$a = $athletes | Select-Object -First 1
Add-Finding 'Roster' 'Name, jersey, position' (($a.fullName) -and ($a.jersey) -and ($a.position.abbreviation)) ("$($a.fullName) #$($a.jersey) $($a.position.abbreviation)")
Add-Finding 'Roster' 'Height, weight, age' (($a.displayHeight) -and ($a.age)) ("$($a.displayHeight), $($a.displayWeight), age $($a.age)")
Add-Finding 'Roster' 'Headshot URL' (-not [string]::IsNullOrEmpty($a.headshot.href)) ("$($a.headshot.href)")
$coach = @($r.coach)
Add-Finding 'Coaching' 'Head coach' ($coach.Count -gt 0) ("{0} {1}" -f $coach[0].firstName, $coach[0].lastName)
$coachKeys = @($r.PSObject.Properties.Name | Where-Object { $_ -match 'coach|staff' })
Add-Finding 'Coaching' 'Assistants / staff list' (($coach.Count -gt 1) -or ($coachKeys.Count -gt 1)) ("coach entries: $($coach.Count); coach/staff keys: $($coachKeys -join ', ')")
Out-Line ("Roster top-level keys: " + (($r.PSObject.Properties.Name) -join ', '))

# ---------------------------------------------------------------- 4. schedule
$s = Get-Feed 'espn-schedule' "$espn/teams/$($me.id)/schedule?season=$Season&seasontype=2"
$events = @($s.events)
Add-Finding 'Schedule' 'Regular-season events' ($events.Count -gt 0) ("{0} games (full season is 82)" -f $events.Count)
$e1 = $events | Select-Object -First 1
Add-Finding 'Schedule' 'Date, opponent, status' (($e1.date) -and ($e1.shortName)) ("$($e1.date)  $($e1.shortName)  $($e1.competitions[0].status.type.description)")

if (-not $TeamOnly) {
# ---------------------------------------------------------------- 5. scoreboards
$sbToday = Get-Feed 'espn-scoreboard-today' "$espn/scoreboard"
$sbYday  = Get-Feed 'espn-scoreboard-yesterday' "$espn/scoreboard?dates=$yday"
$todayEv = @($sbToday.events)
$ydayEv  = @($sbYday.events)
Add-Finding 'Scoreboard' 'Today events' ($todayEv.Count -gt 0) ("{0} games; states: {1}" -f $todayEv.Count, (($todayEv | ForEach-Object { $_.status.type.state }) -join ','))
Add-Finding 'Scoreboard' 'Last night events' ($ydayEv.Count -gt 0) ("{0} games; states: {1}" -f $ydayEv.Count, (($ydayEv | ForEach-Object { $_.status.type.state }) -join ','))
$ev = $todayEv + $ydayEv | Where-Object { $_.status.type.state -ne 'pre' } | Select-Object -First 1
if ($ev) {
    $c = $ev.competitions[0].competitors[0]
    Add-Finding 'Scoreboard' 'Quarter linescores' (@($c.linescores).Count -gt 0) ("{0} periods for {1}" -f @($c.linescores).Count, $c.team.abbreviation)
    Add-Finding 'Scoreboard' 'Clock and period' ($ev.status.displayClock -ne $null) ("clock '$($ev.status.displayClock)' period $($ev.status.period) state $($ev.status.type.state)")
    Add-Finding 'Scoreboard' 'Leaders on card' ($null -ne $c.leaders) ("$((@($c.leaders) | ForEach-Object { $_.name }) -join ', ')")
}

# ---------------------------------------------------------------- 6. box score
$sumEv = $ydayEv | Where-Object { $_.status.type.state -eq 'post' } | Select-Object -First 1
if (-not $sumEv) { $sumEv = $todayEv | Where-Object { $_.status.type.state -ne 'pre' } | Select-Object -First 1 }
if ($sumEv) {
    $sum = Get-Feed 'espn-summary' "https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/summary?region=us&lang=en&contentorigin=espn&event=$($sumEv.id)"
    if (-not $sum.boxscore) {
        $sum = Get-Feed 'espn-summary-alt' "$espn/summary?event=$($sumEv.id)"
    }
    $groups = @($sum.boxscore.players)
    Add-Finding 'Box score' 'Player stat groups (one per team)' ($groups.Count -eq 2) ("{0} groups for {1}" -f $groups.Count, $sumEv.shortName)
    $labels = @($groups[0].statistics[0].labels)
    Add-Finding 'Box score' 'Stat columns' ($labels.Count -gt 0) ($labels -join ' ')
    Add-Finding 'Box score' 'Player rows' (@($groups[0].statistics[0].athletes).Count -gt 0) ("{0} rows, first: {1}" -f @($groups[0].statistics[0].athletes).Count, $groups[0].statistics[0].athletes[0].athlete.displayName)
    Add-Finding 'Box score' 'Team totals' (@($sum.boxscore.teams).Count -gt 0) ("{0} team blocks" -f @($sum.boxscore.teams).Count)
    Add-Finding 'Box score' 'Arena on game' (-not [string]::IsNullOrEmpty($sum.gameInfo.venue.fullName)) ("$($sum.gameInfo.venue.fullName)")
}
else {
    Out-Line 'No started or finished game found on the scoreboards; box score check skipped.'
}

# ---------------------------------------------------------------- 7. standings
$st = Get-Feed 'espn-standings' 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings'
$kids = @($st.children)
Add-Finding 'Standings' 'Conferences' ($kids.Count -eq 2) (($kids | ForEach-Object { $_.name }) -join ', ')
$entries = @($kids[0].standings.entries)
Add-Finding 'Standings' 'Team entries per conference' ($entries.Count -gt 0) ("{0} entries in {1}" -f $entries.Count, $kids[0].name)
$statNames = @($entries[0].stats | ForEach-Object { $_.name })
Add-Finding 'Standings' 'Stats (wins, losses, streak, etc.)' ($statNames.Count -gt 0) (($statNames | Select-Object -First 12) -join ', ')

# ---------------------------------------------------------------- 8. injuries
$inj = Get-Feed 'espn-injuries' "$espn/injuries"
$injTeams = @($inj.injuries)
$injTotal = 0
foreach ($x in $injTeams) { $injTotal += @($x.injuries).Count }
Add-Finding 'Injuries' 'League injury report' ($injTeams.Count -gt 0) ("{0} teams, {1} players listed" -f $injTeams.Count, $injTotal)
$i1 = $injTeams | Where-Object { @($_.injuries).Count -gt 0 } | Select-Object -First 1
if ($i1) {
    $ij = $i1.injuries[0]
    Add-Finding 'Injuries' 'Player, status, detail' (($ij.athlete.displayName) -and ($ij.status)) ("$($ij.athlete.displayName): $($ij.status) - $($ij.shortComment)")
}

# ---------------------------------------------------------------- 9. NBA.com CDN
$nbaH = @{ 'Referer' = 'https://www.nba.com/'; 'Origin' = 'https://www.nba.com' }
$cs = Get-Feed 'nbacdn-scoreboard' 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json' $nbaH
$cg = @($cs.scoreboard.games)
Add-Finding 'NBA.com CDN' 'Today scoreboard' ($cg.Count -gt 0) ("{0} games, date {1}, statuses: {2}" -f $cg.Count, $cs.scoreboard.gameDate, (($cg | ForEach-Object { $_.gameStatus }) -join ','))
$started = $cg | Where-Object { $_.gameStatus -ge 2 } | Select-Object -First 1
if ($started) {
    $box = Get-Feed 'nbacdn-boxscore' "https://cdn.nba.com/static/json/liveData/boxscore/boxscore_$($started.gameId).json" $nbaH
    $bg = $box.game
    Add-Finding 'NBA.com CDN' 'Live box score' (@($bg.homeTeam.players).Count -gt 0) ("game $($started.gameId): {0} home players, status '{1}'" -f @($bg.homeTeam.players).Count, $bg.gameStatusText)
    Add-Finding 'NBA.com CDN' 'Arena and officials' (-not [string]::IsNullOrEmpty($bg.arena.arenaName)) ("$($bg.arena.arenaName); officials: $(@($bg.officials).Count)")
}
else {
    Out-Line 'NBA.com CDN: no started game right now; live box score check skipped (re-run during a game).'
}

}   # end league-wide checks

# ---------------------------------------------------------------- 10. logo size
if ($sample.logos[0].href) { Get-Binary 'logo-sample' $sample.logos[0].href }

# ================================================================ REPORT
Out-Line ''
Out-Line '=== FIELD CHECKS ==='
Out-Line (($script:Findings | Format-Table -AutoSize -Wrap | Out-String -Width 200).TrimEnd())
Out-Line ''
Out-Line '=== REQUESTS ==='
Out-Line (($script:Requests | Select-Object Name, Status, Ms, Bytes, Error | Format-Table -AutoSize | Out-String -Width 200).TrimEnd())

$totBytes = ($script:Requests | Measure-Object -Property Bytes -Sum).Sum
$totMs    = ($script:Requests | Measure-Object -Property Ms -Sum).Sum
Out-Line ''
Out-Line ("Total: {0} requests, {1:N0} KB received, {2:N1} s of request time" -f $script:Requests.Count, ($totBytes / 1KB), ($totMs / 1000))

# Rough traffic estimate for a 6 hour game window (7pm to 1am)
$sbRow  = $script:Requests | Where-Object { $_.Name -eq 'espn-scoreboard-today' }
$boxRow = $script:Requests | Where-Object { $_.Name -eq 'espn-summary' }
if ($sbRow -and $boxRow) {
    $sbCalls  = [math]::Floor(6 * 3600 / 20)
    $boxCalls = [math]::Floor(6 * 3600 / 15)
    $sbMB  = $sbCalls  * $sbRow.Bytes  / 1MB
    $boxMB = $boxCalls * $boxRow.Bytes / 1MB
    Out-Line ''
    Out-Line '=== TRAFFIC ESTIMATE, 6 h window (sizes as received by this script) ==='
    Out-Line ("Scoreboard every 20 s : {0:N0} calls, about {1:N0} MB" -f $sbCalls, $sbMB)
    Out-Line ("One open box score, 15 s: {0:N0} calls, about {1:N0} MB" -f $boxCalls, $boxMB)
    Out-Line 'Real usage should be lower: polling pauses when nothing is live or the window is hidden.'
}

$reportPath = Join-Path $OutDir 'probe-report.txt'
[IO.File]::WriteAllText($reportPath, $script:Report.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Write-Host "Report and samples saved to: $OutDir" -ForegroundColor Green
Write-Host 'Send back probe-report.txt (and the .json files if you are happy to).' -ForegroundColor Green
