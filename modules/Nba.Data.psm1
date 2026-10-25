# Nba.Data.psm1 - ESPN fetching, compacting, and the background live worker for NBADash.
# Windows PowerShell 5.1 compatible. The worker runs in its own runspace and talks to the UI thread through
# a shared synchronized hashtable ($Shared) and a ConcurrentQueue of JSON strings.

Set-StrictMode -Off
$script:UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NBADash/0.1'
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)

function New-NbaShared {
    param([string]$CacheDir, [int]$LiveSeconds = 30,
          [string]$EspnBase = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba',
          [string]$EspnWebBase = 'https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba',
          [string]$EspnV2Base = 'https://site.api.espn.com/apis/v2/sports/basketball/nba',
          [string]$EspnCommonBase = 'https://site.web.api.espn.com/apis/common/v3')
    $traffic = [hashtable]::Synchronized(@{ Requests = 0; Errors = 0; Bytes = [long]0; Wire = [long]0; Last = ''; ByKind = @{}; Started = (Get-Date) })
    return [hashtable]::Synchronized(@{
        CacheDir = $CacheDir; LiveSeconds = $LiveSeconds
        # user-adjustable timing (minutes unless named otherwise); the host overwrites these from settings
        Auto = $false      # automatic fetching is opt-in; when false the worker only fetches what the person asks for
        Tune = [hashtable]::Synchronized(@{ IdleMinutes = 10; OldDayHours = 6; TableLiveMinutes = 15; TableStaleHours = 6 })
        EspnBase = $EspnBase; EspnWebBase = $EspnWebBase; EspnV2Base = $EspnV2Base; EspnCommonBase = $EspnCommonBase
        Queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
        Commands = New-Object 'System.Collections.Concurrent.ConcurrentQueue[object]'
        Watch = [hashtable]::Synchronized(@{})
        Traffic = $traffic
        Stop = $false; RefreshNow = $false
        # Paused: tab hidden (launcher) - no timed fetching, queued one-off requests still run.
        # Halted: kill switch - nothing runs until the person resumes. LiveCount: games in progress, for the host's status.
        Paused = $false; Halted = $false; LiveCount = 0
    })
}

function Add-NbaTraffic {
    param($Shared, [string]$Kind, [long]$Wire, [long]$Decoded, [bool]$Ok, [string]$Url = '')
    $t = $Shared.Traffic
    [System.Threading.Monitor]::Enter($t.SyncRoot)
    try {
        $t.Requests++
        if (-not $Ok) { $t.Errors++ }
        $t.Bytes += $Decoded
        if ($Wire -gt 0) { $t.Wire += $Wire } else { $t.Wire += [long]($Decoded / 5) }   # chunked responses: estimate gzip ratio
        $t.Last = '{0} {1}' -f (Get-Date).ToString('HH:mm:ss'), $Kind
        if (-not $t.ByKind.ContainsKey($Kind)) { $t.ByKind[$Kind] = @{ requests = 0; bytes = [long]0 } }
        $t.ByKind[$Kind].requests++
        $t.ByKind[$Kind].bytes += $Decoded
    } finally { [System.Threading.Monitor]::Exit($t.SyncRoot) }
}

function Get-NbaJson {
    param($Shared, [string]$Url, [string]$Kind)
    $status = 0; $wire = -1; $dec = 0; $obj = $null; $err = ''
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $req = [Net.HttpWebRequest]::Create($Url)
        $req.UserAgent = $script:UA
        $req.Accept = 'application/json'
        $req.Timeout = 20000
        $req.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
        $resp = $req.GetResponse()
        $status = [int]$resp.StatusCode
        $wire = $resp.ContentLength
        $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
        $dec = $script:Utf8.GetByteCount($text)
        $obj = $text | ConvertFrom-Json
    } catch { $err = $_.Exception.Message }
    Add-NbaTraffic -Shared $Shared -Kind $Kind -Wire $wire -Decoded $dec -Ok ($null -ne $obj) -Url $Url
    $Shared.LastError = $err
    return $obj
}

function Save-NbaJsonFile {
    param([string]$Path, $Object)
    $dir = Split-Path $Path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.tmp"
    [IO.File]::WriteAllText($tmp, ($Object | ConvertTo-Json -Depth 10 -Compress), $script:Utf8)
    Move-Item -Path $tmp -Destination $Path -Force
}

