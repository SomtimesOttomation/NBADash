<#
.SYNOPSIS
    NBA 2026-27 dashboard: a WebView2 window that shows live scores, box scores, team profiles and standings.
.DESCRIPTION
    Windows PowerShell 5.1. Needs the WebView2 runtime (Evergreen, installed with Edge) and the three DLLs in .\lib
    (run Setup-WebView2.ps1 once). This script is only the window: everything else lives in modules\NBADash.Host.psm1,
    which follows DashLauncher's dash contract, so the same backend also runs as a tab inside DashLauncher.
#>
param(
    [string]$CacheDir     = (Join-Path $env:LOCALAPPDATA 'NBADash\cache'),
    [string]$SettingsPath = (Join-Path $env:APPDATA 'NBADash\settings.json'),
    [switch]$Debug
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

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

# ---------------------------------------------------------------- window
$form = New-Object Windows.Forms.Form
$form.Text = 'NBA 2026-27'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object Drawing.Size(1920, 1080)
$form.MinimumSize = New-Object Drawing.Size(900, 600)
$webView = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$webView.Dock = 'Fill'
$form.Controls.Add($webView)

# ---------------------------------------------------------------- backend (dash contract)
$wv = $webView; $fm = $form
$context = [pscustomobject]@{
    Mode            = 'standalone'
    Root            = $Root
    Post            = { param([string]$Json) try { $wv.CoreWebView2.PostWebMessageAsJson($Json) } catch { } }.GetNewClosure()
    Close           = { $fm.Close() }.GetNewClosure()
    Relaunch        = (Join-Path $Root 'Start-NBADash.bat')
    HostPid         = $PID
    Theme           = ''
    LauncherVersion = ''
    Debug           = [bool]$Debug
}
Import-Module (Join-Path $Root 'modules\NBADash.Host.psm1') -Force
$init = Initialize-Dash -Context $context -CacheDir $CacheDir -SettingsPath $SettingsPath
if (-not $init.Ok) {
    $why = if ($init.Reason -eq 'locked') { 'NBA Dash is already open, in its own window or in DashLauncher.' } else { "NBA Dash could not start: $($init.Reason)" }
    [Windows.Forms.MessageBox]::Show($why, 'NBA Dash', 'OK', 'Information') | Out-Null
    exit 1
}
$props = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
$props.UserDataFolder = $init.WebViewDataDir
$webView.CreationProperties = $props

$webView.add_CoreWebView2InitializationCompleted({
    param($sender, $e)
    if (-not $e.IsSuccess) {
        [Windows.Forms.MessageBox]::Show("WebView2 failed to start:`n$($e.InitializationException.Message)`n`nInstall the Evergreen WebView2 Runtime from Microsoft.", 'NBA Dash', 'OK', 'Error') | Out-Null
        $form.Close(); return
    }
    $core = $webView.CoreWebView2
    $core.SetVirtualHostNameToFolderMapping('nbadash.ui', (Join-Path $Root 'ui'), [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow)
    $core.SetVirtualHostNameToFolderMapping('nbadash.cache', $init.CacheDir, [Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind]::Allow)
    $core.Settings.AreDefaultContextMenusEnabled = [bool]$Debug
    $core.Settings.AreDevToolsEnabled = [bool]$Debug
    $core.Settings.IsStatusBarEnabled = $false
    $core.add_WebMessageReceived({
        param($s, $a)
        $msg = $null
        try { $msg = $a.WebMessageAsJson | ConvertFrom-Json } catch { return }
        Invoke-DashCommand -Message $msg
    })
    $core.add_NewWindowRequested({ param($s, $a) $a.Handled = $true })          # no pop-ups
    $core.add_NavigationStarting({
        param($s, $a)
        if ($a.Uri -notmatch '^https://nbadash\.(ui|cache)/') { $a.Cancel = $true }
    })
    $core.Navigate('https://nbadash.ui/index.html')
})

# Worker output, sync and updater progress onto the page.
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 250
$timer.add_Tick({
    try { foreach ($json in @(Receive-DashEvents)) { if ($json) { $webView.CoreWebView2.PostWebMessageAsJson($json) } } } catch { }
})

$form.add_Shown({
    Start-DashWorker
    $timer.Start()
    [void]$webView.EnsureCoreWebView2Async($null)
})
$form.add_FormClosing({
    $timer.Stop()
    Stop-Dash
})
[Windows.Forms.Application]::Run($form)
