#!/usr/bin/env pwsh
# Git 新建分支脚本
# 功能：从 origin 的默认分支（main 或 master）创建新的本地分支，启动后输入新分支名字

param(
    [string]$RemoteName = "origin",
    [switch]$Help = $false
)

# 显示帮助信息
if ($Help) {
    Write-Host "Git 新建分支脚本 - 从远程默认分支创建新本地分支" -ForegroundColor Green
    Write-Host ""
    Write-Host "用法: .\new-branch.ps1 [参数]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "参数:" -ForegroundColor Yellow
    Write-Host "  -RemoteName <string>   远程仓库名称，默认为 'origin'" -ForegroundColor White
    Write-Host "  -Help                  显示此帮助信息" -ForegroundColor White
    Write-Host ""
    Write-Host "说明: 默认分支自动判断顺序为" -ForegroundColor Yellow
    Write-Host "  1. 远程 HEAD 指向的分支 (git symbolic-ref refs/remotes/origin/HEAD)" -ForegroundColor White
    Write-Host "  2. 若未设置，则依次尝试 origin/main、origin/master" -ForegroundColor White
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

# 错误处理函数（避免与内置 Write-Error 冲突，用 Script 前缀）
function Write-ScriptError {
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

Write-ColorOutput "Git 新建分支脚本" "Green"
Write-ColorOutput "=================================" "Green"

# 检查是否在 Git 仓库中
try {
    $null = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-ScriptError "当前目录不是 Git 仓库"
    }
}
catch {
    Write-ScriptError "Git 命令执行失败，请确保已安装 Git"
}

# 自动判断远程默认分支（main / master）
# 只返回“本地已有对应远程跟踪分支”的分支名，避免 "Needed a single revision"
# 1. 优先使用远程 HEAD 指向的分支（且该引用存在）
# 2. 否则依次尝试 origin/main、origin/master
function Get-RemoteDefaultBranch {
    $ref = git symbolic-ref "refs/remotes/$RemoteName/HEAD" 2>$null
    if ($LASTEXITCODE -eq 0 -and $ref) {
        $branch = $ref -replace "refs/remotes/$RemoteName/", ""
        if ($branch -and (git rev-parse --verify "${RemoteName}/${branch}" 2>$null)) { return $branch }
    }
    if (git rev-parse --verify "${RemoteName}/main" 2>$null) { return "main" }
    if (git rev-parse --verify "${RemoteName}/master" 2>$null) { return "master" }
    return $null
}

Write-Info "正在检测远程默认分支..."
$baseBranch = Get-RemoteDefaultBranch
if (-not $baseBranch) {
    Write-ScriptError "未找到远程默认分支（已尝试 origin/HEAD、origin/main、origin/master）。可先执行: git fetch $RemoteName"
}

$remoteRef = "${RemoteName}/${baseBranch}"
Write-Info "将基于: $remoteRef 创建新分支"

# 拉取远程最新（更新 origin/main 等远程跟踪分支，与本地是否已有 main 无关；用 fetch 全部引用更稳妥）
Write-Info "正在拉取远程最新 ($RemoteName)..."
try {
    $fetchAll = git fetch $RemoteName 2>&1
    $fetchExitCode = $LASTEXITCODE
    if ($fetchExitCode -ne 0) {
        Write-ColorOutput "警告: 拉取失败，将使用本地已有的 $remoteRef" "Yellow"
        Write-ColorOutput "  退出码: $fetchExitCode" "Gray"
        if ($fetchAll) {
            Write-ColorOutput "  完整输出:" "Gray"
            foreach ($line in $fetchAll) {
                Write-ColorOutput "    $line" "Gray"
            }
        }
    }
}
catch {
    Write-ColorOutput "警告: 拉取失败，将使用本地已有的 $remoteRef" "Yellow"
    Write-ColorOutput "  原因: $($_.Exception.Message)" "Gray"
}

# 输入新分支名
$newBranch = Read-Host "请输入新分支名称"
$newBranch = $newBranch.Trim()
Write-ColorOutput "[日志] 新分支名: '$newBranch' (长度 $($newBranch.Length))" "Gray"
if ([string]::IsNullOrWhiteSpace($newBranch)) {
    Write-ScriptError "分支名称不能为空"
}
if ($newBranch -match '\s') {
    Write-ScriptError "分支名称不能包含空格"
}
if ($newBranch -match '\.\.|^\.|\.$|\.\.$|@\{|\\\\|\*\?\[\^~') {
    Write-ScriptError "分支名称包含非法字符"
}

# 检查本地是否已存在该分支（用 branch --list 避免“不存在”时触发 git 的 fatal 输出）
Write-ColorOutput "[日志] 步骤: 检查本地是否已存在分支 '$newBranch'" "Gray"
$existing = git branch --list --no-color $newBranch 2>$null
if ($existing) {
    Write-ScriptError "本地分支 '$newBranch' 已存在"
}
Write-ColorOutput "[日志] 本地无此分支，继续" "Gray"

# 解析基准为 commit SHA（传 SHA 给 checkout -b 可避免 "Needed a single revision"）
Write-ColorOutput "[日志] 步骤: 解析基准 ref='$remoteRef'" "Gray"
$baseCommit = @(git rev-parse --verify $remoteRef 2>$null)[0]
if (-not $baseCommit) {
    $altRef = if ($baseBranch -eq "main") { "${RemoteName}/master" } else { "${RemoteName}/main" }
    Write-ColorOutput "[日志] $remoteRef 无效，尝试 $altRef" "Gray"
    $baseCommit = @(git rev-parse --verify $altRef 2>$null)[0]
    if ($baseCommit) {
        Write-ColorOutput "信息: $remoteRef 不存在，改用 $altRef" "Cyan"
        $remoteRef = $altRef
    }
    else {
        Write-ScriptError "远程引用 $remoteRef 不存在（已尝试 $remoteRef、$altRef）。请先执行: git fetch $RemoteName"
    }
}
$baseCommit = "$baseCommit".Trim()
Write-ColorOutput "[日志] baseCommit='$baseCommit' (长度 $($baseCommit.Length))" "Gray"

# 基于该 commit 创建并切换到新分支
Write-Info "正在创建并切换到分支: $newBranch (基于 $remoteRef)..."
Write-ColorOutput "[日志] 步骤: 执行 git checkout -b '$newBranch' '$baseCommit'" "Gray"
try {
    git checkout -b $newBranch $baseCommit
    Write-ColorOutput "[日志] checkout 已执行，LASTEXITCODE=$LASTEXITCODE" "Gray"
    if ($LASTEXITCODE -ne 0) {
        Write-ScriptError "创建分支失败"
    }
    Write-Success "已创建并切换到分支: $newBranch"
}
catch {
    Write-ColorOutput "[日志] 错误发生在 checkout 步骤: $($_.Exception.Message)" "Red"
    Write-ScriptError "创建分支失败: $($_.Exception.Message)"
}

Write-ColorOutput "=================================" "Green"
Write-Success "脚本执行完成"
