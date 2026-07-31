# 仓库总启动菜单：用 Windows Terminal（wt）按需启动各能力域服务
# 用法：在仓库根目录执行 .\start.ps1，或双击 start.bat

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

<#
.SYNOPSIS
  确认本机已安装 Windows Terminal（wt）。
#>
function Assert-WindowsTerminal {
    if (-not (Get-Command wt -ErrorAction SilentlyContinue)) {
        Write-Host '未找到 wt（Windows Terminal），请先安装 Windows Terminal。' -ForegroundColor Red
        exit 1
    }
}

<#
.SYNOPSIS
  在新的 wt 窗口中于指定目录执行 cmd 命令（窗口保持打开）。
.PARAMETER Title
  窗口标题
.PARAMETER WorkDir
  工作目录
.PARAMETER CmdLine
  传给 cmd /k 的命令行
#>
function Start-WtCmd {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][string]$CmdLine
    )
    if (-not (Test-Path $WorkDir)) {
        Write-Host "目录不存在: $WorkDir" -ForegroundColor Red
        return
    }
    wt -w new --title $Title -d $WorkDir cmd /k $CmdLine
}

<#
.SYNOPSIS
  启动 tools/node（Express，默认 http://localhost:3920）
#>
function Start-NodeTools {
    $dir = Join-Path $Root 'tools\node'
    $pkg = Join-Path $dir 'package.json'
    if (-not (Test-Path $pkg)) {
        Write-Host "找不到 tools/node: $dir" -ForegroundColor Red
        return
    }
    Start-WtCmd -Title 'my-utils-node' -WorkDir $dir -CmdLine 'npm start'
    Write-Host '已打开: my-utils-node -> npm start (http://localhost:3920)' -ForegroundColor Green
}

<#
.SYNOPSIS
  启动 Mini：复用 apps/mini/apps/start.ps1（交互选择 H5 / 微信小程序 / 仅后端）
#>
function Start-MiniApp {
    $miniStart = Join-Path $Root 'apps\mini\apps\start.ps1'
    if (-not (Test-Path $miniStart)) {
        Write-Host "找不到 Mini 启动脚本: $miniStart" -ForegroundColor Red
        return
    }
    & $miniStart
}

<#
.SYNOPSIS
  用默认浏览器打开 Web 工具门户（纯静态，无需服务）
#>
function Open-WebTools {
    $index = Join-Path $Root 'tools\web\index.html'
    if (-not (Test-Path $index)) {
        Write-Host "找不到 Web 门户: $index" -ForegroundColor Red
        return
    }
    Start-Process $index
    Write-Host "已在浏览器打开: $index" -ForegroundColor Green
}

<#
.SYNOPSIS
  在 wt 中启动 JavaTool GUI
#>
function Start-JavaTool {
    $toolRoot = Join-Path $Root 'devtools\javaTool'
    $launch = Join-Path $toolRoot 'launch-gui.ps1'
    if (-not (Test-Path $launch)) {
        Write-Host "找不到 JavaTool: $launch" -ForegroundColor Red
        return
    }
    wt -w new --title 'javaTool' -d $toolRoot powershell -NoProfile -ExecutionPolicy Bypass -File $launch
    Write-Host '已打开: javaTool -> launch-gui.ps1' -ForegroundColor Green
}

<#
.SYNOPSIS
  依次启动 Node 工具 + Mini（各自独立 wt 窗口）
#>
function Start-AllServices {
    Start-NodeTools
    Start-Sleep -Milliseconds 400
    Start-MiniApp
}

function Show-Menu {
    Write-Host ''
    Write-Host '========== my-utils 启动菜单 ==========' -ForegroundColor Cyan
    Write-Host '  1) tools/node     Express 本地工具服务'
    Write-Host '  2) apps/mini      Nest + 可选 H5/微信小程序'
    Write-Host '  3) tools/web      浏览器打开 Web 工具门户'
    Write-Host '  4) javaTool       Java 项目启停 GUI'
    Write-Host '  5) 全部服务       node + mini'
    Write-Host '  0) 退出'
    Write-Host '======================================'
}

Assert-WindowsTerminal

while ($true) {
    Show-Menu
    $choice = Read-Host '请选择'
    switch ($choice) {
        '1' { Start-NodeTools }
        '2' { Start-MiniApp }
        '3' { Open-WebTools }
        '4' { Start-JavaTool }
        '5' { Start-AllServices }
        '0' { break }
        default { Write-Host '无效选项' -ForegroundColor Yellow }
    }
}