# Git 拉取脚本
# 功能：拉取当前分支的最新代码

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Git 拉取脚本" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "当前工作目录: $PWD" -ForegroundColor Gray
Write-Host ""

try {
    # 获取当前分支
    Write-Host "正在获取当前分支..." -ForegroundColor Yellow
    $CURRENT_BRANCH = git rev-parse --abbrev-ref HEAD
    if (-not $CURRENT_BRANCH) {
        Write-Host "错误: 无法获取当前分支" -ForegroundColor Red
        exit 1
    }
    Write-Host "当前分支: $CURRENT_BRANCH" -ForegroundColor Green

    # 获取默认远程名称
    Write-Host "正在获取默认远程名称..." -ForegroundColor Yellow
    $REMOTE_NAME = (git remote | Select-Object -First 1).Trim()
    if (-not $REMOTE_NAME) {
        Write-Host "错误: 未找到远程仓库" -ForegroundColor Red
        exit 1
    }
    Write-Host "远程名称: $REMOTE_NAME" -ForegroundColor Green

    Write-Host ""
    Write-Host "正在拉取 $CURRENT_BRANCH 分支的最新代码..." -ForegroundColor Cyan
    git pull $REMOTE_NAME $CURRENT_BRANCH
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 拉取代码失败" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host "完成: 已成功拉取 $CURRENT_BRANCH 分支的最新代码" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "发生错误: $_" -ForegroundColor Red
    exit 1
}