function Get-NbaScoreText {
    param($c)
    $sc = $c.score
    if ($null -eq $sc) { return $null }
    if ($sc.PSObject.Properties['displayValue']) { return [string]$sc.displayValue }
    return [string]$sc
}

# ---------------------------------------------------------------- compactors (same shapes as Sync-NBACache.ps1)
function ConvertTo-NbaDay {
    param($Sb, [string]$Ds)
    $events = @($Sb.events)
    $out = @()
    foreach ($ev in $events) {
        $comp = $ev.competitions[0]
        $sides = @($comp.competitors | ForEach-Object {
            [pscustomobject]@{
                side = $_.homeAway; abbr = $_.team.abbreviation; name = $_.team.displayName
                score = (Get-NbaScoreText $_); winner = $_.winner
                record = ($_.records | Select-Object -First 1).summary
                lines = @($_.linescores | ForEach-Object { $_.displayValue })
                leaders = @($_.leaders | ForEach-Object {
                    $l = $_.leaders | Select-Object -First 1
                    [pscustomobject]@{ cat = $_.name; player = $l.athlete.displayName; playerId = [string]$l.athlete.id; value = $l.displayValue }
                })
            }
        })
        $out += [pscustomobject]@{
            id = [string]$ev.id; date = $ev.date; name = $ev.shortName; state = $ev.status.type.state
            detail = $ev.status.type.shortDetail; period = $ev.status.period; clock = $ev.status.displayClock
            venue = $comp.venue.fullName; sides = $sides
        }
    }
    $allFinal = (@($events | Where-Object { $_.status.type.state -ne 'post' }).Count -eq 0)
    return [pscustomobject]@{ date = $Ds; allFinal = $allFinal; fetchedAt = (Get-Date).ToUniversalTime().ToString('o'); events = $out }
}

