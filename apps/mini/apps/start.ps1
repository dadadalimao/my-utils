# Mini 交互启动：后端 + 可选客户端（H5 / 微信小程序），各开 Windows Terminal 窗口
# 用法：在 apps/mini/apps 下执行 .\start.ps1，或双击 start.bat；也可由仓库根 start.ps1 调用

$ErrorActionPreference = 'Stop'
$AppsRoot = $PSScriptRoot
$ServerDir = Join-Path $AppsRoot 'server'
$ClientDir = Join-Path $AppsRoot 'client'

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
  校验 server / client 目录存在。
#>
function Assert-AppDirs {
    if (-not (Test-Path (Join-Path $ServerDir 'package.json'))) {
        Write-Host "找不到后端目录: $ServerDir" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path (Join-Path $ClientDir 'package.json'))) {
        Write-Host "找不到前端目录: $ClientDir" -ForegroundColor Red
        exit 1
    }
}

<#
.SYNOPSIS
  在新的 wt 窗口中于指定目录执行 cmd 命令。
#>
function Start-WtCmd {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkDir,
        [Parameter(Mandatory = $true)][string]$CmdLine
    )
    wt -w new --title $Title -d $WorkDir cmd /k $CmdLine
}

<#
.SYNOPSIS
  启动 NestJS 后端（独立 wt 窗口）。
#>
function Start-MiniServer {
    Start-WtCmd -Title 'novel-ai-server' -WorkDir $ServerDir -CmdLine 'npm run start:dev'
    Write-Host '已打开: novel-ai-server -> npm run start:dev' -ForegroundColor Green
}

<#
.SYNOPSIS
  启动 H5 客户端（uni，独立 wt 窗口）。
#>
function Start-ClientH5 {
    Start-WtCmd -Title 'novel-ai-h5' -WorkDir $ClientDir -CmdLine 'npm run dev:h5'
    Write-Host '已打开: novel-ai-h5 -> npm run dev:h5' -ForegroundColor Green
    Write-Host '浏览器访问终端里提示的本地地址（一般为 http://localhost:5173）' -ForegroundColor DarkGray
}

<#
.SYNOPSIS
  启动微信小程序客户端（独立 wt 窗口）。
#>
function Start-ClientMpWeixin {
    Start-WtCmd -Title 'novel-ai-mp-weixin' -WorkDir $ClientDir -CmdLine 'npm run dev:mp-weixin'
    Write-Host '已打开: novel-ai-mp-weixin -> npm run dev:mp-weixin' -ForegroundColor Green
    Write-Host '请用微信开发者工具导入 client/dist/dev/mp-weixin' -ForegroundColor DarkGray
}

function Show-ClientMenu {
    Write-Host ''
    Write-Host '========== Mini 启动 ==========' -ForegroundColor Cyan
    Write-Host '  将启动后端，并选择客户端：'
    Write-Host '  1) H5 / Web          npm run dev:h5'
    Write-Host '  2) 微信小程序        npm run dev:mp-weixin'
    Write-Host '  3) 仅后端            不启动客户端'
    Write-Host '  0) 取消'
    Write-Host '==============================='
}

Assert-WindowsTerminal
Assert-AppDirs

Show-ClientMenu
$choice = Read-Host '请选择'

switch ($choice) {
    '1' {
        Start-MiniServer
        Start-Sleep -Milliseconds 400
        Start-ClientH5
    }
    '2' {
        Start-MiniServer
        Start-Sleep -Milliseconds 400
        Start-ClientMpWeixin
    }
    '3' {
        Start-MiniServer
    }
    '0' {
        Write-Host '已取消' -ForegroundColor Yellow
        exit 0
    }
    default {
        Write-Host '无效选项' -ForegroundColor Yellow
        exit 1
    }
}