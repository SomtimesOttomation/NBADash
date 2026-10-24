<#
.SYNOPSIS
    NBADash backend for DashLauncher contract version 1 (see DASH-CONTRACT.md in the DashLauncher repo).
.DESCRIPTION
    Windows PowerShell 5.1. Everything the dashboard does except the window: settings, the worker runspace, the sync and
    updater child processes, the nightly task, and the page bridge. Whoever hosts it (Start-NBADash.ps1 standalone, or
    DashLauncher) creates the window and WebView2 and passes a context object to Initialize-Dash.
    Nothing here creates a window or touches WebView2; it talks to the page only through Context.Post.
#>

$script:Ctx = $null
$script:Root = Split-Path $PSScriptRoot
$script:Utf8 = New-Object System.Text.UTF8Encoding($false)
$script:Mutex = $null
$script:Shared = $null
$script:WorkerPs = $null
$script:WorkerHandle = $null
$script:Halted = $false          # kill switch pressed; only the person resumes, from inside the dash

$script:Allowed = @('teams.json', 'standings.json', 'injuries.json', 'sync-state.json', 'league-stats.json', 'transactions.json')
$script:TuneDefaults = [ordered]@{ idleMinutes = @(10, 1, 120); oldDayHours = @(6, 1, 48); tableLiveMinutes = @(15, 5, 120); tableStaleHours = @(6, 1, 48); teamFreshHours = @(20, 1, 168); tableFreshHours = @(4, 1, 48); backfillDays = @(7, 1, 30) }

# ---------------------------------------------------------------- page messages
function Send-Page {
    param([string]$Json)
    try { if ($script:Ctx -and $script:Ctx.Post) { & $script:Ctx.Post $Json } } catch { }
}
function Reply {
    param($Id, [string]$DataJson = 'null')
    Send-Page ('{{"id":{0},"ok":true,"data":{1}}}' -f $Id, $DataJson)
}
function ReplyError {
    param($Id, [string]$Message)
    Send-Page ('{{"id":{0},"ok":false,"error":{1}}}' -f $Id, (ConvertTo-Json -InputObject $Message -Compress))
}

# ---------------------------------------------------------------- settings
function Set-Tune {
    $script:Shared.Auto = [bool]$script:Settings.autoRefresh
    $t = $script:Shared.Tune
    $t.IdleMinutes = [double]$script:Settings.idleMinutes; $t.OldDayHours = [double]$script:Settings.oldDayHours
    $t.TableLiveMinutes = [double]$script:Settings.tableLiveMinutes; $t.TableStaleHours = [double]$script:Settings.tableStaleHours
}
function Save-Settings {
    [IO.File]::WriteAllText($script:SettingsPath, ($script:Settings | ConvertTo-Json -Depth 5), $script:Utf8)
}

# ---------------------------------------------------------------- sync child process
$script:SyncProc = $null
$script:LastSyncJson = ''
$script:SyncPct = $null
function Start-Sync {
    param([string]$Mode, [string]$Team = '')
    if ($script:Halted) { return $false }
    if ($script:SyncProc -and -not $script:SyncProc.HasExited) { return $false }
    $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $script:Root 'Sync-NBACache.ps1')),
                  '-CacheDir', ('"{0}"' -f $script:CacheDir), '-SettingsPath', ('"{0}"' -f $script:SettingsPath))
    switch ($Mode) {
        'favorites' { $argsList += '-Quick'; $argsList += '-Force' }
        'force'     { $argsList += '-Force' }
        'team'      { $argsList += '-Quick'; $argsList += '-Force'; $argsList += '-Favorites'; $argsList += $Team }
        # whole season so far, one scoreboard per day; finished days are skipped, so a cancelled run resumes where it stopped
        'history'      { $argsList += '-FullSeason'; $argsList += '-HistoryOnly'; $argsList += '-NoBoxes'; $argsList += '-DelayMs'; $argsList += '800' }
        'historyBoxes' { $argsList += '-FullSeason'; $argsList += '-HistoryOnly'; $argsList += '-DelayMs'; $argsList += '1000' }
    }
    $script:SyncProc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsList -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $script:SyncOut
    Push-NbaEvent $script:Shared 'sync' @{ running = $true; pct = 0; text = 'Starting...'; line = '' }
    $script:LastSyncJson = ''
    $script:SyncPct = 0
    return $true
}

