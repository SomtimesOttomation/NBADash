<#
.SYNOPSIS
  Nightly cache sync for the NBA dashboard (PowerShell 5.1).

.DESCRIPTION
  Pulls the "static-ish" data and everything that finished since the last run, then
  writes compact JSON into the cache folder so the dashboard opens instantly from disk.
  Order: favorites first, one request every -DelayMs so nothing bursts.

    teams.json, logos\            team list, colors, logos
    teams\<ABBR>.json             roster, head coach, record, compact schedule
    roster-snapshot.json          last seen roster per player (for transactions)
    transactions.json             trades, signings and releases worked out from roster changes
    standings.json, injuries.json
    scoreboards\yyyyMMdd.json     every finished day since the last run
    boxscores\<eventId>.json      compact box score per finished game
    sync-state.json               what was covered (drives catch-up)
    traffic-log.csv               one line per request (wire bytes vs decoded bytes)
    logs\sync-yyyyMMdd.log

  Safe to run any time and as often as you like: fresh files are skipped, finished
  days and box scores are never fetched twice. Games still in progress are skipped
  and their day is not marked complete until a later run.

.EXAMPLE
  .\Sync-NBACache.ps1 -Quick -KeepRaw     # first test: favorites only, 3 box scores, raw samples kept
  .\Sync-NBACache.ps1                      # normal nightly run
  .\Sync-NBACache.ps1 -Force               # refetch everything inside the backfill window
