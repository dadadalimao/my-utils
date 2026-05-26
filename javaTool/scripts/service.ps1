# 通用 Java 服务 CLI
# 用法: .\scripts\service.ps1 -Project stp -Module admin [-Stop|-Restart|...]

[CmdletBinding()]
param(
    [string] $Project,
    [string] $Module,

    [switch] $Force,
    [switch] $BuildOnly,
    [switch] $SkipBuild,
    [switch] $KillPort,
    [switch] $BootRun,
    [switch] $SpringDebug,
    [switch] $Stop,
    [switch] $Restart,

    [string] $ProjectRoot,
    [string] $Profile,
    [string] $LogFile
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'core\JavaTool.Core.ps1')

function Write-Log {
    param([string] $Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message
    if ($LogFile) {
        $dir = Split-Path $LogFile -Parent
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $LogFile -Value $line -Encoding UTF8
    }
    else {
        Write-Host $Message
    }
}

if ($Stop -and $Restart) { throw '不能同时使用 -Stop 与 -Restart' }

if (-not $Project) {
    $all = Get-JavaToolProjects
    if ($all.Count -eq 0) { throw '未注册任何项目（请在 projects/ 下添加 .ps1）' }
    if ($all.Count -eq 1) {
        $Project = $all[0].Id
    }
    else {
        Write-Host '选择项目:'
        for ($i = 0; $i -lt $all.Count; $i++) {
            Write-Host "  [$($i + 1)] $($all[$i].Name) ($($all[$i].Id))"
        }
        Write-Host '  [0] 退出'
        $sel = Read-Host '项目编号'
        if ($sel -eq '0') { exit 0 }
        $idx = [int]$sel - 1
        if ($idx -lt 0 -or $idx -ge $all.Count) { throw '无效选择' }
        $Project = $all[$idx].Id
    }
}

$projDef = Get-JavaToolProject -ProjectId $Project
if (-not $projDef) { throw "未知项目: $Project" }

if (-not $ProjectRoot) {
    $settings = Get-JavaToolProjectSettings -ProjectId $Project
    $ProjectRoot = $settings.projectRoot
}

if (-not $Profile) {
    $settings = Get-JavaToolProjectSettings -ProjectId $Project
    $Profile = $settings.profile
}

if (-not $Module) {
    $modTable = $projDef.Modules
    $modIds = if ($modTable -is [hashtable]) { @($modTable.Keys) } else { @($modTable.PSObject.Properties.Name) }
    if ($Stop -or $Restart) {
        $Module = $modIds[0]
    }
    else {
        Write-Host "项目: $($projDef.Name) — 选择模块:"
        for ($i = 0; $i -lt $modIds.Count; $i++) {
            $m = Get-JavaToolModuleConfig -ProjectId $Project -ModuleId $modIds[$i]
            Write-Host "  [$($i + 1)] $($m.Label) ($($modIds[$i]))"
        }
        Write-Host '  [0] 退出'
        $sel = Read-Host '模块编号'
        if ($sel -eq '0') { exit 0 }
        $idx = [int]$sel - 1
        if ($idx -lt 0 -or $idx -ge $modIds.Count) { throw '无效选择' }
        $Module = $modIds[$idx]
    }
}

$modCfg = Get-JavaToolModuleConfig -ProjectId $Project -ModuleId $Module
if (-not $modCfg) { throw "未知模块: $Project / $Module" }

if ($Stop) {
    Close-JavaToolTerminalSession -ProjectId $Project -ModuleId $Module | Out-Null
    Stop-JavaToolModule -ProjectId $Project -ModuleId $Module -OnLog { param($m) Write-Log $m }
    exit 0
}

if ($Restart) {
    Close-JavaToolTerminalSession -ProjectId $Project -ModuleId $Module | Out-Null
    Stop-JavaToolModule -ProjectId $Project -ModuleId $Module -OnLog { param($m) Write-Log $m }
}

$port = Get-JavaToolEffectivePort -ProjectId $Project -ModuleId $Module
$conflict = Test-JavaToolPortConflict -ProjectId $Project -ModuleId $Module -Port $port
if ($conflict -and -not $Stop -and -not $BuildOnly) {
    throw $conflict
}

$procRef = [ref]$null
$useConsole = -not $LogFile

if ($useConsole -and $Module) {
    $Host.UI.RawUI.WindowTitle = Get-JavaToolTerminalWindowTitle -ProjectId $Project -ModuleId $Module
    $termKind = if ($env:WT_SESSION) { 'wt' } else { 'console' }
    Save-JavaToolSession -ProjectId $Project -ModuleId $Module -ShellPid $PID -Kind $termKind
}

try {
    $proc = Invoke-JavaToolStart -ProjectId $Project -ModuleId $Module -ProjectRoot $ProjectRoot -Profile $Profile `
        -Force:$Force -SkipBuild:$SkipBuild -BuildOnly:$BuildOnly `
        -KillPortBeforeStart:$KillPort -UseConsole:$useConsole -UseBootRun:$BootRun -SpringDebug:$SpringDebug `
        -OnLog { param($m) Write-Log $m } -RunningProcess $procRef

    if ($useConsole) {
        $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
        Wait-JavaToolConsoleBeforeClose -ExitCode $code
        return
    }

    if ($proc) {
        $cancelHandler = {
            param($sender, $e)
            $e.Cancel = $true
            if ($procRef.Value -and -not $procRef.Value.HasExited) {
                $procRef.Value.Kill($true)
            }
            if ($port) { Stop-JavaToolPort -Port $port -OnLog { param($m) Write-Host $m } | Out-Null }
            [Environment]::Exit(0)
        }
        [Console]::CancelKeyPress.Add($cancelHandler)
        $proc.WaitForExit()
        [Console]::CancelKeyPress.Remove($cancelHandler)
        exit $proc.ExitCode
    }
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ScriptStackTrace) {
        Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    }
    if ($useConsole) {
        Wait-JavaToolConsoleBeforeClose -ExitCode 1
    }
    else {
        exit 1
    }
}