function Get-SyncState {
    $p = Join-Path $script:CacheDir 'sync-state.json'
    if (Test-Path $p) { try { return Get-Content $p -Raw | ConvertFrom-Json } catch { } }
    return $null
}

function Get-SyncProgress {
    # Reads a child's console output: last ##PROGRESS marker, last normal line, and the final "=== Done" summary.
    param([string]$Path)
    $r = @{ pct = 0; text = ''; line = ''; summary = '' }
    try {
        $fs = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
        $sr = New-Object IO.StreamReader($fs)
        while (($l = $sr.ReadLine()) -ne $null) {
            $l = $l.Trim()
            if (-not $l) { continue }
            if ($l -match '^##PROGRESS (\d+)\|(.*)$') { $r.pct = [int]$Matches[1]; $r.text = $Matches[2] }
            else {
                $r.line = $l
                if ($l -match '=== Done') { $r.summary = ($l -replace '^\S+\s+=== Done:\s*', '') }
            }
        }
        $sr.Close()
    } catch { }
    return $r
}

# ---------------------------------------------------------------- updater (child process, like the sync)
$script:UpdProc = $null
$script:UpdAction = ''
$script:LastUpdJson = ''
$script:UpdateAvailable = $null
function Start-Updater {
    param([string]$Action)
    if ($script:Halted) { return $false }
    if ($script:UpdProc -and -not $script:UpdProc.HasExited) { return $false }
    $cur = if ($env:NBADASH_FAKE_VERSION) { $env:NBADASH_FAKE_VERSION } else { $script:Version }    # test hook: pretend to be older
    Remove-Item $script:UpdResult -Force -ErrorAction SilentlyContinue
    $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $script:Root 'Update-NBADash.ps1')),
                  '-Action', $Action, '-CurrentVersion', $cur, '-WorkDir', ('"{0}"' -f $script:UpdDir))
    if ($env:NBADASH_UPDATE_API) { $argsList += '-ApiBase'; $argsList += $env:NBADASH_UPDATE_API }   # test hook
    $script:UpdAction = $Action
    $script:UpdProc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput $script:UpdOut
    $script:LastUpdJson = ''
    Push-NbaEvent $script:Shared 'update' @{ running = $true; action = $Action; pct = 0; text = 'Starting...' }
    return $true
}
function Read-UpdateJson {
    param([string]$Name)
    $p = Join-Path $script:UpdDir $Name
    if (Test-Path $p) { try { return (Get-Content $p -Raw | ConvertFrom-Json) } catch { } }
    return $null
}

# ---------------------------------------------------------------- nightly sync (Windows scheduled task, opt-in)
$script:NightlyTaskName = 'NBADash Nightly Sync'
function Get-NightlyTask {
    $r = @{ exists = $false; time = ''; state = '' }
    try {
        $t = Get-ScheduledTask -TaskName $script:NightlyTaskName -ErrorAction Stop
        $r.exists = $true; $r.state = [string]$t.State
        $trg = @($t.Triggers)[0]
        if ($trg -and $trg.StartBoundary) { $r.time = ([datetime]$trg.StartBoundary).ToString('HH:mm') }
    } catch { }
    return $r
}
# Creates, changes or removes the task by running the same Register-NBASyncTask.ps1 the README documents (current user, no admin rights).
function Set-NightlyTask {
    param([string]$Time, [bool]$Remove)
    $reg = Join-Path $script:Root 'Register-NBASyncTask.ps1'
    $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $reg), '-ScriptPath', ('"{0}"' -f (Join-Path $script:Root 'Sync-NBACache.ps1')))
    if ($Remove) { $argsList += '-Unregister' } else { $argsList += '-Time'; $argsList += $Time }
    $outFile = Join-Path ([IO.Path]::GetTempPath()) 'nbadash-schedule.out'
    $msg = ''
    try {
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput $outFile
        if (-not $p.WaitForExit(30000)) { try { $p.Kill() } catch { } }
        if (Test-Path $outFile) { $msg = (@(Get-Content $outFile) | Where-Object { $_ } | Select-Object -First 2) -join ' ' }
    } catch { $msg = $_.Exception.Message }
    $st = Get-NightlyTask
    $ok = if ($Remove) { -not $st.exists } else { $st.exists -and $st.time -eq $Time }
    return @{ ok = $ok; exists = $st.exists; time = $st.time; message = $msg }
}

