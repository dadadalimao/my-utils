#!/usr/bin/env pwsh
# Git标签自动创建脚本
# 功能：获取远程最新的指定前缀标签，自动递增版本号并创建新标签

param(
    [string]$TagPrefix = "test/v1.0",
    [string]$RemoteName = "origin",
    [switch]$DryRun = $false,
    [switch]$Help = $false
)

# 显示帮助信息
if ($Help) {
    Write-Host "Git标签自动创建脚本" -ForegroundColor Green
    Write-Host ""
    Write-Host "用法: .\create-tag-cn.ps1 [参数]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "参数:" -ForegroundColor Yellow
    Write-Host "  -TagPrefix <string>    标签前缀，默认为 'wy/v1.0' (将检查 wy/v1.0.x)" -ForegroundColor White
    Write-Host "  -RemoteName <string>   远程仓库名称，默认为 'origin'" -ForegroundColor White
    Write-Host "  -DryRun                仅显示将要执行的操作，不实际创建标签" -ForegroundColor White
    Write-Host "  -Help                  显示此帮助信息" -ForegroundColor White
    Write-Host ""
    Write-Host "示例:" -ForegroundColor Yellow
    Write-Host "  .\create-tag-cn.ps1                           # 使用默认参数 (wy/v1.0.x)" -ForegroundColor White
    Write-Host "  .\create-tag-cn.ps1 -DryRun                   # 预览模式" -ForegroundColor White
    Write-Host "  .\create-tag-cn.ps1 -TagPrefix 'wy/v2.0'      # 检查 wy/v2.0.x 标签" -ForegroundColor White
    Write-Host "  .\create-tag-cn.ps1 -TagPrefix 'wy/v1.1'      # 检查 wy/v1.1.x 标签" -ForegroundColor White
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

Write-ColorOutput "Git标签自动创建脚本启动" "Green"
Write-ColorOutput "=================================" "Green"

# 检查是否在Git仓库中
try {
    $gitStatus = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "当前目录不是Git仓库"
    }
} catch {
    Write-Error "Git命令执行失败，请确保已安装Git"
}

# 获取远程标签
Write-Info "正在获取远程标签，前缀: $TagPrefix"
try {
    # 获取远程标签，只获取匹配指定前缀模式的标签
    # 模式: refs/tags/{TagPrefix}.{patch_number}
    $escapedPrefix = [regex]::Escape($TagPrefix)
    $remoteTags = git ls-remote --tags $RemoteName | Where-Object { $_ -match "refs/tags/$escapedPrefix\.(\d+)" }

    if (-not $remoteTags) {
        Write-Warning "未找到匹配 '$TagPrefix.x' 格式的远程标签"
        Write-Info "将创建第一个标签: $TagPrefix.1"
        $newTag = $TagPrefix + ".1"
    } else {
        # 解析所有匹配的标签并找到最新的补丁版本号
        $latestPatch = 0
        $latestTag = ""

        foreach ($tag in $remoteTags) {
            if ($tag -match "refs/tags/$escapedPrefix\.(\d+)") {
                $patch = [int]$matches[1]

                # 找到最高的补丁版本号
                if ($patch -gt $latestPatch) {
                    $latestPatch = $patch
                    $latestTag = $TagPrefix + "." + $patch
                }
            }
        }

        if ($latestTag) {
            Write-Info "找到最新标签: $latestTag"

            # 递增补丁版本号
            $newPatch = $latestPatch + 1
            $newTag = $TagPrefix + "." + $newPatch
            Write-Info "新标签版本: $newTag"
        } else {
            Write-Error "无法解析远程标签版本号"
        }
    }
} catch {
    Write-Error "获取远程标签失败: $($_.Exception.Message)"
}

# 检查本地是否已存在该标签
Write-Info "检查本地标签..."
$localTagExists = git tag -l $newTag
if ($localTagExists) {
    Write-Warning "本地已存在标签: $newTag"
    if (-not $DryRun) {
        $response = Read-Host "是否删除本地标签并重新创建? (Y/n)"
        if ($response -ne 'n' -and $response -ne 'N') {
            git tag -d $newTag
            Write-Info "已删除本地标签: $newTag"
        } else {
            Write-Info "操作已取消"
            exit 0
        }
    }
}

# 检查工作区状态
Write-Info "检查工作区状态..."
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Warning "工作区有未提交的更改:"
    Write-Host $gitStatus
    if (-not $DryRun) {
        $response = Read-Host "是否继续创建标签? (Y/n)"
        if ($response -eq 'n' -or $response -eq 'N') {
            Write-Info "操作已取消"
            exit 0
        }
    }
}

# 创建标签
if ($DryRun) {
    Write-ColorOutput "预览模式 - 将要执行的操作:" "Yellow"
    Write-ColorOutput "   1. 创建标签: $newTag" "White"
    Write-ColorOutput "   2. 推送标签到远程仓库: $RemoteName" "White"
    Write-ColorOutput "   3. 触发Drone CI/CD流水线" "White"
} else {
    Write-Info "正在创建标签: $newTag"

    # 获取当前提交信息
    $commitHash = git rev-parse HEAD
    $commitMessage = git log -1 --pretty=format:"%s"

    # 创建带注释的标签
    $tagMessage = "Release $newTag`n`nCommit: $commitHash`nMessage: $commitMessage"
    git tag -a $newTag -m $tagMessage

    if ($LASTEXITCODE -eq 0) {
        Write-Success "标签创建成功: $newTag"

        # 推送标签到远程仓库
        Write-Info "正在推送标签到远程仓库..."
        git push $RemoteName $newTag

        if ($LASTEXITCODE -eq 0) {
            Write-Success "标签推送成功: $newTag"
            Write-ColorOutput "新标签 $newTag 已成功创建并推送到远程仓库" "Green"
            Write-ColorOutput "Drone CI/CD流水线将自动触发部署" "Green"
        } else {
            Write-Error "标签推送失败"
        }
    } else {
        Write-Error "标签创建失败"
    }
}

Write-ColorOutput "=================================" "Green"
Write-ColorOutput "脚本执行完成" "Green"
