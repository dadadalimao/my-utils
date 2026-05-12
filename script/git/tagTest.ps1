#!/usr/bin/env pwsh
# Git 标签交互式创建脚本
# 功能：统一 test/wy 标签流程，自动递增补丁号并创建、推送新标签。

param(
    [string]$TagPrefix = "",
    [string]$RemoteName = "origin",
    [switch]$DryRun = $false,
    [switch]$Help = $false
)

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

function Write-AppError {
    param([string]$Message)
    Write-ColorOutput "错误: $Message" "Red"
    exit 1
}

function Write-AppSuccess {
    param([string]$Message)
    Write-ColorOutput "成功: $Message" "Green"
}

function Write-AppInfo {
    param([string]$Message)
    Write-ColorOutput "信息: $Message" "Cyan"
}

function Write-AppWarning {
    param([string]$Message)
    Write-ColorOutput "警告: $Message" "Yellow"
}

function Show-Help {
    Write-Host "Git 标签交互式创建脚本" -ForegroundColor Green
    Write-Host ""
    Write-Host "用法: .\tagTest.ps1 [参数]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "参数:" -ForegroundColor Yellow
    Write-Host "  -TagPrefix <string>    指定标签前缀，例如 'test/v1.0' 或 'wy/v1.0'" -ForegroundColor White
    Write-Host "  -RemoteName <string>   远程仓库名称，默认为 'origin'" -ForegroundColor White
    Write-Host "  -DryRun                仅显示将要执行的操作，不实际创建标签" -ForegroundColor White
    Write-Host "  -Help                  显示此帮助信息" -ForegroundColor White
    Write-Host ""
    Write-Host "说明:" -ForegroundColor Yellow
    Write-Host "  未传入 -TagPrefix 时，将进入交互模式选择 test / wy / 无前缀(v1.0.x) / 自定义前缀" -ForegroundColor White
    Write-Host ""
    Write-Host "示例:" -ForegroundColor Yellow
    Write-Host "  .\tagTest.ps1                          # 交互选择前缀" -ForegroundColor White
    Write-Host "  .\tagTest.ps1 -DryRun                 # 交互模式预览" -ForegroundColor White
    Write-Host "  .\tagTest.ps1 -TagPrefix 'wy/v1.0'    # 非交互模式，直接使用指定前缀" -ForegroundColor White
}

function Confirm-Action {
    param(
        [string]$Message,
        [bool]$DefaultYes = $true
    )

    $suffix = if ($DefaultYes) { "(Y/n)" } else { "(y/N)" }
    $response = Read-Host "$Message $suffix"
    if ([string]::IsNullOrWhiteSpace($response)) {
        return $DefaultYes
    }

    return ($response -eq "y" -or $response -eq "Y")
}

function Assert-HeadPushedToRemote {
    param([string]$RemoteName)

    $headCommit = git rev-parse HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($headCommit)) {
        Write-AppError "无法获取当前提交信息"
    }

    $upstreamRef = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($upstreamRef)) {
        Write-AppError "当前分支未配置上游分支，无法确认提交是否已推送到远端"
    }

    if (-not $upstreamRef.StartsWith("$RemoteName/")) {
        Write-AppError "当前分支上游为 '$upstreamRef'，与指定远程 '$RemoteName' 不一致"
    }

    git merge-base --is-ancestor HEAD $upstreamRef 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-AppError "当前提交尚未推送到远端分支 '$upstreamRef'，请先 push 后再创建标签"
    }

    Write-AppInfo "已确认当前提交已推送到远端分支: $upstreamRef"
}

function Resolve-TagPrefix {
    param([string]$InputPrefix)

    if (-not [string]::IsNullOrWhiteSpace($InputPrefix)) {
        $normalizedPrefix = $InputPrefix.Trim()
        $isNoPrefixInput = ($normalizedPrefix -notmatch "/") -and ($normalizedPrefix -match "^v\d+\.\d+$")
        return [PSCustomObject]@{
            TagPrefix = $normalizedPrefix
            IsNoPrefixMode = $isNoPrefixInput
        }
    }

    Write-ColorOutput ""
    Write-ColorOutput "请选择标签前缀类型:" "Yellow"
    Write-ColorOutput "  [1] test/v1.0" "White"
    Write-ColorOutput "  [2] wy/v1.0" "White"
    Write-ColorOutput "  [3] 无前缀（v1.0.x）" "White"
    Write-ColorOutput "  [4] 自定义前缀" "White"

    while ($true) {
        $choice = Read-Host "请输入选项 (1/2/3/4)"
        switch ($choice) {
            "1" {
                return [PSCustomObject]@{
                    TagPrefix = "test/v1.0"
                    IsNoPrefixMode = $false
                }
            }
            "2" {
                return [PSCustomObject]@{
                    TagPrefix = "wy/v1.0"
                    IsNoPrefixMode = $false
                }
            }
            "3" {
                return [PSCustomObject]@{
                    TagPrefix = "v1.0"
                    IsNoPrefixMode = $true
                }
            }
            "4" {
                $customPrefix = Read-Host "请输入自定义前缀（示例: wy/v2.0）"
                if (-not [string]::IsNullOrWhiteSpace($customPrefix)) {
                    return [PSCustomObject]@{
                        TagPrefix = $customPrefix.Trim()
                        IsNoPrefixMode = $false
                    }
                }
                Write-AppWarning "自定义前缀不能为空，请重新输入"
            }
            default {
                Write-AppWarning "无效选项，请输入 1、2、3 或 4"
            }
        }
    }
}

if ($Help) {
    Show-Help
    exit 0
}

Write-ColorOutput "Git标签自动创建脚本启动" "Green"
Write-ColorOutput "=================================" "Green"

