# 兼容包装：智慧水务后端（等价 scripts\service.ps1 -Project stp）
# 用法: .\stp-service.ps1 -Module admin [-Stop|-Restart|...]

[CmdletBinding()]
param(
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

$serviceScript = Join-Path $PSScriptRoot 'scripts\service.ps1'
if (-not (Test-Path $serviceScript)) {
    throw "找不到: $serviceScript"
}

$params = @{
    Project = 'stp'
    Force   = $Force
    BuildOnly = $BuildOnly
    SkipBuild = $SkipBuild
    KillPort  = $KillPort
    BootRun   = $BootRun
    SpringDebug = $SpringDebug
    Stop      = $Stop
    Restart   = $Restart
}
if ($Module) { $params.Module = $Module }
if ($ProjectRoot) { $params.ProjectRoot = $ProjectRoot }
if ($Profile) { $params.Profile = $Profile }
if ($LogFile) { $params.LogFile = $LogFile }

& $serviceScript @params
exit $LASTEXITCODE
