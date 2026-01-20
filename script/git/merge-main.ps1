#!/usr/bin/env pwsh
# Git合并脚本
# 功能：拉取远端 origin/main 分支最新代码并合并到当前分支

param(
    [string]$RemoteName = "origin",
    [string]$BranchName = "main",
    [switch]$Help = $false
)

# 显示帮助信息
if ($Help) {
    Write-Host "Git合并脚本 - 拉取并合并远端分支" -ForegroundColor Green
    Write-Host ""
    Write-Host "用法: .\merge-main.ps1 [参数]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "参数:" -ForegroundColor Yellow
    Write-Host "  -RemoteName <string>   远程仓库名称，默认为 'origin'" -ForegroundColor White
    Write-Host "  -BranchName <string>   要拉取的分支名称，默认为 'main'" -ForegroundColor White
    Write-Host "  -Help                  显示此帮助信息" -ForegroundColor White
    Write-Host ""
    Write-Host "示例:" -ForegroundColor Yellow
    Write-Host "  .\merge-main.ps1                           # 拉取并合并 origin/main" -ForegroundColor White
    Write-Host "  .\merge-main.ps1 -BranchName 'master'      # 拉取并合并 origin/master" -ForegroundColor White
    exit 0
}

# 颜色输出函数
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

# 错误处理函数
function Write-Error {
    param([string]$Message)
    Write-ColorOutput "错误: $Message" "Red"
    exit 1
}

# 成功信息函数
function Write-Success {
    param([string]$Message)
    Write-ColorOutput "成功: $Message" "Green"
}

# 信息输出函数
function Write-Info {
    param([string]$Message)
    Write-ColorOutput "信息: $Message" "Cyan"
}

# 警告信息函数
function Write-Warning {
    param([string]$Message)
    Write-ColorOutput "警告: $Message" "Yellow"
}

Write-ColorOutput "Git合并脚本启动" "Green"
Write-ColorOutput "=================================" "Green"

# 检查是否在Git仓库中
try {
    $gitStatus = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "当前目录不是Git仓库"
    }
}
catch {
    Write-Error "Git命令执行失败，请确保已安装Git"
}

# 获取当前分支
Write-Info "正在获取当前分支..."
try {
    $currentBranch = git rev-parse --abbrev-ref HEAD
    if ($LASTEXITCODE -ne 0) {
        Write-Error "无法获取当前分支"
    }
    Write-Info "当前分支: $currentBranch"
}
catch {
    Write-Error "获取当前分支失败: $($_.Exception.Message)"
}

# 检查工作区状态
Write-Info "检查工作区状态..."
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Warning "工作区有未提交的更改:"
    Write-Host $gitStatus
    $response = Read-Host "是否继续合并? (Y/n)"
    if ($response -eq 'n' -or $response -eq 'N') {
        Write-Info "操作已取消"
        exit 0
    }
}

# 检查是否有暂存的更改
Write-Info "检查暂存区状态..."
$stagedChanges = git diff --cached --name-only
if ($stagedChanges) {
    Write-Warning "暂存区有未提交的更改:"
    Write-Host $stagedChanges
    $response = Read-Host "是否继续合并? (Y/n)"
    if ($response -eq 'n' -or $response -eq 'N') {
        Write-Info "操作已取消"
        exit 0
    }
}

# 获取远程分支信息
$remoteBranch = "$RemoteName/$BranchName"
Write-Info "目标远程分支: $remoteBranch"

# 拉取远程分支最新代码
Write-Info "正在拉取 $remoteBranch 最新代码..."
try {
    git fetch $RemoteName $BranchName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "拉取远程分支失败，请检查分支名称和远程仓库配置"
    }
    Write-Success "拉取成功"
}
catch {
    Write-Error "拉取远程分支失败: $($_.Exception.Message)"
}

# 合并远程分支到当前分支
Write-Info "正在合并 $remoteBranch 到当前分支 $currentBranch..."
try {
    git merge "$remoteBranch" --no-ff --no-edit
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "合并失败，可能存在冲突"
        Write-Info "请手动解决冲突后，使用以下命令完成合并:"
        Write-ColorOutput "  git add ." "Yellow"
        Write-ColorOutput "  git commit" "Yellow"
        Write-Info "或者取消合并:"
        Write-ColorOutput "  git merge --abort" "Yellow"
        exit 1
    }
    Write-Success "合并成功"
}
catch {
    Write-Error "合并失败: $($_.Exception.Message)"
}

Write-ColorOutput "=================================" "Green"
Write-Success "已将 $remoteBranch 合并到 $currentBranch"
Write-ColorOutput "脚本执行完成" "Green"

