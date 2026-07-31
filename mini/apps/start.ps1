# 一键启动：后端 + 微信小程序（各开一个 Windows Terminal 窗口）
# 用法：在 mini/apps 下执行 .\start.ps1  或双击 start.bat

$ErrorActionPreference = 'Stop'
$AppsRoot = $PSScriptRoot
$ServerDir = Join-Path $AppsRoot 'server'
$ClientDir = Join-Path $AppsRoot 'client'

if (-not (Get-Command wt -ErrorAction SilentlyContinue)) {
    Write-Host '未找到 wt（Windows Terminal），请先安装 Windows Terminal。' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $ServerDir 'package.json'))) {
    Write-Host "找不到后端目录: $ServerDir" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $ClientDir 'package.json'))) {
    Write-Host "找不到前端目录: $ClientDir" -ForegroundColor Red
    exit 1
}

# 后端：NestJS（独立窗口）
wt -w new --title 'novel-ai-server' -d $ServerDir cmd /k npm run start:dev

Start-Sleep -Milliseconds 400

# 微信小程序：uni-app（独立窗口）
wt -w new --title 'novel-ai-mp-weixin' -d $ClientDir cmd /k npm run dev:mp-weixin

Write-Host '已用 Windows Terminal 打开两个窗口：' -ForegroundColor Green
Write-Host '  1) novel-ai-server     → npm run start:dev'
Write-Host '  2) novel-ai-mp-weixin   → npm run dev:mp-weixin'
Write-Host '请用微信开发者工具导入 client/dist/dev/mp-weixin'
