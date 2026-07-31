# Git 清理本地分支脚本
# 功能：删除没有有效远程跟踪的本地分支（无 upstream 或 upstream 已 gone）

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Git 清理无跟踪本地分支" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "当前工作目录: $PWD" -ForegroundColor Gray
Write-Host ""

git rev-parse --is-inside-work-tree 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 当前目录不是 Git 仓库" -ForegroundColor Red
    exit 1
}

$currentBranch = git rev-parse --abbrev-ref HEAD
$lines = @(git for-each-ref refs/heads/ --format="%(refname:short)|%(upstream:short)")

$toDelete = [System.Collections.ArrayList]::new()
$skippedCurrent = $false

foreach ($line in $lines) {
    if (-not $line) { continue }

    $parts = $line -split '\|', 2
    $branch = $parts[0]
    $upstream = if ($parts.Count -gt 1) { $parts[1] } else { "" }

    $hasValidUpstream = $false
    if ($upstream) {
        git rev-parse --verify $upstream 2>$null | Out-Null
        $hasValidUpstream = ($LASTEXITCODE -eq 0)
    }

    if ($hasValidUpstream) {
        continue
    }

    if ($branch -eq $currentBranch) {
        $skippedCurrent = $true
        continue
    }

    $null = $toDelete.Add($branch)
}

if ($toDelete.Count -eq 0) {
    Write-Host "没有可删除的分支" -ForegroundColor Green
    if ($skippedCurrent) {
        Write-Host "提示: 当前分支 $currentBranch 无有效远程跟踪，请切换分支后重试" -ForegroundColor Yellow
    }
    exit 0
}

Write-Host "将删除以下 $($toDelete.Count) 个分支:" -ForegroundColor Yellow
foreach ($branch in $toDelete) {
    Write-Host "  - $branch" -ForegroundColor Yellow
}
Write-Host ""

if ($skippedCurrent) {
    Write-Host "跳过当前分支: $currentBranch（无有效远程跟踪）" -ForegroundColor DarkYellow
    Write-Host ""
}

if (-not $Force) {
    $confirm = Read-Host "确认删除？输入 yes 继续"
    if ($confirm -ne "yes") {
        Write-Host "已取消" -ForegroundColor Green
        exit 0
    }
}

$deleted = 0
foreach ($branch in $toDelete) {
    Write-Host "删除: $branch" -ForegroundColor Cyan
    git branch -D $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 删除 $branch 失败" -ForegroundColor Red
        exit 1
    }
    $deleted++
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "完成: 已删除 $deleted 个分支" -ForegroundColor Green
Write-Host "当前分支: $currentBranch" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