function Resolve-CachePath {
    param([string]$Rel)
    if (-not $Rel -or $Rel -match '\.\.' -or $Rel -match '^[\\/]' -or $Rel -match ':') { return $null }
    $rel2 = $Rel -replace '/', '\'
    if ($script:Allowed -contains $rel2 -or $rel2 -match '^(scoreboards\\\d{8}|boxscores\\\d+|teams\\[A-Z]{2,4})\.json$') { return (Join-Path $script:CacheDir $rel2) }
    return $null
}

# ================================================================ contract functions

function Initialize-Dash {
    <# Loads settings, creates folders and takes the host lock. Starts no fetching. #>
    param(
        [Parameter(Mandatory)]$Context,
        [string]$CacheDir = (Join-Path $env:LOCALAPPDATA 'NBADash\cache'),
        [string]$SettingsPath = (Join-Path $env:APPDATA 'NBADash\settings.json')
    )
    if ($script:Ctx) { return @{ Ok = $true; Reason = ''; CacheDir = $script:CacheDir; WebViewDataDir = $script:WebViewDataDir } }
    # one host at a time: the dash's own window or the launcher, never both writing the same cache and settings
    $created = $false
    try { $m = New-Object System.Threading.Mutex($true, 'Local\DashHost-nbadash', [ref]$created) } catch { $m = $null }
    if (-not $m -or -not $created) {
        if ($m) { $m.Dispose() }
        return @{ Ok = $false; Reason = 'locked'; CacheDir = ''; WebViewDataDir = '' }
    }
    $script:Mutex = $m
    $script:Ctx = $Context
    if ($Context.Root) { $script:Root = [string]$Context.Root }
    $script:CacheDir = $CacheDir
    $script:SettingsPath = $SettingsPath
    $script:WebViewDataDir = Join-Path $env:LOCALAPPDATA 'NBADash\webview2'
    $script:Version = '0.0.0'
    try { $script:Version = ([IO.File]::ReadAllText((Join-Path $script:Root 'VERSION'))).Trim() } catch { }

    foreach ($sub in '', 'logos', 'teams', 'scoreboards', 'boxscores', 'logs') {
        $p = Join-Path $CacheDir $sub
        if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
    }
    $settingsDir = Split-Path $SettingsPath
    if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null }

    $script:Settings = [pscustomobject]@{ favorites = @(); theme = 'system'; liveSeconds = 30; autoWatch = $true; updateCheck = $true; autoHistory = $true; autoRefresh = $false; ratingMethod = 'native'; showForm = $true }
    foreach ($k in $script:TuneDefaults.Keys) { $script:Settings | Add-Member -NotePropertyName $k -NotePropertyValue $script:TuneDefaults[$k][0] }
    if (Test-Path $SettingsPath) {
        try {
            $loaded = Get-Content $SettingsPath -Raw | ConvertFrom-Json
            foreach ($k in (@('favorites', 'theme', 'liveSeconds', 'autoWatch', 'updateCheck', 'autoHistory', 'autoRefresh', 'ratingMethod', 'showForm') + @($script:TuneDefaults.Keys))) { if ($null -ne $loaded.$k) { $script:Settings.$k = $loaded.$k } }
        } catch { }
    }

    Import-Module (Join-Path $script:Root 'modules\Nba.Data.psm1') -Force
    $script:Shared = New-NbaShared -CacheDir $CacheDir -LiveSeconds ([int]$script:Settings.liveSeconds)
    Set-Tune
    $script:SyncOut = Join-Path $CacheDir 'logs\sync-live.out'

    $script:UpdDir = Join-Path $env:LOCALAPPDATA 'NBADash\update'
    if (-not (Test-Path $script:UpdDir)) { New-Item -ItemType Directory -Path $script:UpdDir -Force | Out-Null }
    $script:UpdOut = Join-Path $script:UpdDir 'update.out'
    $script:UpdResult = Join-Path $script:UpdDir 'update-result.json'
    # After an update: the helper left a "pending" note. Report the result once, and tell the helper this start worked.
    $script:UpdateNote = $null
    $pend = Read-UpdateJson 'update-pending.json'
    if ($pend -and [string]$pend.to -eq $script:Version) { $script:UpdateNote = @{ ok = $true; from = [string]$pend.from; to = [string]$pend.to } }
    $failed = Read-UpdateJson 'update-failed.json'
    if ($failed) {
        $script:UpdateNote = @{ ok = $false; from = [string]$failed.from; to = [string]$failed.to; reason = [string]$failed.reason }
        Remove-Item (Join-Path $script:UpdDir 'update-failed.json') -Force -ErrorAction SilentlyContinue
        Remove-Item (Join-Path $script:UpdDir 'update-pending.json') -Force -ErrorAction SilentlyContinue
    }
    return @{ Ok = $true; Reason = ''; CacheDir = $CacheDir; WebViewDataDir = $script:WebViewDataDir }
}