$resolvedPrefix = Resolve-TagPrefix -InputPrefix $TagPrefix
$TagPrefix = $resolvedPrefix.TagPrefix
$isNoPrefixMode = $resolvedPrefix.IsNoPrefixMode
Write-AppInfo "当前标签前缀: $TagPrefix"

try {
    $insideWorkTree = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0 -or $insideWorkTree -ne "true") {
        Write-AppError "当前目录不是 Git 仓库"
    }
} catch {
    Write-AppError "Git 命令执行失败，请确保已安装 Git"
}

Write-AppInfo "正在获取远程标签，前缀: $TagPrefix"
try {
    # 标签模式：{TagPrefix}.{patchNumber}
    $escapedPrefix = [regex]::Escape($TagPrefix)
    $tagPattern = "(?:refs/tags/)?$escapedPrefix\.(\d+)$"
    $tagSource = "远程"

    $remoteTagLines = git ls-remote --tags $RemoteName 2>$null
    if ($LASTEXITCODE -eq 0) {
        $matchedTags = $remoteTagLines | Where-Object { $_ -match $tagPattern }
    } else {
        Write-AppWarning "远程标签读取失败（网络/证书异常），将回退使用本地标签"
        $tagSource = "本地"
        $localTagLines = git tag -l
        if ($LASTEXITCODE -ne 0) {
            Write-AppError "获取本地标签失败"
        }
        $matchedTags = $localTagLines | Where-Object { $_ -match $tagPattern }
    }

    if (-not $matchedTags) {
        Write-AppWarning "未找到匹配 '$TagPrefix.x' 格式的$tagSource标签"
        $initialPatch = if ($isNoPrefixMode) { 0 } else { 1 }
        $newTag = "$TagPrefix.$initialPatch"
        Write-AppInfo "将创建第一个标签: $newTag"
    } else {
        $latestPatch = -1
        foreach ($tag in $matchedTags) {
            if ($tag -match $tagPattern) {
                $patch = [int]$matches[1]
                if ($patch -gt $latestPatch) {
                    $latestPatch = $patch
                }
            }
        }

        if ($latestPatch -lt 0) {
            Write-AppError "无法解析$tagSource标签版本号"
        }

        $latestTag = "$TagPrefix.$latestPatch"
        $newTag = "$TagPrefix.$($latestPatch + 1)"
        Write-AppInfo "找到最新${tagSource}标签: $latestTag"
        Write-AppInfo "新标签版本: $newTag"
    }
} catch {
    Write-AppError "获取远程标签失败: $($_.Exception.Message)"
}

Write-AppInfo "检查本地标签..."
$localTagExists = git tag -l $newTag
if ($localTagExists) {
    Write-AppWarning "本地已存在标签: $newTag"
    if (-not $DryRun) {
        $shouldDelete = Confirm-Action -Message "是否删除本地标签并重新创建?" -DefaultYes $true
        if ($shouldDelete) {
            git tag -d $newTag | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Write-AppError "删除本地标签失败: $newTag"
            }
            Write-AppInfo "已删除本地标签: $newTag"
        } else {
            Write-AppInfo "操作已取消"
            exit 0
        }
    }
}

Write-AppInfo "检查工作区状态..."
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-AppWarning "工作区有未提交的更改:"
    Write-Host $gitStatus
    if (-not $DryRun) {
        $shouldContinue = Confirm-Action -Message "是否继续创建标签?" -DefaultYes $true
        if (-not $shouldContinue) {
            Write-AppInfo "操作已取消"
            exit 0
        }
    }
}

if ($DryRun) {
    Write-ColorOutput "预览模式 - 将要执行的操作:" "Yellow"
    Write-ColorOutput "   1. 创建标签: $newTag" "White"
    Write-ColorOutput "   2. 确认标签内容并创建注释标签" "White"
    Write-ColorOutput "   3. 推送标签到远程仓库: $RemoteName" "White"
    Write-ColorOutput "   4. 触发 Drone CI/CD 流水线" "White"
} else {
    Write-AppInfo "检查当前提交是否已推送到远端..."
    Assert-HeadPushedToRemote -RemoteName $RemoteName

    $commitHash = git rev-parse HEAD
    $commitMessage = git log -1 --pretty=format:"%s"
    $tagMessage = "Release $newTag`n`nCommit: $commitHash`nMessage: $commitMessage"

    Write-AppInfo "即将创建以下标签内容:"
    Write-Host "Tag: $newTag" -ForegroundColor White
    Write-Host "Target Commit: $commitHash" -ForegroundColor White
    Write-Host "Tag Message:" -ForegroundColor White
    Write-Host $tagMessage -ForegroundColor White

    $shouldCreateTag = Confirm-Action -Message "确认按以上内容创建标签?" -DefaultYes $true
    if (-not $shouldCreateTag) {
        Write-AppInfo "操作已取消"
        exit 0
    }

    Write-AppInfo "正在创建标签: $newTag"

    git tag -a $newTag -m $tagMessage
    if ($LASTEXITCODE -ne 0) {
        Write-AppError "标签创建失败"
    }
    Write-AppSuccess "标签创建成功: $newTag"

    Write-AppInfo "正在推送标签到远程仓库..."
    git push $RemoteName $newTag
    if ($LASTEXITCODE -ne 0) {
        Write-AppError "标签推送失败"
    }

    Write-AppSuccess "标签推送成功: $newTag"
    Write-ColorOutput "新标签 $newTag 已成功创建并推送到远程仓库" "Green"
    Write-ColorOutput "Drone CI/CD 流水线将自动触发部署" "Green"
}

Write-ColorOutput "=================================" "Green"
Write-ColorOutput "脚本执行完成" "Green"
