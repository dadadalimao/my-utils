# 功能：智慧水务后端 CLI 编译启动
# 用法: .\stp-service.ps1 -Module admin [-Stop|-Restart|-Force|-SkipBuild]

[CmdletBinding()]
param(
    [ValidateSet('admin', 'prec-aer')]
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
. (Join-Path $PSScriptRoot 'StpService.Core.ps1')

if (-not $ProjectRoot) { $ProjectRoot = Get-StpSavedProjectRoot }

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

if (-not $Module) {
    if ($Stop -or $Restart) { $Module = 'admin' }
    else {
        Write-Host '[1] admin  [2] prec-aer  [0] 退出'
        switch (Read-Host '选择') {
            '1' { $Module = 'admin' }
            '2' { $Module = 'prec-aer' }
            '0' { exit 0 }
            default { throw '无效选择' }
        }
    }
}

if ($Stop) {
    Stop-StpModule -ModuleName $Module -OnLog { param($m) Write-Log $m }
    exit 0
}

if ($Restart) {
    Stop-StpModule -ModuleName $Module -OnLog { param($m) Write-Log $m }
}

$procRef = [ref]$null
$useConsole = -not $LogFile

try {
    $proc = Invoke-StpStart -ModuleName $Module -ProjectRoot $ProjectRoot -Profile $Profile `
        -Force:$Force -SkipBuild:$SkipBuild -BuildOnly:$BuildOnly `
        -KillPortBeforeStart:$KillPort -UseConsole:$useConsole -UseBootRun:$BootRun -SpringDebug:$SpringDebug `
        -OnLog { param($m) Write-Log $m } -RunningProcess $procRef

    # 终端模式：java 在前台执行，结束后用退出码结束脚本
    if ($useConsole) {
        $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
        exit $code
    }

    if ($proc) {
        $cancelHandler = {
            param($sender, $e)
            $e.Cancel = $true
            if ($procRef.Value -and -not $procRef.Value.HasExited) {
                $procRef.Value.Kill($true)
            }
            $cfg = $script:StpModuleConfig[$Module]
            if ($cfg.Port) { Stop-StpPort -Port $cfg.Port -OnLog { param($m) Write-Host $m } | Out-Null }
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
    exit 1
}
