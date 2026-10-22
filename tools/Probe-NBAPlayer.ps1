<#
.SYNOPSIS
  Probe for the player search / player page feature (PowerShell 5.1).
.DESCRIPTION
  Calls the ESPN player endpoints we might use for bios and season stats, saves the raw JSON,
  and writes a short report of what each one contains. Read-only. About 8 requests.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Probe-NBAPlayer.ps1
  powershell -ExecutionPolicy Bypass -File .\Probe-NBAPlayer.ps1 -PlayerId 3112335 -Season 2027
  Output goes to .\probe-player-output\ (player-report.txt plus one .json per call).
#>
[CmdletBinding()]
param(
    [string[]]$PlayerId = @('3112335', '3945274'),   # two well-known players; add your own ESPN ids
    [int]$Season = 2027,
    [string]$OutDir = '',
    [int]$DelayMs = 400
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (-not $OutDir) {
    $base = $PSScriptRoot
    if (-not $base) { $base = (Get-Location).Path }
    $OutDir = Join-Path $base 'probe-player-output'
}
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NBADash-Probe/0.1'
$report = New-Object System.Text.StringBuilder
function Out-Line { param([string]$T = ''); Write-Host $T; [void]$report.AppendLine($T) }

function Get-Keys {
    # lists property names to a limited depth so the report shows the shape without dumping everything
    param($Obj, [string]$Prefix = '', [int]$Depth = 3)
    if ($null -eq $Obj -or $Depth -le 0) { return }
    if ($Obj -is [System.Collections.IEnumerable] -and $Obj -isnot [string]) {
        $first = $Obj | Select-Object -First 1
        if ($first -is [pscustomobject]) { Get-Keys $first ($Prefix + '[0]') $Depth }
        return
    }
    if ($Obj -isnot [pscustomobject]) { return }
    foreach ($p in $Obj.PSObject.Properties) {
        $v = $p.Value
        $short = ''
        if ($null -eq $v) { $short = 'null' }
        elseif ($v -is [string] -or $v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [bool]) { $short = ([string]$v); if ($short.Length -gt 60) { $short = $short.Substring(0, 60) + '...' } }
        elseif ($v -is [System.Collections.IEnumerable]) { $short = '[array of ' + @($v).Count + ']' }
        else { $short = '{object}' }
        Out-Line ('    {0}{1} = {2}' -f $Prefix, $p.Name, $short)
        Get-Keys $v ($Prefix + $p.Name + '.') ($Depth - 1)
    }
}

function Get-One {
    param([string]$Name, [string]$Url)
    Out-Line ''
    Out-Line ('=== ' + $Name)
    Out-Line ('    ' + $Url)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri $Url -UserAgent $UA -UseBasicParsing -TimeoutSec 30
        $sw.Stop()
        $file = Join-Path $OutDir ($Name + '.json')
        [IO.File]::WriteAllText($file, $r.Content, (New-Object Text.UTF8Encoding($false)))
        Out-Line ('    HTTP {0}, {1:N0} bytes, {2} ms' -f $r.StatusCode, $r.Content.Length, $sw.ElapsedMilliseconds)
        try { $j = $r.Content | ConvertFrom-Json; Get-Keys $j '' 3 } catch { Out-Line '    (not JSON)' }
    } catch {
        $sw.Stop()
        Out-Line ('    FAILED: ' + $_.Exception.Message)
    }
    Start-Sleep -Milliseconds $DelayMs
}

Out-Line ('NBADash player probe ' + (Get-Date).ToString('s') + '  season=' + $Season)
foreach ($id in $PlayerId) {
    Get-One "p$id-common-athlete"  "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/$id"
    Get-One "p$id-overview"        "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/$id/overview"
    Get-One "p$id-stats"           "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/$id/stats"
    Get-One "p$id-core-athlete"    "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/$id"
    Get-One "p$id-core-season-stats" "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/$Season/types/2/athletes/$id/statistics/0"
}
Get-One 'search-by-name' 'https://site.web.api.espn.com/apis/common/v3/search?query=jokic&limit=5&type=player&sport=basketball&league=nba'

$rf = Join-Path $OutDir 'player-report.txt'
[IO.File]::WriteAllText($rf, $report.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Host ''
Write-Host ('Report: ' + $rf)
Write-Host 'Please zip the probe-player-output folder and send it back.'