#>
[CmdletBinding()]
param(
    [string]$CacheDir     = (Join-Path $env:LOCALAPPDATA 'NBADash\cache'),
    [string]$SettingsPath = (Join-Path $env:APPDATA 'NBADash\settings.json'),
    [string[]]$Favorites,
    [int]$MaxBackfillDays = 7,
    [int]$DelayMs         = 1500,
    [int]$Season          = 2027,    # ESPN names 2026-27 by its ending year
    [switch]$Force,
    [switch]$Quick,                  # favorites only, 2-day window, at most 3 box scores
    [switch]$FullSeason,             # go back to opening night instead of the 7-day window (finished days are skipped, so it can resume)
    [switch]$NoBoxes,                # scoreboards only: do not download box scores
    [switch]$HistoryOnly,            # skip rosters, standings and injuries (use with -FullSeason)
    [string]$EspnBase = 'https://site.api.espn.com',    # only changed by tests
    [switch]$KeepRaw                 # also keep the raw ESPN JSON under cache\raw (for checking field names)
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------- one run at a time
$mutex = New-Object System.Threading.Mutex($false, 'Local\NBADashSync')
$gotLock = $false
try { $gotLock = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $gotLock = $true }   # a previous run was killed
if (-not $gotLock) {
    Write-Host 'Another sync is already running (the dashboard, the nightly task, or another PowerShell window); exiting.'
    $mutex.Dispose(); exit 0
}

# ---------------------------------------------------------------- setup
foreach ($sub in '', 'logos', 'teams', 'scoreboards', 'boxscores', 'logs', 'raw') {
    $p = Join-Path $CacheDir $sub
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
$UA     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NBADash-Sync/0.1'
$espn   = "$EspnBase/apis/site/v2/sports/basketball/nba"
$utf8   = New-Object System.Text.UTF8Encoding($false)
$runId  = (Get-Date).ToString('yyyyMMdd-HHmmss')
$logFile = Join-Path $CacheDir ("logs\sync-" + (Get-Date).ToString('yyyyMMdd') + '.log')
$script:Traffic = New-Object System.Collections.ArrayList
$script:Errors  = 0
# user-adjustable timing from settings.json (an explicit command-line value wins)
$tuneSrc = $null
if (Test-Path $SettingsPath) { try { $tuneSrc = Get-Content $SettingsPath -Raw | ConvertFrom-Json } catch { } }
function Get-Tune {
    param([string]$Name, [double]$Default, [double]$Min, [double]$Max)
    $v = $null
    if ($tuneSrc -and $null -ne $tuneSrc.$Name) { try { $v = [double]$tuneSrc.$Name } catch { } }
    if ($null -eq $v) { return $Default }
    return [Math]::Min($Max, [Math]::Max($Min, $v))
}
$TeamFreshHours  = Get-Tune 'teamFreshHours' 20 1 168
$TableFreshHours = Get-Tune 'tableFreshHours' 4 1 48
if (-not $PSBoundParameters.ContainsKey('MaxBackfillDays')) { $MaxBackfillDays = [int](Get-Tune 'backfillDays' 7 1 30) }
if ($Quick) { $MaxBackfillDays = 2 }

function Write-Log {
    param([string]$Text)
    $line = '{0}  {1}' -f (Get-Date).ToString('HH:mm:ss'), $Text
    Write-Host $line
    Add-Content -Path $logFile -Value $line -Encoding UTF8
}

# Progress marker for the dashboard (console only, not written to the log file): ##PROGRESS pct|text
function Set-Progress {
    param([double]$Pct, [string]$Text)
    Write-Host ('##PROGRESS {0}|{1}' -f [int][Math]::Min(100, [Math]::Max(0, $Pct)), $Text)
}

function Save-Json {
    param([string]$Path, $Object)
    $json = $Object | ConvertTo-Json -Depth 10 -Compress
    [IO.File]::WriteAllText($Path, $json, $utf8)
}

function Test-Fresh {
    param([string]$Path, [double]$Hours = 20)
    if ($Force) { return $false }
    if (-not (Test-Path $Path)) { return $false }
    return (((Get-Date) - (Get-Item $Path).LastWriteTime).TotalHours -lt $Hours)
}

function Get-Json {
    param([string]$Url, [string]$Kind, [string]$RawName = '')
    $obj = $null
    for ($try = 1; $try -le 3; $try++) {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $status = 0; $wire = -1; $dec = 0; $err = ''
        try {
            $req = [Net.HttpWebRequest]::Create($Url)
            $req.UserAgent = $UA
            $req.Accept = 'application/json'
            $req.Timeout = 30000
            $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
            $resp = $req.GetResponse()
            $status = [int]$resp.StatusCode
            $wire = $resp.ContentLength               # compressed size when known, -1 if chunked
            $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
            $text = $sr.ReadToEnd()
            $sr.Close(); $resp.Close()
            $dec = [Text.Encoding]::UTF8.GetByteCount($text)
            if ($KeepRaw -and $RawName) {
                [IO.File]::WriteAllText((Join-Path $CacheDir ("raw\" + $RawName + '.json')), $text, $utf8)
            }
            $obj = $text | ConvertFrom-Json
        }
        catch [System.Net.WebException] {
            $err = $_.Exception.Message
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        }
        catch { $err = $_.Exception.Message }
        $sw.Stop()
        [void]$script:Traffic.Add([pscustomobject]@{
            Run = $runId; Time = (Get-Date).ToString('s'); Kind = $Kind; Status = $status
            Ms = [int]$sw.ElapsedMilliseconds; WireBytes = $wire; DecodedBytes = $dec; Url = $Url
        })
        Start-Sleep -Milliseconds $DelayMs
        if ($obj) { return $obj }
        if ($status -eq 429 -or $status -ge 500 -or $status -eq 0) {
            Write-Log ("  retry {0}/3 after error {1} {2}" -f $try, $status, $err)
            Start-Sleep -Seconds (5 * $try)
        } else { break }
    }
    $script:Errors++
    Write-Log "  FAILED: $Kind $Url"
    return $null
}

function Get-File {
    param([string]$Url, [string]$Path, [string]$Kind)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $status = 0; $bytes = 0
    try {
        $req = [Net.HttpWebRequest]::Create($Url)
        $req.UserAgent = $UA; $req.Timeout = 30000
        $resp = $req.GetResponse()
        $status = [int]$resp.StatusCode
        $ms = New-Object System.IO.MemoryStream
        $resp.GetResponseStream().CopyTo($ms)
        $resp.Close()
        [IO.File]::WriteAllBytes($Path, $ms.ToArray())
        $bytes = $ms.Length
    }
    catch { $script:Errors++; Write-Log "  FAILED file: $Url  $($_.Exception.Message)" }
    $sw.Stop()
    [void]$script:Traffic.Add([pscustomobject]@{
        Run = $runId; Time = (Get-Date).ToString('s'); Kind = $Kind; Status = $status
        Ms = [int]$sw.ElapsedMilliseconds; WireBytes = $bytes; DecodedBytes = $bytes; Url = $Url
    })
    Start-Sleep -Milliseconds $DelayMs
}

function Get-ScoreText {
    param($Competitor)
    $sc = $Competitor.score
    if ($null -eq $sc) { return $null }
    if ($sc.PSObject.Properties['displayValue']) { return [string]$sc.displayValue }
    return [string]$sc
}

function ConvertTo-EspnAbbr {
    param([string]$Code)
    $map = @{ 'NYK' = 'NY'; 'GSW' = 'GS'; 'SAS' = 'SA'; 'NOP' = 'NO'; 'UTA' = 'UTAH'; 'WAS' = 'WSH' }
    $c = $Code.ToUpper()
    if ($map.ContainsKey($c)) { return $map[$c] }
    return $c
}

# ---------------------------------------------------------------- favorites + dates
if (-not $Favorites -and (Test-Path $SettingsPath)) {
    try { $Favorites = @((Get-Content $SettingsPath -Raw | ConvertFrom-Json).favorites) } catch { }
}
if (-not $Favorites) { $Favorites = @('TOR') }
$favAbbr = @($Favorites | ForEach-Object { ConvertTo-EspnAbbr $_ })

$et    = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Eastern Standard Time')
$yday  = $et.Date.AddDays(-1)
$statePath = Join-Path $CacheDir 'sync-state.json'
$state = $null
if (Test-Path $statePath) { try { $state = Get-Content $statePath -Raw | ConvertFrom-Json } catch { } }

$seasonStart = [datetime]'2026-10-20'
$windowStart = $yday.AddDays(-($MaxBackfillDays - 1))
if ($state -and $state.lastCompleteDate) {
    $start = [datetime]::ParseExact([string]$state.lastCompleteDate, 'yyyyMMdd', $null).AddDays(1)
    if ($start -lt $windowStart) { $start = $windowStart }
} else { $start = $windowStart }
if ($start -lt $seasonStart) { $start = $seasonStart }
if ($Force) { $start = $windowStart; if ($start -lt $seasonStart) { $start = $seasonStart } }
if ($FullSeason) { $start = $seasonStart }

Write-Log ("=== Sync {0}  favorites: {1}  days: {2:yyyy-MM-dd} to {3:yyyy-MM-dd}  quick={4} force={5} fullSeason={6} noBoxes={7}" -f $runId, ($favAbbr -join ','), $start, $yday, [bool]$Quick, [bool]$Force, [bool]$FullSeason, [bool]$NoBoxes)

# ---------------------------------------------------------------- 1. teams + logos
Set-Progress 2 'Contacting ESPN'
$t = Get-Json "$espn/teams" 'teams' 'teams'
if (-not $t) { Write-Log 'Cannot reach ESPN; stopping.'; $mutex.ReleaseMutex(); $mutex.Dispose(); exit 1 }
$teams = @($t.sports[0].leagues[0].teams | ForEach-Object { $_.team })
$teamList = @($teams | Sort-Object displayName | ForEach-Object {
    [pscustomobject]@{
        id = $_.id; abbr = $_.abbreviation; name = $_.displayName; location = $_.location
        nickname = $_.name; color = $_.color; altColor = $_.alternateColor; logo = $_.logos[0].href
    }
})
Save-Json (Join-Path $CacheDir 'teams.json') $teamList
Write-Log ("Teams: {0}" -f $teamList.Count)
Set-Progress 5 'Checking team logos'

foreach ($tm in $teamList) {
    $logoPath = Join-Path $CacheDir ("logos\" + $tm.abbr + '.png')
    if ((-not (Test-Path $logoPath)) -and $tm.logo) { Get-File $tm.logo $logoPath 'logo' }
}

# ---------------------------------------------------------------- 2. teams: roster, coach, schedule
$ordered = @($teamList | Sort-Object @{ Expression = { if ($favAbbr -contains $_.abbr) { 0 } else { 1 } } }, name)
if ($Quick) { $ordered = @($ordered | Where-Object { $favAbbr -contains $_.abbr }) }
if ($HistoryOnly) { $ordered = @() }

$ti = 0
foreach ($tm in $ordered) {
    $ti++
    Set-Progress (8 + 62 * ($ti - 1) / [Math]::Max(1, $ordered.Count)) ("Team {0} ({1} of {2})" -f $tm.abbr, $ti, $ordered.Count)
    $teamPath = Join-Path $CacheDir ("teams\" + $tm.abbr + '.json')
    if (Test-Fresh $teamPath $TeamFreshHours) { Write-Log "Team $($tm.abbr): fresh, skipped"; continue }
    Write-Log "Team $($tm.abbr)"
    $d = Get-Json "$espn/teams/$($tm.id)" 'team' ("team-" + $tm.abbr)
    $r = Get-Json "$espn/teams/$($tm.id)/roster" 'roster' ("roster-" + $tm.abbr)
    $s = Get-Json "$espn/teams/$($tm.id)/schedule?season=$Season&seasontype=2" 'schedule' ("schedule-" + $tm.abbr)
    if (-not $r) { continue }

    $players = @($r.athletes | ForEach-Object {
        [pscustomobject]@{
            id = $_.id; name = $_.fullName; jersey = $_.jersey; pos = $_.position.abbreviation
            height = $_.displayHeight; weight = $_.displayWeight; age = $_.age
            years = $_.experience.years; headshot = $_.headshot.href
        }
    })
    $coach = @($r.coach) | Select-Object -First 1
    $games = @()
    if ($s) {
        $games = @($s.events | ForEach-Object {
            $comp = $_.competitions[0]
            $hc = $comp.competitors | Where-Object { $_.homeAway -eq 'home' } | Select-Object -First 1
            $ac = $comp.competitors | Where-Object { $_.homeAway -eq 'away' } | Select-Object -First 1
            # The schedule feed can leave a competitor's abbreviation or score empty; shortName ("CHI @ TOR") is reliable.
            $hAbbr = $hc.team.abbreviation; $aAbbr = $ac.team.abbreviation
            if ($_.shortName -match '^\s*(\S+)\s*@\s*(\S+)\s*$') {
                if (-not $aAbbr) { $aAbbr = $Matches[1] }
                if (-not $hAbbr) { $hAbbr = $Matches[2] }
            }
            [pscustomobject]@{
                id = $_.id; date = $_.date; name = $_.shortName; state = $comp.status.type.state; status = $comp.status.type.description
                home = $hAbbr; away = $aAbbr
                homeScore = (Get-ScoreText $hc); awayScore = (Get-ScoreText $ac)
                venue = $comp.venue.fullName
            }
        })
    }
    Save-Json $teamPath ([pscustomobject]@{
        abbr = $tm.abbr; id = $tm.id; name = $tm.name
        record = $d.team.record.items[0].summary
        espnArena = $d.team.franchise.venue.fullName
        headCoach = (("{0} {1}" -f $coach.firstName, $coach.lastName).Trim())
        players = $players; games = $games
        syncedAt = (Get-Date).ToString('s')
    })
    Write-Log ("  {0} players, {1} games" -f $players.Count, $games.Count)
}

# ---------------------------------------------------------------- 2b. transactions (worked out from roster changes, no extra requests)
# Compares the saved rosters with the snapshot from the previous sync. A player who moves from one roster to another is a trade,
# a new name is a signing, and a player who is on no roster once every team has been re-checked is waived / released.
function Update-Transactions {
    # timestamps compared as sortable text (newer PowerShell turns ISO strings in JSON into dates)
    $ts = { param($v) if ($v -is [datetime]) { $v.ToString('s') } else { [string]$v } }
    $snapPath = Join-Path $CacheDir 'roster-snapshot.json'
    $txPath = Join-Path $CacheDir 'transactions.json'
    $today = $et.ToString('yyyy-MM-dd')

    # current rosters; a player on two files (one not refreshed yet) belongs to the newer file
    $cur = @{}; $fileTimes = @()
    foreach ($f in @(Get-ChildItem (Join-Path $CacheDir 'teams') -Filter *.json -File -ErrorAction SilentlyContinue)) {
        $tf = $null; try { $tf = Get-Content $f.FullName -Raw | ConvertFrom-Json } catch { }
        if (-not $tf -or -not $tf.abbr) { continue }
        $at = & $ts $tf.syncedAt; $fileTimes += $at
        foreach ($p in @($tf.players)) {
            if (-not $p.id) { continue }
            $id = [string]$p.id
            if ($cur.ContainsKey($id) -and $cur[$id].at -ge $at) { continue }
            $cur[$id] = @{ team = [string]$tf.abbr; name = [string]$p.name; pos = [string]$p.pos; at = $at }
        }
    }
    if ($cur.Count -eq 0) { return }
    $oldest = ($fileTimes | Sort-Object | Select-Object -First 1)

    $snap = $null; if (Test-Path $snapPath) { try { $snap = Get-Content $snapPath -Raw | ConvertFrom-Json } catch { } }
    $prev = @{}; $gone = @{}
    if ($snap) {
        foreach ($pr in @($snap.players.PSObject.Properties)) { $prev[$pr.Name] = @{ team = [string]$pr.Value.team; name = [string]$pr.Value.name; pos = [string]$pr.Value.pos } }
        foreach ($pr in @($snap.gone.PSObject.Properties)) { $gone[$pr.Name] = @{ team = [string]$pr.Value.team; name = [string]$pr.Value.name; pos = [string]$pr.Value.pos; at = (& $ts $pr.Value.at) } }
    }
    $tx = $null; if (Test-Path $txPath) { try { $tx = Get-Content $txPath -Raw | ConvertFrom-Json } catch { } }
    $events = New-Object System.Collections.ArrayList
    if ($tx) { foreach ($e in @($tx.events)) { [void]$events.Add($e) } }
    $add = { param($type, $id, $p, $from, $to)
        [void]$events.Add([pscustomobject]@{ date = $today; type = $type; id = $id; name = $p.name; pos = $p.pos; from = $from; to = $to })
        $script:txAdded++ }
    $script:txAdded = 0

    if ($snap) {
        # a team seen for the first time (its roster was never saved before) is a starting point, not a wave of signings
        $prevTeams = @{}; foreach ($v in $prev.Values) { $prevTeams[$v.team] = $true }
        foreach ($v in $gone.Values) { $prevTeams[$v.team] = $true }
        foreach ($id in $cur.Keys) {
            $c = $cur[$id]
            if ($prev.ContainsKey($id)) {
                if ($prev[$id].team -ne $c.team) { & $add 'trade' $id $c $prev[$id].team $c.team }
            } elseif ($gone.ContainsKey($id)) {
                # left one roster earlier and turned up on another before every team was re-checked: still a move between teams
                if ($gone[$id].team -ne $c.team) { & $add 'trade' $id $c $gone[$id].team $c.team }
                $gone.Remove($id)
            } elseif ($prevTeams.ContainsKey($c.team)) {
                & $add 'signed' $id $c '' $c.team
            }
        }
        foreach ($id in $prev.Keys) {
            if (-not $cur.ContainsKey($id) -and -not $gone.ContainsKey($id)) { $gone[$id] = @{ team = $prev[$id].team; name = $prev[$id].name; pos = $prev[$id].pos; at = (Get-Date).ToString('s') } }
        }
        # released once every team's roster has been saved again since the player disappeared
        foreach ($id in @($gone.Keys)) {
            if ($oldest -and $oldest -gt $gone[$id].at) { & $add 'released' $id $gone[$id] $gone[$id].team ''; $gone.Remove($id) }
        }
    } else {
        Write-Log 'Transactions: first roster snapshot saved; changes are tracked from the next sync'
    }

    $players = [ordered]@{}
    foreach ($id in $cur.Keys) { $players[$id] = [pscustomobject]@{ team = $cur[$id].team; name = $cur[$id].name; pos = $cur[$id].pos } }
    $goneOut = [ordered]@{}
    foreach ($id in $gone.Keys) { $goneOut[$id] = [pscustomobject]$gone[$id] }
    Save-Json $snapPath ([pscustomobject]@{ savedAt = (Get-Date).ToString('s'); players = [pscustomobject]$players; gone = [pscustomobject]$goneOut })
    $keep = @($events | Select-Object -Last 3000)
    Save-Json $txPath ([pscustomobject]@{ updatedAt = (Get-Date).ToString('s'); events = $keep })
    if ($script:txAdded) { Write-Log ("Transactions: {0} new" -f $script:txAdded) }
}
if (-not $HistoryOnly) { try { Update-Transactions } catch { Write-Log ("Transactions: skipped ({0})" -f $_.Exception.Message) } }

# ---------------------------------------------------------------- 3. standings
$stPath = Join-Path $CacheDir 'standings.json'
if (-not $HistoryOnly -and -not (Test-Fresh $stPath $TableFreshHours)) {
    Write-Log 'Standings'
    Set-Progress 72 'Standings'
    $st = Get-Json "$EspnBase/apis/v2/sports/basketball/nba/standings" 'standings' 'standings'
    if ($st) {
        $conf = @($st.children | ForEach-Object {
            $cname = $_.name
            [pscustomobject]@{
                name = $cname
                teams = @($_.standings.entries | ForEach-Object {
                    $h = @{}
                    foreach ($x in $_.stats) { $h[$x.name] = $x.displayValue }
                    [pscustomobject]@{ abbr = $_.team.abbreviation; name = $_.team.displayName; stats = $h }
                })
            }
        })
        Save-Json $stPath ([pscustomobject]@{ syncedAt = (Get-Date).ToString('s'); conferences = $conf })
    }
}

# ---------------------------------------------------------------- 4. injuries
$injPath = Join-Path $CacheDir 'injuries.json'
if (-not $HistoryOnly -and -not (Test-Fresh $injPath $TableFreshHours)) {
    Write-Log 'Injuries'
    Set-Progress 76 'Injuries'
    $inj = Get-Json "$espn/injuries" 'injuries' 'injuries'
    if ($inj) {
        $teamsInj = @($inj.injuries | ForEach-Object {
            [pscustomobject]@{
                team = $_.displayName; teamId = $_.id
                players = @($_.injuries | ForEach-Object {
                    [pscustomobject]@{
                        id = $_.athlete.id; name = $_.athlete.displayName; status = $_.status
                        date = $_.date; comment = $_.shortComment
                    }
                })
            }
        })
        Save-Json $injPath ([pscustomobject]@{ syncedAt = (Get-Date).ToString('s'); teams = $teamsInj })
    }
}

function Get-NbaFlow {
    # Game flow from the play-by-play and ESPN's win probability series, both already in the game summary (no extra request).
    # pts = [seconds elapsed, home margin, home win %]: every scoring change plus win-probability moves of 2 points or more.
    # swing = the single play that moved the win probability most. Returns $null when there is no play-by-play.
    param($Sum)
    try {
        $comp = $Sum.header.competitions[0]
        $hc = @($comp.competitors | Where-Object { $_.homeAway -eq 'home' })[0]
        $ac = @($comp.competitors | Where-Object { $_.homeAway -eq 'away' })[0]
        if (-not $hc -or -not $ac) { return $null }
        $plays = @($Sum.plays | Where-Object { $_ } | Sort-Object { [int]$_.sequenceNumber })
        if ($plays.Count -lt 5) { return $null }
        $wp = @{}
        foreach ($w in @($Sum.winprobability)) { if ($w.playId) { $wp[[string]$w.playId] = [double]$w.homeWinPercentage } }
        $abbr = @{}; $abbr[[string]$hc.team.id] = [string]$hc.team.abbreviation; $abbr[[string]$ac.team.id] = [string]$ac.team.abbreviation
        $pts = New-Object System.Collections.ArrayList
        $lastM = $null; $lastW = $null; $prevW = $null; $endT = 0
        $swing = $null
        foreach ($p in $plays) {
            $pn = [int]$p.period.number; if ($pn -lt 1) { continue }
            $len = $(if ($pn -le 4) { 720 } else { 300 })
            $start = $(if ($pn -le 4) { ($pn - 1) * 720 } else { 2880 + ($pn - 5) * 300 })
            $c = [string]$p.clock.displayValue; $left = 0.0
            if ($c -match '^(\d+):(\d+(?:\.\d+)?)$') { $left = [double]$Matches[1] * 60 + [double]$Matches[2] } elseif ($c -match '^\d+(?:\.\d+)?$') { $left = [double]$c }
            $t = [int][Math]::Round($start + $len - $left)
            if ($t -lt $endT - 5) { continue }       # a late correction logged out of order (e.g. a technical free throw entered minutes later)
            if ($t -gt $endT) { $endT = $t }
            $m = [int]$p.homeScore - [int]$p.awayScore
            $w = $null; if ($wp.ContainsKey([string]$p.id)) { $w = [Math]::Round($wp[[string]$p.id], 3) }
            if ($null -ne $w -and $null -ne $prevW) {
                $d = $w - $prevW
                if (-not $swing -or [Math]::Abs($d) -gt [Math]::Abs($swing.d)) {
                    $swing = [pscustomobject]@{ t = $t; d = [Math]::Round($d, 3); team = $abbr[[string]$p.team.id]; text = [string]$p.text; period = $pn; clock = $c }
                }
            }
            if ($null -ne $w) { $prevW = $w }
            $keep = ($null -eq $lastM) -or ($m -ne $lastM) -or ($null -ne $w -and ($null -eq $lastW -or [Math]::Abs($w - $lastW) -ge 0.02))
            if ($keep) {
                [void]$pts.Add(@($t, $m, $(if ($null -ne $w) { $w } else { -1 })))
                $lastM = $m; if ($null -ne $w) { $lastW = $w }
            }
        }
        return [pscustomobject]@{ home = [string]$hc.team.abbreviation; away = [string]$ac.team.abbreviation; end = $endT; pts = $pts.ToArray(); swing = $swing }
    } catch { return $null }
}

function Get-NbaPossessions {
    # Counts each team's real possessions from the play-by-play that comes with the game summary (no extra request).
    # A possession ends on a made shot, a turnover, the last made free throw of a trip (not technical / flagrant / clear path,
    # and not the extra shot of an and-one), the other team's defensive rebound, or the end of a period.
    # Returns @{ ABBR = n; ABBR2 = n } or $null when the play-by-play is missing or looks incomplete.
    param($Sum)
    try {
        $teams = @($Sum.boxscore.teams)
        if ($teams.Count -ne 2) { return $null }
        $ids = @([string]$teams[0].team.id, [string]$teams[1].team.id)
        $abbr = @{}; foreach ($t in $teams) { $abbr[[string]$t.team.id] = [string]$t.team.abbreviation }
        $plays = @($Sum.plays | Where-Object { $_ } | Sort-Object { [int]$_.sequenceNumber })
        if ($plays.Count -lt 100) { return $null }
        $ends = @{ $ids[0] = 0; $ids[1] = 0 }
        $st = @{ cur = $null; active = $false; last = ''; per = $null }
        $other = { param($t) if ($t -eq $ids[0]) { $ids[1] } else { $ids[0] } }
        $end = { param($t) $ends[$t]++; $st.cur = (& $other $t); $st.active = $false }
        foreach ($p in $plays) {
            $typ = [string]$p.type.text
            $t = [string]$p.team.id
            $pn = [int]$p.period.number
            $clk = [string]$p.clock.displayValue
            if ($null -ne $st.per -and $pn -ne $st.per) { if ($st.cur -and $st.active) { & $end $st.cur }; $st.cur = $null; $st.active = $false }
            $st.per = $pn
            if ($typ -eq 'End Period' -or $typ -eq 'End Game') { if ($st.cur -and $st.active) { & $end $st.cur }; $st.cur = $null; $st.active = $false; continue }
            if ($ids -notcontains $t) { continue }
            if ($typ -eq 'Jumpball') { $st.cur = $t; $st.active = $true; continue }
            if ($typ -like 'Free Throw*') {
                $st.cur = $t; $st.active = $true
                $special = ($typ -match 'Technical|Flagrant|Clear Path')
                if ($p.scoringPlay -and -not $special -and $typ -match '(\d+) of (\d+)' -and $Matches[1] -eq $Matches[2]) {
                    if ($st.last -ne ('fg|' + $t + '|' + $pn + '|' + $clk)) { & $end $t; $st.last = 'ft|' + $t + '|' + $pn + '|' + $clk }
                }
                continue
            }
            if ($typ -like '*Turnover*' -or $typ -eq 'Traveling') { & $end $t; $st.last = 'to'; continue }
            if ($typ -eq 'Defensive Rebound') { $o = & $other $t; if ($st.cur -eq $o) { & $end $o }; $st.cur = $t; $st.active = $true; continue }
            if ($typ -eq 'Offensive Rebound') { $st.cur = $t; $st.active = $true; continue }
            if ($p.shootingPlay) {
                $st.cur = $t; $st.active = $true
                if ($p.scoringPlay) { & $end $t; $st.last = 'fg|' + $t + '|' + $pn + '|' + $clk }
            }
        }
        if ($ends[$ids[0]] -lt 50 -or $ends[$ids[1]] -lt 50) { return $null }
        $out = [ordered]@{}; $out[$abbr[$ids[0]]] = $ends[$ids[0]]; $out[$abbr[$ids[1]]] = $ends[$ids[1]]
        return [pscustomobject]$out
    } catch { return $null }
}

function Test-BoxComplete {
    # A finished game's box score is only worth keeping when both teams have player lines with real numbers in them.
    param($Teams)
    $teams = @($Teams)
    if ($teams.Count -ne 2) { return $false }
    foreach ($t in $teams) {
        $withStats = @($t.players | Where-Object { -not $_.dnp -and @($_.stats | Where-Object { $_ -ne '' -and $_ -ne '--' }).Count -gt 0 })
        if ($withStats.Count -eq 0) { return $false }
    }
    return $true
}

function Test-BoxStale {
    # Recently saved box scores are re-checked once (older ones were already settled): true when one is missing a team's player lines.
    param([string]$Path)
    try {
        $fi = Get-Item $Path
        if (((Get-Date) - $fi.LastWriteTime).TotalDays -gt 3) { return $false }
        $b = Get-Content $Path -Raw | ConvertFrom-Json
        return (-not (Test-BoxComplete $b.teams))
    } catch { return $false }
}

function Save-BoxScore {
    # Downloads one finished game's summary and writes the compact box score. Returns $true when a file was saved.
    param([string]$Id, [string]$Date, [string]$Name)
    $bxPath = Join-Path $CacheDir ("boxscores\" + $Id + '.json')
    $sum = Get-Json "$($EspnBase -replace 'site\.api', 'site.web.api')/apis/site/v2/sports/basketball/nba/summary?region=us&lang=en&contentorigin=espn&event=$Id" 'boxscore' ("summary-" + $Id)
    if (-not $sum -or -not $sum.boxscore) {
        $sum = Get-Json "$espn/summary?event=$Id" 'boxscore' ("summary-alt-" + $Id)
    }
    if (-not $sum -or -not $sum.boxscore) { return $false }
    $boxTeams = @($sum.boxscore.players | ForEach-Object {
        $grp = $_.statistics | Select-Object -First 1
        [pscustomobject]@{
            team = $_.team.abbreviation
            labels = @($grp.labels)
            players = @($grp.athletes | ForEach-Object {
                [pscustomobject]@{
                    id = $_.athlete.id; name = $_.athlete.displayName; jersey = $_.athlete.jersey
                    pos = $_.athlete.position.abbreviation; starter = $_.starter
                    dnp = $_.didNotPlay; reason = $_.reason; stats = @($_.stats)
                }
            })
            totals = @($grp.totals)
        }
    })
    $teamStats = @($sum.boxscore.teams | ForEach-Object {
        [pscustomobject]@{
            team = $_.team.abbreviation
            stats = @($_.statistics | ForEach-Object { [pscustomobject]@{ name = $_.name; value = $_.displayValue } })
        }
    })
    # ESPN sometimes posts a final game before one team's player stats are filled in: do not keep it, so the next sync tries again
    if (-not (Test-BoxComplete $boxTeams)) { Write-Log ("  box score {0} not complete yet, will retry" -f $Id); return $false }
    Save-Json $bxPath ([pscustomobject]@{
        id = $Id; date = $Date; name = $Name
        venue = $sum.gameInfo.venue.fullName; city = $sum.gameInfo.venue.address.city
        attendance = $sum.gameInfo.attendance
        teams = $boxTeams; teamStats = $teamStats; poss = (Get-NbaPossessions $sum); flow = (Get-NbaFlow $sum)
        syncedAt = (Get-Date).ToString('s')
    })
    return $true
}

# ---------------------------------------------------------------- 5. finished days: scoreboards + box scores
$lastComplete = $null
if ($state -and $state.lastCompleteDate) { $lastComplete = [string]$state.lastCompleteDate }
$blocked = $false
$boxCount = 0
$boxMax = 0
if ($Quick) { $boxMax = 3 }

# today is included so box scores of games that already finished tonight get saved; today is never marked complete
$today = $et.Date
$totalDays = [Math]::Max(1, [int](($today - $start).TotalDays) + 1)
for ($day = $start; $day -le $today; $day = $day.AddDays(1)) {
    $ds = $day.ToString('yyyyMMdd')
    $dayPct = 78 + 20 * ([int](($day - $start).TotalDays)) / $totalDays
    Set-Progress $dayPct ('Games for ' + $day.ToString('MMM d'))
    $sbPath = Join-Path $CacheDir ("scoreboards\" + $ds + '.json')
    $cached = $null
    if ((-not $Force) -and (Test-Path $sbPath)) { try { $cached = Get-Content $sbPath -Raw | ConvertFrom-Json } catch { } }

    if ($cached -and $cached.allFinal) {
        if (-not $NoBoxes) {
            foreach ($cev in @($cached.events | Where-Object { $_.state -eq 'post' })) {
                if ($boxMax -gt 0 -and $boxCount -ge $boxMax) { break }
                if ((Test-Path (Join-Path $CacheDir ("boxscores\" + $cev.id + '.json'))) -and -not (Test-BoxStale (Join-Path $CacheDir ("boxscores\" + $cev.id + '.json')))) { continue }
                Set-Progress ($dayPct + 10 / $totalDays) ('Box score ' + $cev.name)
                if (Save-BoxScore -Id ([string]$cev.id) -Date ([string]$cev.date) -Name ([string]$cev.name)) { $boxCount++; Write-Log ("  box score {0}: {1}" -f $cev.id, $cev.name) }
            }
        }
        Write-Log "Day ${ds}: already complete"
        if (-not $blocked -and $day -le $yday) { $lastComplete = $ds }
        continue
    }

    Write-Log "Day $ds"
    $sb = Get-Json "$espn/scoreboard?dates=$ds" 'scoreboard' ("scoreboard-" + $ds)
    if (-not $sb) { $blocked = $true; continue }
    $events = @($sb.events)
    $anyLive = $false
    $evOut = @()
    foreach ($ev in $events) {
        $comp  = $ev.competitions[0]
        $state2 = $ev.status.type.state
        if ($state2 -eq 'in') { $anyLive = $true }
        $sides = @($comp.competitors | ForEach-Object {
            [pscustomobject]@{
                side = $_.homeAway; abbr = $_.team.abbreviation; name = $_.team.displayName
                score = (Get-ScoreText $_); winner = $_.winner
                record = ($_.records | Select-Object -First 1).summary
                lines = @($_.linescores | ForEach-Object { $_.displayValue })
                leaders = @($_.leaders | ForEach-Object {
                    $l = $_.leaders | Select-Object -First 1
                    [pscustomobject]@{ cat = $_.name; player = $l.athlete.displayName; playerId = [string]$l.athlete.id; value = $l.displayValue }
                })
            }
        })
        $evOut += [pscustomobject]@{
            id = $ev.id; date = $ev.date; name = $ev.shortName; state = $state2
            detail = $ev.status.type.shortDetail; period = $ev.status.period
            venue = $comp.venue.fullName; sides = $sides
        }
    }
    # a past day with no games (for example Election Day) counts as complete
    $allFinal = (@($events | Where-Object { $_.status.type.state -ne 'post' }).Count -eq 0)
    if ($day -gt $yday -and @($events).Count -eq 0) { $allFinal = $false }
    Save-Json $sbPath ([pscustomobject]@{ date = $ds; allFinal = $allFinal; syncedAt = (Get-Date).ToString('s'); events = $evOut })

    # box scores for finished games
    foreach ($ev in ($events | Where-Object { $_.status.type.state -eq 'post' })) {
        if ($NoBoxes) { break }
        if ($boxMax -gt 0 -and $boxCount -ge $boxMax) { break }
        $bxPath = Join-Path $CacheDir ("boxscores\" + $ev.id + '.json')
        if ((-not $Force) -and (Test-Path $bxPath) -and -not (Test-BoxStale $bxPath)) { continue }
        Set-Progress ($dayPct + 10 / $totalDays) ('Box score ' + $ev.shortName)
        if (-not (Save-BoxScore -Id $ev.id -Date $ev.date -Name $ev.shortName)) { continue }
        $boxCount++
        Write-Log ("  box score {0}: {1}" -f $ev.id, $ev.shortName)
    }

    if ($anyLive -or -not $allFinal) { $blocked = $true; Write-Log "  Day $ds not complete yet (games still live or not final)" }
    elseif (-not $blocked -and $day -le $yday) { $lastComplete = $ds }
}

# ---------------------------------------------------------------- state + traffic log
$wireTotal = 0; $decTotal = 0
foreach ($row in $script:Traffic) {
    if ($row.WireBytes -gt 0) { $wireTotal += $row.WireBytes }
    $decTotal += $row.DecodedBytes
}
Save-Json $statePath ([pscustomobject]@{
    lastRun = (Get-Date).ToString('s'); lastCompleteDate = $lastComplete
    requests = $script:Traffic.Count; wireBytes = $wireTotal; decodedBytes = $decTotal
    errors = $script:Errors; boxScoresSaved = $boxCount
})
$csv = Join-Path $CacheDir 'traffic-log.csv'
if (Test-Path $csv) {
    $script:Traffic | ConvertTo-Csv -NoTypeInformation | Select-Object -Skip 1 | Add-Content -Path $csv -Encoding UTF8
} else {
    $script:Traffic | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
}

Set-Progress 100 'Finished'
Write-Log ("=== Done: {0} requests, {1:N0} KB on the wire (where reported), {2:N0} KB decoded, {3} box scores, {4} errors, covered through {5}" -f `
    $script:Traffic.Count, ($wireTotal / 1KB), ($decTotal / 1KB), $boxCount, $script:Errors, $lastComplete)
$mutex.ReleaseMutex(); $mutex.Dispose()
if ($script:Errors -gt 0) { exit 1 } else { exit 0 }
