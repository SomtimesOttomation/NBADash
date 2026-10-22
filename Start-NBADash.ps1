<#
.SYNOPSIS
    NBA 2026-27 dashboard: a WebView2 window that shows live scores, box scores, team profiles and standings.
.DESCRIPTION
    Windows PowerShell 5.1. Needs the WebView2 runtime (Evergreen, installed with Edge) and the three DLLs in .\lib
    (run Setup-WebView2.ps1 once). Reads the cache written by Sync-NBACache.ps1 and polls ESPN live while open.
#>
param(
    [string]$CacheDir     = (Join-Path $env:LOCALAPPDATA 'NBADash\cache'),
    [string]$SettingsPath = (Join-Path $env:APPDATA 'NBADash\settings.json'),
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Version = '0.0.0'
try { $Version = ([IO.File]::ReadAllText((Join-Path $Root 'VERSION'))).Trim() } catch { }

# WinForms + WebView2 need a single-threaded apartment. Windows PowerShell 5.1 consoles are STA already.
if ([Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $PSCommandPath -CacheDir $CacheDir -SettingsPath $SettingsPath
    exit $LASTEXITCODE
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

# ---------------------------------------------------------------- WebView2 assemblies
$lib = Join-Path $Root 'lib'
$need = 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll'
$missing = @($need | Where-Object { -not (Test-Path (Join-Path $lib $_)) })
if ($missing.Count) {
    [Windows.Forms.MessageBox]::Show("Missing WebView2 files in $lib :`n`n$($missing -join "`n")`n`nRun Setup-WebView2.ps1 once.", 'NBA Dash', 'OK', 'Warning') | Out-Null
    exit 1
}
Add-Type -Namespace NbaDash -Name Native -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetDllDirectory(string path);'
[NbaDash.Native]::SetDllDirectory($lib) | Out-Null         # lets .NET find WebView2Loader.dll
Add-Type -Path (Join-Path $lib 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll')

# ---------------------------------------------------------------- folders, settings
foreach ($sub in '', 'logos', 'teams', 'scoreboards', 'boxscores', 'logs') {
    $p = Join-Path $CacheDir $sub
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}
$settingsDir = Split-Path $SettingsPath
if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null }
$utf8 = New-Object System.Text.UTF8Encoding($false)

$script:Settings = [pscustomobject]@{ favorites = @(); theme = 'system'; liveSeconds = 30; autoWatch = $true; updateCheck = $true }
if (Test-Path $SettingsPath) {
    try {
        $loaded = Get-Content $SettingsPath -Raw | ConvertFrom-Json
        foreach ($k in 'favorites', 'theme', 'liveSeconds', 'autoWatch', 'updateCheck') { if ($null -ne $loaded.$k) { $script:Settings.$k = $loaded.$k } }
    } catch { }
}

# ---------------------------------------------------------------- worker
Import-Module (Join-Path $Root 'modules\Nba.Data.psm1') -Force
$script:Shared = New-NbaShared -CacheDir $CacheDir -LiveSeconds ([int]$script:Settings.liveSeconds)
$rs = [runspacefactory]::CreateRunspace()
$rs.ApartmentState = 'MTA'
$rs.Open()
$rs.SessionStateProxy.SetVariable('NbaShared', $script:Shared)
$script:WorkerPs = [powershell]::Create()
$script:WorkerPs.Runspace = $rs
[void]$script:WorkerPs.AddScript("Import-Module '$($Root -replace "'", "''")\modules\Nba.Data.psm1' -Force; Invoke-NbaWorker -Shared `$NbaShared")
$script:WorkerHandle = $script:WorkerPs.BeginInvoke()

# ---------------------------------------------------------------- sync child process
$script:SyncProc = $null
$script:SyncOut = Join-Path $CacheDir 'logs\sync-live.out'
function Start-Sync {
    param([string]$Mode, [string]$Team = '')
    if ($script:SyncProc -and -not $script:SyncProc.HasExited) { return $false }
    $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $Root 'Sync-NBACache.ps1')),
                  '-CacheDir', ('"{0}"' -f $CacheDir), '-SettingsPath', ('"{0}"' -f $SettingsPath))
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
    return $true
}

function Get-SyncState {
    $p = Join-Path $CacheDir 'sync-state.json'
    if (Test-Path $p) { try { return Get-Content $p -Raw | ConvertFrom-Json } catch { } }
    return $null
}

function Get-SyncProgress {
    # Reads the child's console output: last ##PROGRESS marker, last normal line, and the final "=== Done" summary.
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
$script:UpdDir = Join-Path $env:LOCALAPPDATA 'NBADash\update'
if (-not (Test-Path $script:UpdDir)) { New-Item -ItemType Directory -Path $script:UpdDir -Force | Out-Null }
$script:UpdProc = $null
$script:UpdAction = ''
$script:UpdOut = Join-Path $script:UpdDir 'update.out'
$script:UpdResult = Join-Path $script:UpdDir 'update-result.json'
$script:LastUpdJson = ''
function Start-Updater {
    param([string]$Action)
    if ($script:UpdProc -and -not $script:UpdProc.HasExited) { return $false }
    $cur = if ($env:NBADASH_FAKE_VERSION) { $env:NBADASH_FAKE_VERSION } else { $Version }    # test hook: pretend to be older
    Remove-Item $script:UpdResult -Force -ErrorAction SilentlyContinue
    $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $Root 'Update-NBADash.ps1')),
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
# After an update: the helper left a "pending" note. Report the result once, and tell the helper this start worked.
$script:UpdateNote = $null
$pend = Read-UpdateJson 'update-pending.json'
if ($pend -and [string]$pend.to -eq $Version) { $script:UpdateNote = @{ ok = $true; from = [string]$pend.from; to = [string]$pend.to } }
$failed = Read-UpdateJson 'update-failed.json'
if ($failed) {
    $script:UpdateNote = @{ ok = $false; from = [string]$failed.from; to = [string]$failed.to; reason = [string]$failed.reason }
    Remove-Item (Join-Path $script:UpdDir 'update-failed.json') -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $script:UpdDir 'update-pending.json') -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- window
$form = New-Object Windows.Forms.Form
$form.Text = 'NBA 2026-27'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object Drawing.Size(1920, 1080)
$form.MinimumSize = New-Object Drawing.Size(900, 600)

$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$props = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$props.UserDataFolder = Join-Path $env:LOCALAPPDATA 'NBADash\webview2'
$webView.CreationProperties = $props
$webView.Dock = 'Fill'
$form.Controls.Add($webView)

# ---------------------------------------------------------------- bridge
$script:Allowed = @('teams.json', 'standings.json', 'injuries.json', 'sync-state.json', 'league-stats.json')
function Resolve-CachePath {
    param([string]$Rel)
    if (-not $Rel -or $Rel -match '\.\.' -or $Rel -match '^[\\/]' -or $Rel -match ':') { return $null }
    $rel2 = $Rel -replace '/', '\'
    if ($script:Allowed -contains $rel2 -or $rel2 -match '^(scoreboards\\\d{8}|boxscores\\\d+|teams\\[A-Z]{2,4})\.json$') { return (Join-Path $CacheDir $rel2) }
    return $null
}

function Send-Page {
    param([string]$Json)
    try { $webView.CoreWebView2.PostWebMessageAsJson($Json) } catch { }
}

function Reply {
    param($Id, [string]$DataJson = 'null')
    Send-Page ('{{"id":{0},"ok":true,"data":{1}}}' -f $Id, $DataJson)
}
function ReplyError {
    param($Id, [string]$Message)
    Send-Page ('{{"id":{0},"ok":false,"error":{1}}}' -f $Id, (ConvertTo-Json -InputObject $Message -Compress))
}

function Save-Settings {
    [IO.File]::WriteAllText($SettingsPath, ($script:Settings | ConvertTo-Json -Depth 5), $utf8)
}

function Invoke-Command2 {
    param($Msg)
    $a = $Msg.args
    switch ($Msg.cmd) {
        'init' {
            $st = Get-SyncState
            $obj = @{
                settings = $script:Settings; cacheDir = $CacheDir; version = $Version; sample = $false; updateNote = $script:UpdateNote
                sync = @{ running = [bool]($script:SyncProc -and -not $script:SyncProc.HasExited); lastRun = $(if ($st) { $st.lastRun } else { $null }); lastCompleteDate = $(if ($st) { $st.lastCompleteDate } else { $null }) }
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
            }
            $script:Shared.LiveSeconds = $script:Settings.liveSeconds
            Save-Settings
            Reply $Msg.id 'true'
        }
        'watch.set' {
            $id = [string]$a.id
            if ($id -notmatch '^\d+$') { ReplyError $Msg.id 'bad id'; return }
            if ($a.on) { $script:Shared.Watch[$id] = $true; $script:Shared.Commands.Enqueue(@{ type = 'box'; id = $id }) }
            else { $script:Shared.Watch.Remove($id) }
            Reply $Msg.id 'true'
        }
        'box.get' {
            $id = [string]$a.id
            if ($id -notmatch '^\d+$') { ReplyError $Msg.id 'bad id'; return }
            $p = Join-Path $CacheDir "boxscores\$id.json"
            if (Test-Path $p) { Reply $Msg.id ([IO.File]::ReadAllText($p, $utf8)); return }
            $script:Shared.Commands.Enqueue(@{ type = 'box'; id = $id })
            Reply $Msg.id '{"pending":true}'
        }
        'sync.cancel' {
            try { if ($script:SyncProc -and -not $script:SyncProc.HasExited) { $script:SyncProc.Kill() } } catch { }
            Reply $Msg.id 'true'
        }
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
            if ($age -lt 180) { Reply $Msg.id ('{{"player":{0}}}' -f [IO.File]::ReadAllText($p, $utf8)); return }   # fresh enough
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
            Copy-Item (Join-Path $Root 'Apply-Update.ps1') $helper -Force
            $h = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $helper), '-AppDir', ('"{0}"' -f $Root), '-StageDir', ('"{0}"' -f $stage),
                   '-WorkDir', ('"{0}"' -f $script:UpdDir), '-ParentPid', [string]$PID, '-OldVersion', $Version, '-NewVersion', [string]$st.version)
            Start-Process -FilePath 'powershell.exe' -ArgumentList $h -WindowStyle Hidden | Out-Null
            Reply $Msg.id 'true'
            $form.Close()
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
        default { ReplyError $Msg.id "unknown command: $($Msg.cmd)" }
    }
}