function Start-DashWorker {
    <# The tab is visible: start the worker, or resume it, unless the kill switch stopped it. #>
    if (-not $script:Shared -or $script:Halted) { return }
    $script:Shared.Paused = $false
    if ($script:WorkerPs) { return }
    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = 'MTA'
    $rs.Open()
    $rs.SessionStateProxy.SetVariable('NbaShared', $script:Shared)
    $script:WorkerPs = [powershell]::Create()
    $script:WorkerPs.Runspace = $rs
    [void]$script:WorkerPs.AddScript("Import-Module '$((Join-Path $script:Root 'modules\Nba.Data.psm1') -replace "'", "''")' -Force; Invoke-NbaWorker -Shared `$NbaShared")
    $script:WorkerHandle = $script:WorkerPs.BeginInvoke()
}

function Suspend-DashWorker {
    <# The tab is hidden: no timed fetching. Requests already queued still finish, and a running sync keeps going. #>
    if ($script:Shared) { $script:Shared.Paused = $true }
}

function Invoke-DashCommand {
    <# One page request {id, cmd, args}; answers through Context.Post. #>
    param([Parameter(Mandatory)]$Message)
    $Msg = $Message
    try { Invoke-PageCommand $Msg } catch { if ($null -ne $Msg.id) { ReplyError $Msg.id $_.Exception.Message } }
}

function Invoke-PageCommand {
    param($Msg)
    $a = $Msg.args
    $CacheDir = $script:CacheDir
    $utf8 = $script:Utf8
    # after the kill switch nothing reaches ESPN or GitHub until the person resumes inside the dash
    $fetching = @('watch.set', 'live.refresh', 'sync.run', 'player.search', 'update.check', 'update.stage', 'update.apply')
    if ($script:Halted -and $fetching -contains $Msg.cmd) { ReplyError $Msg.id 'Traffic is stopped. Press Resume to allow fetching again.'; return }
    switch ($Msg.cmd) {
        'init' {
            $st = Get-SyncState
            $obj = @{
                settings = $script:Settings; cacheDir = $CacheDir; version = $script:Version; sample = $false; updateNote = $script:UpdateNote
                sync = @{ running = [bool]($script:SyncProc -and -not $script:SyncProc.HasExited); lastRun = $(if ($st) { $st.lastRun } else { $null }); lastCompleteDate = $(if ($st) { $st.lastCompleteDate } else { $null }) }
                host = @{ mode = [string]$script:Ctx.Mode; theme = [string]$script:Ctx.Theme; launcherVersion = [string]$script:Ctx.LauncherVersion }
                halted = $script:Halted
            }
            Reply $Msg.id (ConvertTo-Json -InputObject $obj -Depth 6 -Compress)
            if ($script:UpdateNote -and $script:UpdateNote.ok) {     # page loaded: confirm the update to the helper
                try { [IO.File]::WriteAllText((Join-Path $script:UpdDir 'update-ok.json'), '{"ok":true}', $utf8) } catch { }
                Remove-Item (Join-Path $script:UpdDir 'update-pending.json') -Force -ErrorAction SilentlyContinue
            }
            $script:UpdateNote = $null
        }
        'cache.read' {
            $p = Resolve-CachePath $a.path
            if ($p -and (Test-Path $p)) { Reply $Msg.id ([IO.File]::ReadAllText($p, $utf8)) } else { Reply $Msg.id 'null' }
        }
        'cache.list' {
            if ($a.dir -notin 'scoreboards', 'boxscores', 'teams') { Reply $Msg.id '[]'; return }
            $names = @(Get-ChildItem (Join-Path $CacheDir $a.dir) -Filter *.json -File -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
            Reply $Msg.id (ConvertTo-Json -InputObject $names -Compress)
        }
        'cache.write' {
            # the only file the page may write: its running league totals
            if ($a.path -ne 'league-stats.json' -or -not $a.text -or ([string]$a.text).Length -gt 8000000) { ReplyError $Msg.id 'write not allowed'; return }
            $p = Join-Path $CacheDir 'league-stats.json'
            [IO.File]::WriteAllText("$p.tmp", [string]$a.text, $utf8)
            Move-Item -Path "$p.tmp" -Destination $p -Force
            Reply $Msg.id 'true'
        }
        'settings.save' {
            $s = $a.settings
            $script:Settings = [pscustomobject]@{
                favorites = @($s.favorites); theme = [string]$s.theme
                liveSeconds = [Math]::Max(10, [int]$s.liveSeconds); autoWatch = [bool]$s.autoWatch
                updateCheck = $(if ($null -eq $s.updateCheck) { $true } else { [bool]$s.updateCheck })
                autoHistory = $(if ($null -eq $s.autoHistory) { $true } else { [bool]$s.autoHistory })
                autoRefresh = [bool]$s.autoRefresh
                ratingMethod = $(if (@('native', 'bref', 'nba') -contains [string]$s.ratingMethod) { [string]$s.ratingMethod } else { 'native' })
                showForm = $(if ($null -eq $s.showForm) { $true } else { [bool]$s.showForm })
            }
            foreach ($k in $script:TuneDefaults.Keys) {
                $d = $script:TuneDefaults[$k]; $v = $d[0]
                if ($null -ne $s.$k) { try { $v = [double]$s.$k } catch { } }
                $script:Settings | Add-Member -NotePropertyName $k -NotePropertyValue ([Math]::Min($d[2], [Math]::Max($d[1], $v)))
            }
            $script:Shared.LiveSeconds = $script:Settings.liveSeconds
            Set-Tune
            Save-Settings
            Reply $Msg.id 'true'
        }
        'watch.set' {
            $id = [string]$a.id
            if ($id -notmatch '^\d+$') { ReplyError $Msg.id 'bad id'; return }
            if ($a.on) { if ($script:Settings.autoRefresh) { $script:Shared.Watch[$id] = $true }; $script:Shared.Commands.Enqueue(@{ type = 'box'; id = $id }) }
            else { $script:Shared.Watch.Remove($id) }
            Reply $Msg.id 'true'
        }
        'box.get' {
            $id = [string]$a.id
            if ($id -notmatch '^\d+$') { ReplyError $Msg.id 'bad id'; return }
            $p = Join-Path $CacheDir "boxscores\$id.json"
            if (Test-Path $p) { Reply $Msg.id ([IO.File]::ReadAllText($p, $utf8)); return }
            if ($script:Halted) { Reply $Msg.id 'null'; return }
            $script:Shared.Commands.Enqueue(@{ type = 'box'; id = $id })
            Reply $Msg.id '{"pending":true}'
        }
        'sync.cancel' {
            try { if ($script:SyncProc -and -not $script:SyncProc.HasExited) { $script:SyncProc.Kill() } } catch { }
            Reply $Msg.id 'true'
        }
        'schedule.get' { Reply $Msg.id ((Get-NightlyTask) | ConvertTo-Json -Compress) }
        'schedule.set' {
            $t = [string]$a.time
            if ($t -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { ReplyError $Msg.id 'bad time'; return }
            Reply $Msg.id ((Set-NightlyTask -Time $t -Remove $false) | ConvertTo-Json -Compress)
        }
        'schedule.remove' { Reply $Msg.id ((Set-NightlyTask -Time '' -Remove $true) | ConvertTo-Json -Compress) }
        'live.refresh' { $script:Shared.RefreshNow = $true; Reply $Msg.id 'true' }
        'sync.run' {
            $mode = if ($a.mode -in 'favorites', 'all', 'force', 'team', 'history', 'historyBoxes') { $a.mode } else { 'favorites' }
            $team = [string]$a.team
            if ($mode -eq 'team' -and $team -notmatch '^[A-Za-z]{2,4}$') { ReplyError $Msg.id 'bad team'; return }
            Reply $Msg.id ((Start-Sync $mode $team).ToString().ToLower())
        }
        'player.get' {
            $id = [string]$a.id
            if ($id -notmatch '^\d{1,10}$') { ReplyError $Msg.id 'bad id'; return }
            $p = Join-Path $CacheDir "players\$id.json"
            $age = if (Test-Path $p) { ((Get-Date) - (Get-Item $p).LastWriteTime).TotalMinutes } else { 99999 }
            if ($age -lt 180 -or ($script:Halted -and (Test-Path $p))) { Reply $Msg.id ('{{"player":{0}}}' -f [IO.File]::ReadAllText($p, $utf8)); return }   # fresh enough
            if ($script:Halted) { ReplyError $Msg.id 'Traffic is stopped. Press Resume to allow fetching again.'; return }
            $script:Shared.Commands.Enqueue(@{ type = 'player'; id = $id })                                          # result arrives as a 'player' event
            if (Test-Path $p) { Reply $Msg.id ('{{"pending":true,"player":{0}}}' -f [IO.File]::ReadAllText($p, $utf8)) } else { Reply $Msg.id '{"pending":true}' }
        }
        'player.search' {
            $q = ([string]$a.q).Trim()
            if ($q.Length -lt 2 -or $q.Length -gt 60 -or $q -notmatch "^[\p{L}\p{N} .'\-]+$") { Reply $Msg.id 'false'; return }
            $script:Shared.Commands.Enqueue(@{ type = 'psearch'; q = $q })
            Reply $Msg.id 'true'
        }
        'update.check' { Reply $Msg.id ((Start-Updater 'Check').ToString().ToLower()) }
        'update.stage' { Reply $Msg.id ((Start-Updater 'Stage').ToString().ToLower()) }
        'update.cancel' {
            try { if ($script:UpdProc -and -not $script:UpdProc.HasExited) { $script:UpdProc.Kill() } } catch { }
            Reply $Msg.id 'true'
        }
        'update.apply' {
            $st = Read-UpdateJson 'staged.json'
            $stage = Join-Path $script:UpdDir 'stage'
            if (-not $st -or -not (Test-Path (Join-Path $stage 'Start-NBADash.ps1'))) { ReplyError $Msg.id 'There is no downloaded update to install. Download it again.'; return }
            # run the helper from a copy so replacing the app files cannot touch the running helper
            $runDir = Join-Path $script:UpdDir 'run'
            if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Path $runDir -Force | Out-Null }
            $helper = Join-Path $runDir 'Apply-Update.ps1'
            Copy-Item (Join-Path $script:Root 'Apply-Update.ps1') $helper -Force
            # Context.Relaunch is passed through exactly as given (it may include arguments, e.g. -Open nbadash)
            $relaunch = if ($script:Ctx.Relaunch) { [string]$script:Ctx.Relaunch } else { '"' + (Join-Path $script:Root 'Start-NBADash.bat') + '"' }
            $relaunchB64 = [Convert]::ToBase64String($utf8.GetBytes($relaunch))
            $hostPid = if ($script:Ctx.HostPid) { [int]$script:Ctx.HostPid } else { $PID }
            $h = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $helper), '-AppDir', ('"{0}"' -f $script:Root), '-StageDir', ('"{0}"' -f $stage),
                   '-WorkDir', ('"{0}"' -f $script:UpdDir), '-ParentPid', [string]$hostPid, '-RelaunchB64', $relaunchB64,
                   '-OldVersion', $script:Version, '-NewVersion', [string]$st.version)
            Start-Process -FilePath 'powershell.exe' -ArgumentList $h -WindowStyle Hidden | Out-Null
            Reply $Msg.id 'true'
            if ($script:Ctx.Close) { & $script:Ctx.Close }
        }
        'traffic.get' {
            $t = $script:Shared.Traffic
            $bk = @{}
            foreach ($k in @($t.ByKind.Keys)) { $bk[$k] = @{ requests = $t.ByKind[$k].requests; bytes = $t.ByKind[$k].bytes } }
            $obj = @{
                uptimeSec = ((Get-Date) - $t.Started).TotalSeconds; requests = $t.Requests; errors = $t.Errors
                bytes = $t.Bytes; wireBytes = $t.Wire; last = $t.Last; byKind = $bk
            }
            Reply $Msg.id (ConvertTo-Json -InputObject $obj -Depth 5 -Compress)
        }
        'traffic.resume' {
            # only the person resumes after the kill switch, from inside the dash
            $script:Halted = $false
            $script:Shared.Halted = $false
            Start-DashWorker
            Reply $Msg.id 'true'
            Send-Page '{"event":"traffic","data":{"stopped":false}}'
        }
        default { ReplyError $Msg.id "unknown command: $($Msg.cmd)" }
    }
}

function Receive-DashEvents {
    <# Every 250 ms: up to 25 {event, data} JSON strings for the page (worker output, sync and updater progress). #>
    $out = New-Object System.Collections.Generic.List[string]
    if (-not $script:Shared) { return @() }
    try {
        $line = $null
        while ($out.Count -lt 25 -and $script:Shared.Queue.TryDequeue([ref]$line)) { $out.Add($line) }
        if ($script:SyncProc) {
            if ($script:SyncProc.HasExited) {
                $st = Get-SyncState
                if ($st) {   # count the sync child's traffic in the secret counter
                    Add-NbaTraffic -Shared $script:Shared -Kind 'sync' -Wire ([long]$st.wireBytes) -Decoded ([long]$st.decodedBytes) -Ok $true
                    if ([int]$st.requests -gt 1) { $t = $script:Shared.Traffic; $t.Requests += ([int]$st.requests - 1); $t.ByKind['sync'].requests += ([int]$st.requests - 1) }
                }
                $code = $script:SyncProc.ExitCode
                $prog = Get-SyncProgress $script:SyncOut
                $script:SyncProc = $null
                $script:SyncPct = $null
                $out.Add(((@{ event = 'sync'; data = @{ running = $false; pct = 100; exitCode = $code; summary = $prog.summary; lastLine = $prog.line; lastRun = $(if ($st) { $st.lastRun } else { $null }); lastCompleteDate = $(if ($st) { $st.lastCompleteDate } else { $null }) } }) | ConvertTo-Json -Depth 4 -Compress))
            } else {
                $prog = Get-SyncProgress $script:SyncOut
                $script:SyncPct = $prog.pct
                $json = (@{ event = 'sync'; data = @{ running = $true; pct = $prog.pct; text = $prog.text; line = $prog.line } }) | ConvertTo-Json -Compress
                if ($json -ne $script:LastSyncJson) { $script:LastSyncJson = $json; $out.Add($json) }
            }
        }
        if ($script:UpdProc) {
            if ($script:UpdProc.HasExited) {
                $res = Read-UpdateJson 'update-result.json'
                if (-not $res) { $res = [pscustomobject]@{ status = 'error'; error = 'The update check ended without an answer.' } }
                $script:UpdProc = $null
                if ([string]$res.status -eq 'available' -or [string]$res.status -eq 'staged') { $script:UpdateAvailable = [string]$res.latest }
                elseif ([string]$res.status -eq 'current') { $script:UpdateAvailable = $null }
                $out.Add(((@{ event = 'update'; data = @{ running = $false; action = $script:UpdAction; result = $res } }) | ConvertTo-Json -Depth 6 -Compress))
            } else {
                $prog = Get-SyncProgress $script:UpdOut
                $json = (@{ event = 'update'; data = @{ running = $true; action = $script:UpdAction; pct = $prog.pct; text = $prog.text } }) | ConvertTo-Json -Compress
                if ($json -ne $script:LastUpdJson) { $script:LastUpdJson = $json; $out.Add($json) }
            }
        }
    } catch { }
    return $out.ToArray()      # unrolled: the caller gets one JSON string per item (wrap in @() for 0 or 1)
}

function Get-DashStatus {
    <# Every 2 seconds: no network, no disk scans. #>
    $t = if ($script:Shared) { $script:Shared.Traffic } else { $null }
    $syncing = [bool]($script:SyncProc -and -not $script:SyncProc.HasExited)
    $err = $null
    if ($script:WorkerHandle -and $script:WorkerHandle.IsCompleted -and $script:Shared -and -not $script:Shared.Stop) { $err = 'The background worker stopped.' }
    return @{
        Live            = $(if ($script:Shared) { [int]$script:Shared.LiveCount } else { 0 })     # as of the last scoreboard fetch
        Syncing         = $syncing
        SyncPct         = $(if ($syncing) { $script:SyncPct } else { $null })
        UpdateAvailable = $script:UpdateAvailable
        Error           = $err
        Traffic         = @{ Requests = $(if ($t) { [int]$t.Requests } else { 0 }); Bytes = $(if ($t) { [long]$t.Bytes } else { 0 }); Errors = $(if ($t) { [int]$t.Errors } else { 0 }) }
    }
}

function Stop-DashTraffic {
    <# Kill switch: cancel syncs, update downloads and queued requests, pause the worker. Saved settings are not changed. #>
    $script:Halted = $true
    try { if ($script:SyncProc -and -not $script:SyncProc.HasExited) { $script:SyncProc.Kill() } } catch { }
    try { if ($script:UpdProc -and -not $script:UpdProc.HasExited) { $script:UpdProc.Kill() } } catch { }
    if ($script:Shared) {
        $script:Shared.Halted = $true
        $script:Shared.Paused = $true
        $script:Shared.RefreshNow = $false
        $c = $null; while ($script:Shared.Commands.TryDequeue([ref]$c)) { }
    }
    Send-Page '{"event":"traffic","data":{"stopped":true}}'
}

function Stop-Dash {
    <# The host is closing: stop child processes and the worker, release the host lock, within 2 seconds. #>
    if ($script:Shared) { $script:Shared.Stop = $true }
    # never leave a hidden sync running behind us: it would hold the sync lock
    try { if ($script:SyncProc -and -not $script:SyncProc.HasExited) { $script:SyncProc.Kill() } } catch { }
    try { if ($script:UpdProc -and -not $script:UpdProc.HasExited) { $script:UpdProc.Kill() } } catch { }
    try { if ($script:WorkerPs) { $h = $script:WorkerPs.BeginStop($null, $null); [void]$h.AsyncWaitHandle.WaitOne(1500) } } catch { }
    try { if ($script:Mutex) { $script:Mutex.ReleaseMutex(); $script:Mutex.Dispose() } } catch { }
    $script:Mutex = $null
    $script:Ctx = $null
}

function Invoke-DashSync {
    <# Optional (master sync, switched off in the launcher for now): the existing favorites sync. #>
    param([ValidateSet('quick')][string]$Scope = 'quick')
    if (-not $script:Shared) { return $false }
    return (Start-Sync 'favorites')
}

Export-ModuleMember -Function Initialize-Dash, Start-DashWorker, Suspend-DashWorker, Invoke-DashCommand, Receive-DashEvents, Get-DashStatus, Stop-DashTraffic, Stop-Dash, Invoke-DashSync
