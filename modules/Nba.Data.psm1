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
          [string]$EspnV2Base = 'https://site.api.espn.com/apis/v2/sports/basketball/nba')
    $traffic = [hashtable]::Synchronized(@{ Requests = 0; Errors = 0; Bytes = [long]0; Wire = [long]0; Last = ''; ByKind = @{}; Started = (Get-Date) })
    return [hashtable]::Synchronized(@{
        CacheDir = $CacheDir; LiveSeconds = $LiveSeconds
        EspnBase = $EspnBase; EspnWebBase = $EspnWebBase; EspnV2Base = $EspnV2Base
        Queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
        Commands = New-Object 'System.Collections.Concurrent.ConcurrentQueue[object]'
        Watch = [hashtable]::Synchronized(@{})
        Traffic = $traffic
        Stop = $false; RefreshNow = $false
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
                    [pscustomobject]@{ cat = $_.name; player = $l.athlete.displayName; value = $l.displayValue }
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
    return [pscustomobject]@{
        id = [string]$Game.id; date = $Game.date; name = $Game.name
        venue = $Sum.gameInfo.venue.fullName; city = $Sum.gameInfo.venue.address.city
        attendance = $Sum.gameInfo.attendance
        teams = $boxTeams; teamStats = $teamStats; syncedAt = (Get-Date).ToString('s')
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
            $force = [bool]$Shared.RefreshNow
            $Shared.RefreshNow = $false
            $live = [Math]::Max(10, [int]$Shared.LiveSeconds)

            $cmd = $null
            while ($Shared.Commands.TryDequeue([ref]$cmd)) {
                if ($cmd.type -eq 'box' -and $cmd.id) {
                    if (-not $box.ContainsKey($cmd.id)) { $box[$cmd.id] = @{ nextAt = [DateTime]::MinValue; done = $false } }
                    $box[$cmd.id].nextAt = [DateTime]::MinValue; $box[$cmd.id].oneShot = $true
                }
            }

            $et = Get-NbaEasternNow
            $keys = @($et.Date.ToString('yyyyMMdd'), $et.Date.AddDays(-1).ToString('yyyyMMdd'))
            $anyLiveNow = $false
            foreach ($ds in $keys) {
                if (-not $day.ContainsKey($ds)) { $day[$ds] = @{ nextAt = [DateTime]::MinValue; json = ''; allFinal = $false; anyLive = $false } }
                $d = $day[$ds]
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
                elseif ($d.allFinal -and $ds -ne $keys[0]) { $d.nextAt = $now.AddHours(6) }
                else { $d.nextAt = $now.AddMinutes(10) }
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

            # box scores for watched / requested games
            $want = @($Shared.Watch.Keys) + @($box.Keys | Where-Object { $box[$_].oneShot })
            foreach ($id in ($want | Select-Object -Unique)) {
                if (-not $box.ContainsKey($id)) { $box[$id] = @{ nextAt = [DateTime]::MinValue; done = $false } }
                $b = $box[$id]
                $ev = $known[$id]
                $state = if ($ev) { $ev.state } else { 'post' }
                if ($state -eq 'pre') { $b.oneShot = $false; continue }
                if ($b.done -and -not $force) { continue }
                if (-not $force -and $now -lt $b.nextAt) { continue }
                $sum = Get-NbaJson -Shared $Shared -Url ("{0}/summary?region=us&lang=en&contentorigin=espn&event={1}" -f $Shared.EspnWebBase, $id) -Kind 'boxscore'
                if (-not $sum -or -not $sum.boxscore) { $sum = Get-NbaJson -Shared $Shared -Url ("{0}/summary?event={1}" -f $Shared.EspnBase, $id) -Kind 'boxscore' }
                $b.nextAt = $now.AddSeconds($live)
                if (-not $sum -or -not $sum.boxscore) { continue }
                $evForBox = if ($ev) { $ev } else { [pscustomobject]@{ id = $id; date = ''; name = '' } }
                $model = ConvertTo-NbaBox -Sum $sum -Game $evForBox
                Push-NbaEvent $Shared 'box' @{ eventId = $id; box = $model }
                if ($state -eq 'post') {
                    Save-NbaJsonFile (Join-Path $cache "boxscores\$id.json") $model
                    $b.done = $true
                    if ($Shared.Watch.ContainsKey($id)) { $Shared.Watch.Remove($id) }
                }
                if ($b.oneShot -and $state -ne 'in') { $b.oneShot = $false }
                if ($b.oneShot -and -not $Shared.Watch.ContainsKey($id)) { $b.oneShot = $false }
            }

            # standings and injuries: every 15 minutes while games are live, otherwise when the cache is stale
            $stPath = Join-Path $cache 'standings.json'; $injPath = Join-Path $cache 'injuries.json'
            $stDue = if ($anyLiveNow) { $now -ge $next.standings } else { ((& $fileAge $stPath) -gt 360) -and ($now -ge $next.standings) }
            if ($stDue) {
                $next.standings = $now.AddMinutes(15)
                $st = Get-NbaJson -Shared $Shared -Url ("{0}/standings" -f $Shared.EspnV2Base) -Kind 'standings'
                if ($st) { $m = ConvertTo-NbaStandings $st; Save-NbaJsonFile $stPath $m; Push-NbaEvent $Shared 'standings' $m }
            }
            $injDue = if ($anyLiveNow) { $now -ge $next.injuries } else { ((& $fileAge $injPath) -gt 360) -and ($now -ge $next.injuries) }
            if ($injDue) {
                $next.injuries = $now.AddMinutes(15)
                $inj = Get-NbaJson -Shared $Shared -Url ("{0}/injuries" -f $Shared.EspnBase) -Kind 'injuries'
                if ($inj) { $m = ConvertTo-NbaInjuries $inj; Save-NbaJsonFile $injPath $m; Push-NbaEvent $Shared 'injuries' $m }
            }
        } catch {
            Push-NbaEvent $Shared 'live' @{ ok = $false; error = $_.Exception.Message; at = [long](([DateTimeOffset]::UtcNow).ToUnixTimeMilliseconds()) }
        }
        for ($i = 0; $i -lt 8 -and -not $Shared.Stop -and -not $Shared.RefreshNow -and $Shared.Commands.IsEmpty; $i++) { Start-Sleep -Milliseconds 250 }
    }
}

Export-ModuleMember -Function New-NbaShared, Invoke-NbaWorker, Get-NbaJson, Save-NbaJsonFile, ConvertTo-NbaDay, ConvertTo-NbaBox, ConvertTo-NbaStandings, ConvertTo-NbaInjuries, Add-NbaTraffic, Push-NbaEvent