$webView.add_CoreWebView2InitializationCompleted({
    param($sender, $e)
    if (-not $e.IsSuccess) {
        [Windows.Forms.MessageBox]::Show("WebView2 failed to start:`n$($e.InitializationException.Message)`n`nInstall the Evergreen WebView2 Runtime from Microsoft.", 'NBA Dash', 'OK', 'Error') | Out-Null
        $form.Close(); return
    }
    $core = $webView.CoreWebView2
    $core.SetVirtualHostNameToFolderMapping('nbadash.ui', (Join-Path $Root 'ui'), [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow)
    $core.SetVirtualHostNameToFolderMapping('nbadash.cache', $CacheDir, [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow)
    $core.Settings.AreDefaultContextMenusEnabled = [bool]$Debug
    $core.Settings.AreDevToolsEnabled = [bool]$Debug
    $core.Settings.IsStatusBarEnabled = $false
    $core.add_WebMessageReceived({
        param($s, $a)
        $msg = $null
        try {
            $msg = $a.WebMessageAsJson | ConvertFrom-Json
            Invoke-Command2 $msg
        } catch {
            if ($msg -and $null -ne $msg.id) { ReplyError $msg.id $_.Exception.Message }
        }
    })
    $core.add_NewWindowRequested({ param($s, $a) $a.Handled = $true })          # no pop-ups
    $core.add_NavigationStarting({
        param($s, $a)
        if ($a.Uri -notmatch '^https://nbadash\.(ui|cache)/') { $a.Cancel = $true }
    })
    $core.Navigate('https://nbadash.ui/index.html')
})

# Drain worker events onto the page, and watch the sync process.
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 250
$script:LastSyncJson = ''
$timer.add_Tick({
  try {
    $line = $null
    $n = 0
    while ($n -lt 25 -and $script:Shared.Queue.TryDequeue([ref]$line)) { Send-Page $line; $n++ }
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
            Send-Page ((@{ event = 'sync'; data = @{ running = $false; pct = 100; exitCode = $code; summary = $prog.summary; lastLine = $prog.line; lastRun = $(if ($st) { $st.lastRun } else { $null }); lastCompleteDate = $(if ($st) { $st.lastCompleteDate } else { $null }) } }) | ConvertTo-Json -Depth 4 -Compress)
        } else {
            $prog = Get-SyncProgress $script:SyncOut
            $json = (@{ event = 'sync'; data = @{ running = $true; pct = $prog.pct; text = $prog.text; line = $prog.line } }) | ConvertTo-Json -Compress
            if ($json -ne $script:LastSyncJson) { $script:LastSyncJson = $json; Send-Page $json }
        }
    }
    if ($script:UpdProc) {
        if ($script:UpdProc.HasExited) {
            $res = Read-UpdateJson 'update-result.json'
            if (-not $res) { $res = [pscustomobject]@{ status = 'error'; error = 'The update check ended without an answer.' } }
            $script:UpdProc = $null
            Send-Page ((@{ event = 'update'; data = @{ running = $false; action = $script:UpdAction; result = $res } }) | ConvertTo-Json -Depth 6 -Compress)
        } else {
            $prog = Get-SyncProgress $script:UpdOut
            $json = (@{ event = 'update'; data = @{ running = $true; action = $script:UpdAction; pct = $prog.pct; text = $prog.text } }) | ConvertTo-Json -Compress
            if ($json -ne $script:LastUpdJson) { $script:LastUpdJson = $json; Send-Page $json }
        }
    }
  } catch { }
})
$timer.Start()

$form.add_FormClosing({
    $timer.Stop()
    $script:Shared.Stop = $true
    # never leave a hidden sync running behind us: it would hold the sync lock
    try { if ($script:SyncProc -and -not $script:SyncProc.HasExited) { $script:SyncProc.Kill() } } catch { }
    try { if ($script:UpdProc -and -not $script:UpdProc.HasExited) { $script:UpdProc.Kill() } } catch { }
    try { $h = $script:WorkerPs.BeginStop($null, $null); [void]$h.AsyncWaitHandle.WaitOne(2000) } catch { }
})

$form.add_Shown({ [void]$webView.EnsureCoreWebView2Async($null) })
[Windows.Forms.Application]::Run($form)