function Get-NbaBoxInjuries {
    # The game's injury report from the summary (already downloaded with the box score): who is out or questionable for each team.
    param($Sum)
    try {
        return @(foreach ($t in @($Sum.injuries)) {
            $abbr = [string]$t.team.abbreviation
            foreach ($i in @($t.injuries)) {
                if (-not $i -or -not $i.athlete) { continue }
                $d = $i.details
                $what = @([string]$d.type, [string]$d.detail) | Where-Object { $_ -and $_ -ne 'Not Specified' }
                [pscustomobject]@{
                    team = $abbr; id = [string]$i.athlete.id; name = [string]$i.athlete.displayName
                    status = [string]$i.status; date = [string]$i.date
                    detail = ($what -join ', '); returnDate = [string]$d.returnDate
                }
            }
        })
    } catch { return @() }
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

function ConvertTo-NbaBox {
    param($Sum, $Game)
    $boxTeams = @($Sum.boxscore.players | ForEach-Object {
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
    $teamStats = @($Sum.boxscore.teams | ForEach-Object {
        [pscustomobject]@{
            team = $_.team.abbreviation
            stats = @($_.statistics | ForEach-Object { [pscustomobject]@{ name = $_.name; value = $_.displayValue } })
        }
    })
    # most recent made basket / free throw, from the play-by-play that already comes with the summary (no extra request); only for games not yet final
    $lastScore = $null
    $gState = try { [string]$Sum.header.competitions[0].status.type.state } catch { '' }
    if ($gState -ne 'post') {
        try {
            $abbrById = @{}
            foreach ($t in $Sum.boxscore.teams) { $abbrById[[string]$t.team.id] = [string]$t.team.abbreviation }
            $sp = @($Sum.plays | Where-Object { $_.scoringPlay })
            if ($sp.Count -gt 0) {
                $pl = if ($sp[0].sequenceNumber) { $sp | Sort-Object { [double]$_.sequenceNumber } | Select-Object -Last 1 } else { $sp[$sp.Count - 1] }
                $lastScore = [pscustomobject]@{
                    text = [string]$pl.text; value = [int]$pl.scoreValue; team = $abbrById[[string]$pl.team.id]
                    period = [int]$pl.period.number; clock = [string]$pl.clock.displayValue; type = [string]$pl.type.text
                }
            }
        } catch { $lastScore = $null }
    }
    return [pscustomobject]@{
        id = [string]$Game.id; date = $Game.date; name = $Game.name; lastScore = $lastScore
        venue = $Sum.gameInfo.venue.fullName; city = $Sum.gameInfo.venue.address.city
        attendance = $Sum.gameInfo.attendance
        teams = $boxTeams; teamStats = $teamStats; syncedAt = (Get-Date).ToString('s')
        poss = $(if ($gState -eq 'post') { Get-NbaPossessions $Sum } else { $null })
        flow = (Get-NbaFlow $Sum)
        injuries = @(Get-NbaBoxInjuries $Sum)
    }
}

function ConvertTo-NbaStandings {
    param($St)
    $conf = @($St.children | ForEach-Object {
        [pscustomobject]@{
            name = $_.name
            teams = @($_.standings.entries | ForEach-Object {
                $h = @{}
                foreach ($x in $_.stats) { $h[$x.name] = $x.displayValue }
                [pscustomobject]@{ abbr = $_.team.abbreviation; name = $_.team.displayName; stats = $h }
            })
        }
    })
    return [pscustomobject]@{ syncedAt = (Get-Date).ToString('s'); conferences = $conf }
}

function ConvertTo-NbaInjuries {
    param($Inj)
    $teams = @($Inj.injuries | ForEach-Object {
        [pscustomobject]@{
            team = $_.displayName; teamId = $_.id
            players = @($_.injuries | ForEach-Object {
                [pscustomobject]@{ id = $_.athlete.id; name = $_.athlete.displayName; status = $_.status; date = $_.date; comment = $_.shortComment }
            })
        }
    })
    return [pscustomobject]@{ syncedAt = (Get-Date).ToString('s'); teams = $teams }
}


function ConvertTo-NbaPlayer {
    # Compacts ESPN's athlete + stats feeds into one small object: bio, plus season-by-season averages/totals/misc.
    param($Ath, $Stats)
    $a = $Ath.athlete
    $dob = ''
    if ([string]$a.displayDOB -match '^(\d{1,2})/(\d{1,2})/(\d{4})$') { $dob = '{0}-{1:00}-{2:00}' -f $Matches[3], [int]$Matches[2], [int]$Matches[1] }
    $college = ''
    if ($a.college) { if ($a.college -is [string]) { $college = $a.college } elseif ($a.college.name) { $college = [string]$a.college.name } }
    if (-not $college -and $a.displayCollege) { $college = [string]$a.displayCollege }
    $bio = [pscustomobject]@{
        id = [string]$a.id; name = [string]$a.displayName; jersey = [string]$a.jersey
        pos = [string]$a.position.abbreviation; posName = [string]$a.position.displayName
        teamId = [string]$a.team.id; team = [string]$a.team.abbreviation; teamName = [string]$a.team.displayName
        headshot = [string]$a.headshot.href
        height = [string]$a.displayHeight; weight = [string]$a.displayWeight; age = $a.age; dob = $dob
        birthPlace = [string]$a.displayBirthPlace; draft = [string]$a.displayDraft; experience = [string]$a.displayExperience
        college = $college; citizenship = [string]$a.citizenship; status = [string]$a.status.name; debutYear = $a.debutYear
    }
    $cats = @{}
    foreach ($c in @($Stats.categories)) { $cats[[string]$c.name] = $c }
    $rows = [ordered]@{}
    $career = @{}
    foreach ($k in 'averages', 'totals', 'miscellaneous') {
        $c = $cats[$k]
        if (-not $c) { continue }
        $career[$k] = @($c.totals)
        foreach ($r in @($c.statistics)) {
            $key = '{0}|{1}|{2}' -f $r.season.year, $r.season.displayName, $r.teamId
            if (-not $rows.Contains($key)) {
                $rows[$key] = @{ year = [int]$r.season.year; season = [string]$r.season.displayName; teamId = [string]$r.teamId; team = [string]$r.teamSlug; avg = @(); tot = @(); misc = @() }
            }
            $f = switch ($k) { 'averages' { 'avg' } 'totals' { 'tot' } default { 'misc' } }
            $rows[$key][$f] = @($r.stats)
        }
    }
    $seasons = @($rows.Values | ForEach-Object { [pscustomobject]$_ })
    $lab = { param($n) if ($cats[$n]) { @($cats[$n].labels) } else { @() } }
    return [pscustomobject]@{
        syncedAt = (Get-Date).ToString('s'); season = [int]$Ath.season.year; seasonName = [string]$Ath.season.displayName
        bio = $bio
        avgLabels = (& $lab 'averages'); totLabels = (& $lab 'totals'); miscLabels = (& $lab 'miscellaneous')
        seasons = $seasons
        career = [pscustomobject]@{ avg = @($career['averages']); tot = @($career['totals']); misc = @($career['miscellaneous']) }
    }
}

function ConvertTo-NbaPlayerSearch {
    param($Res)
    $items = @($Res.items | Where-Object { $_.type -eq 'player' } | ForEach-Object {
        $team = [string]$_.label -replace '^NBA\s*-\s*', ''
        [pscustomobject]@{
            id = [string]$_.id; name = [string]$_.displayName; team = $team; jersey = [string]$_.jersey
            pos = [string]$_.position.abbreviation; active = [bool]$_.isActive; retired = [bool]$_.isRetired; headshot = [string]$_.headshot.href
        }
    })
    return $items
}

# ---------------------------------------------------------------- time helpers
function Get-NbaEasternNow {
    foreach ($id in 'Eastern Standard Time', 'America/New_York') {
        try { return [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, $id) } catch { }
    }
    return [DateTime]::UtcNow.AddHours(-5)
}

function Push-NbaEvent {
    param($Shared, [string]$Name, $Data)
    $json = '{{"event":"{0}","data":{1}}}' -f $Name, ($Data | ConvertTo-Json -Depth 10 -Compress)
    $Shared.Queue.Enqueue($json)
}

# ---------------------------------------------------------------- the worker
function Invoke-NbaWorker {
    param($Shared)
    $cache = $Shared.CacheDir
    $day = @{}        # ds -> @{ nextAt; json; events; allFinal; anyLive }
    $box = @{}        # id -> @{ nextAt; done }
    $known = @{}      # id -> compact event (latest)
    $next = @{ standings = [DateTime]::MinValue; injuries = [DateTime]::MinValue }

    $fileAge = { param($p) if (Test-Path $p) { ((Get-Date) - (Get-Item $p).LastWriteTime).TotalMinutes } else { 99999 } }

    while (-not $Shared.Stop) {
        try {
            $now = [DateTime]::UtcNow
            if ($Shared.Halted) {
                # kill switch: drop anything queued and fetch nothing until the person resumes
                $drop = $null; while ($Shared.Commands.TryDequeue([ref]$drop)) { }
                $Shared.RefreshNow = $false
                Start-Sleep -Milliseconds 500
                continue
            }
            $force = [bool]$Shared.RefreshNow
            $auto = [bool]$Shared.Auto -and -not $Shared.Paused     # paused (hidden tab): one-off requests only
            $Shared.RefreshNow = $false
            $live = [Math]::Max(10, [int]$Shared.LiveSeconds)

            $cmd = $null
            while ($Shared.Commands.TryDequeue([ref]$cmd)) {
                if ($cmd.type -eq 'box' -and $cmd.id) {
                    if (-not $box.ContainsKey($cmd.id)) { $box[$cmd.id] = @{ nextAt = [DateTime]::MinValue; done = $false } }
                    $box[$cmd.id].nextAt = [DateTime]::MinValue; $box[$cmd.id].oneShot = $true
                }
                elseif ($cmd.type -eq 'player' -and $cmd.id) {
                    $ath = Get-NbaJson -Shared $Shared -Url ("{0}/sports/basketball/nba/athletes/{1}" -f $Shared.EspnCommonBase, $cmd.id) -Kind 'player'
                    if (-not $ath -or -not $ath.athlete) { Push-NbaEvent $Shared 'player' @{ id = $cmd.id; error = 'ESPN did not return this player right now.' }; continue }
                    $st = Get-NbaJson -Shared $Shared -Url ("{0}/sports/basketball/nba/athletes/{1}/stats" -f $Shared.EspnCommonBase, $cmd.id) -Kind 'player'
                    $pm = ConvertTo-NbaPlayer -Ath $ath -Stats $st
                    New-Item -ItemType Directory -Path (Join-Path $cache 'players') -Force | Out-Null
                    Save-NbaJsonFile (Join-Path $cache ("players\{0}.json" -f $cmd.id)) $pm
                    Push-NbaEvent $Shared 'player' @{ id = $cmd.id; player = $pm }
                }
                elseif ($cmd.type -eq 'psearch' -and $cmd.q) {
                    $url = "{0}/search?query={1}&limit=8&type=player&sport=basketball&league=nba" -f $Shared.EspnCommonBase, [Uri]::EscapeDataString([string]$cmd.q)
                    $res = Get-NbaJson -Shared $Shared -Url $url -Kind 'search'
                    $items = if ($res) { @(ConvertTo-NbaPlayerSearch $res) } else { @() }
                    Push-NbaEvent $Shared 'psearch' @{ q = [string]$cmd.q; ok = [bool]$res; items = $items }
                }
            }

            $et = Get-NbaEasternNow
            $keys = @($et.Date.ToString('yyyyMMdd'), $et.Date.AddDays(-1).ToString('yyyyMMdd'))
            $anyLiveNow = $false
            foreach ($ds in $keys) {
                if (-not $day.ContainsKey($ds)) { $day[$ds] = @{ nextAt = [DateTime]::MinValue; json = ''; allFinal = $false; anyLive = $false } }
                $d = $day[$ds]
                if (-not $auto -and -not $force) { continue }      # manual mode: only the refresh button fetches scoreboards
                if (-not $force -and $now -lt $d.nextAt) { if ($d.anyLive) { $anyLiveNow = $true }; continue }
                $sb = Get-NbaJson -Shared $Shared -Url ("{0}/scoreboard?dates={1}" -f $Shared.EspnBase, $ds) -Kind 'scoreboard'
                if (-not $sb) {
                    Push-NbaEvent $Shared 'live' @{ ok = $false; error = [string]$Shared.LastError; at = [long](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()) }
                    $d.nextAt = $now.AddSeconds(30)
                    continue
                }
                $model = ConvertTo-NbaDay -Sb $sb -Ds $ds
                foreach ($e in $model.events) { $known[$e.id] = $e }
                $d.anyLive = (@($model.events | Where-Object { $_.state -eq 'in' }).Count -gt 0)
                $d.allFinal = [bool]$model.allFinal -and ($ds -ne $keys[0] -or $model.events.Count -gt 0)
                if ($d.anyLive) { $anyLiveNow = $true }
                $soon = @($model.events | Where-Object { $_.state -eq 'pre' -and (([DateTime]::Parse($_.date).ToUniversalTime() - $now).TotalMinutes -lt 30) }).Count -gt 0
                $stamp = ($model | Select-Object -ExcludeProperty fetchedAt | ConvertTo-Json -Depth 10 -Compress)
                if ($stamp -ne $d.json -or $force) { $d.json = $stamp; Push-NbaEvent $Shared 'scoreboard' $model }
                Push-NbaEvent $Shared 'live' @{ ok = $true; error = ''; at = [long](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()); anyLive = $anyLiveNow; interval = $live }
                if ($d.anyLive -or $soon) { $d.nextAt = $now.AddSeconds($live) }
                elseif ($d.allFinal -and $ds -ne $keys[0]) { $d.nextAt = $now.AddHours([double]$Shared.Tune.OldDayHours) }
                else { $d.nextAt = $now.AddMinutes([double]$Shared.Tune.IdleMinutes) }
                # keep a copy for next launch; never replace a day the sync already completed
                $sbPath = Join-Path $cache ("scoreboards\$ds.json")
                $write = $true
                if (Test-Path $sbPath) { try { if ((Get-Content $sbPath -Raw | ConvertFrom-Json).allFinal) { $write = $false } } catch { } }
                if ($write -and $model.events.Count -gt 0) {
                    # allFinal stays false so the nightly sync still finishes the day (box scores)
                    $copy = [pscustomobject]@{ date = $ds; allFinal = $false; syncedAt = (Get-Date).ToString('s'); events = $model.events }
                    Save-NbaJsonFile $sbPath $copy
                }
            }

            $Shared.LiveCount = @($known.Values | Where-Object { $_.state -eq 'in' }).Count

            # box scores for watched / requested games
            $want = @(if ($auto) { $Shared.Watch.Keys }) + @($box.Keys | Where-Object { $box[$_].oneShot })
            foreach ($id in ($want | Select-Object -Unique)) {
                if (-not $box.ContainsKey($id)) { $box[$id] = @{ nextAt = [DateTime]::MinValue; done = $false } }
                $b = $box[$id]
                $ev = $known[$id]
                $state = if ($ev) { $ev.state } else { 'unknown' }
                if ($state -eq 'pre') { $b.oneShot = $false; continue }
                if ($b.done -and -not $force) { continue }
                if (-not $force -and $now -lt $b.nextAt) { continue }
                $sum = Get-NbaJson -Shared $Shared -Url ("{0}/summary?region=us&lang=en&contentorigin=espn&event={1}" -f $Shared.EspnWebBase, $id) -Kind 'boxscore'
                if (-not $sum -or -not $sum.boxscore) { $sum = Get-NbaJson -Shared $Shared -Url ("{0}/summary?event={1}" -f $Shared.EspnBase, $id) -Kind 'boxscore' }
                $b.nextAt = $now.AddSeconds($live)
                if (-not $sum -or -not $sum.boxscore) { if (-not $auto) { $b.oneShot = $false }; continue }
                if ($state -eq 'unknown') {
                    # no scoreboard fetched yet (manual mode): take the game state from the summary itself; never cache a game as final unless ESPN says so
                    $st0 = try { [string]$sum.header.competitions[0].status.type.state } catch { '' }
                    $state = if ($st0) { $st0 } else { 'unknown' }
                }
                $evForBox = if ($ev) { $ev } else { [pscustomobject]@{ id = $id; date = ''; name = '' } }
                $model = ConvertTo-NbaBox -Sum $sum -Game $evForBox
                Push-NbaEvent $Shared 'box' @{ eventId = $id; box = $model }
                if ($state -eq 'post') {
                    Save-NbaJsonFile (Join-Path $cache "boxscores\$id.json") $model
                    $b.done = $true
                    if ($Shared.Watch.ContainsKey($id)) { $Shared.Watch.Remove($id) }
                }
                if ($b.oneShot -and ($state -ne 'in' -or -not $auto)) { $b.oneShot = $false }
                if ($b.oneShot -and -not $Shared.Watch.ContainsKey($id)) { $b.oneShot = $false }
            }

            # standings and injuries: every 15 minutes while games are live, otherwise when the cache is stale
            $stPath = Join-Path $cache 'standings.json'; $injPath = Join-Path $cache 'injuries.json'
            $stDue = if (-not $auto) { $force } elseif ($anyLiveNow) { $now -ge $next.standings } else { ((& $fileAge $stPath) -gt ([double]$Shared.Tune.TableStaleHours * 60)) -and ($now -ge $next.standings) }
            if ($stDue) {
                $next.standings = $now.AddMinutes([double]$Shared.Tune.TableLiveMinutes)
                $st = Get-NbaJson -Shared $Shared -Url ("{0}/standings" -f $Shared.EspnV2Base) -Kind 'standings'
                if ($st) { $m = ConvertTo-NbaStandings $st; Save-NbaJsonFile $stPath $m; Push-NbaEvent $Shared 'standings' $m }
            }
            $injDue = if (-not $auto) { $force } elseif ($anyLiveNow) { $now -ge $next.injuries } else { ((& $fileAge $injPath) -gt ([double]$Shared.Tune.TableStaleHours * 60)) -and ($now -ge $next.injuries) }
            if ($injDue) {
                $next.injuries = $now.AddMinutes([double]$Shared.Tune.TableLiveMinutes)
                $inj = Get-NbaJson -Shared $Shared -Url ("{0}/injuries" -f $Shared.EspnBase) -Kind 'injuries'
                if ($inj) { $m = ConvertTo-NbaInjuries $inj; Save-NbaJsonFile $injPath $m; Push-NbaEvent $Shared 'injuries' $m }
            }
        } catch {
            Push-NbaEvent $Shared 'live' @{ ok = $false; error = $_.Exception.Message; at = [long](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()) }
        }
        for ($i = 0; $i -lt 8 -and -not $Shared.Stop -and -not $Shared.RefreshNow -and $Shared.Commands.IsEmpty; $i++) { Start-Sleep -Milliseconds 250 }
    }
}

Export-ModuleMember -Function ConvertTo-NbaPlayer, ConvertTo-NbaPlayerSearch, New-NbaShared, Invoke-NbaWorker, Get-NbaJson, Save-NbaJsonFile, ConvertTo-NbaDay, ConvertTo-NbaBox, ConvertTo-NbaStandings, ConvertTo-NbaInjuries, Add-NbaTraffic, Push-NbaEvent
