# Git 合并脚本 - 调试模式
# 功能：将当前分支合并到 test 分支并推送

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Git 合并脚本 - 调试模式" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "当前工作目录: $PWD" -ForegroundColor Gray
Write-Host ""

# 标记是否使用了 stash
$hasStashed = $false

try {
    # 获取当前分支
    Write-Host "[调试] 正在获取当前分支..." -ForegroundColor Yellow
    Write-Host "[命令] git rev-parse --abbrev-ref HEAD" -ForegroundColor DarkGray
    $CURRENT_BRANCH = git rev-parse --abbrev-ref HEAD
    if (-not $CURRENT_BRANCH) {
        Write-Host "错误: 无法获取当前分支" -ForegroundColor Red
        exit 1
    }
    Write-Host "[调试] 当前分支: $CURRENT_BRANCH" -ForegroundColor Green

    # 获取默认远程名称
    Write-Host "[调试] 正在获取默认远程名称..." -ForegroundColor Yellow
    Write-Host "[命令] git remote" -ForegroundColor DarkGray
    $REMOTE_NAME = (git remote | Select-Object -First 1).Trim()
    if (-not $REMOTE_NAME) {
        Write-Host "错误: 未找到远程仓库" -ForegroundColor Red
        exit 1
    }
    Write-Host "[调试] 远程名称: [$REMOTE_NAME]" -ForegroundColor Green

    # 检查是否有暂存的更改
    Write-Host "[调试] 正在检查暂存的更改..." -ForegroundColor Yellow
    Write-Host "[命令] git diff --cached --name-only" -ForegroundColor DarkGray
    $stagedChanges = git diff --cached --name-only
    if ($stagedChanges) {
        Write-Host "错误: 存在暂存的更改，请先提交或重置它们" -ForegroundColor Red
        exit 1
    }

    # 确认当前分支不是 test
    if ($CURRENT_BRANCH -eq "test") {
        Write-Host "错误: 当前已在 test 分支，无法合并" -ForegroundColor Red
        exit 1
    }

    # 检查 test 分支是否存在
    Write-Host "[调试] 正在检查 test 分支是否存在..." -ForegroundColor Yellow
    Write-Host "[命令] git rev-parse --verify test" -ForegroundColor DarkGray
    $null = git rev-parse --verify test 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: test 分支不存在" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "[调试] 开始操作..." -ForegroundColor Yellow
    Write-Host "[调试] 原始分支: $CURRENT_BRANCH" -ForegroundColor Green
    Write-Host "[调试] 远程名称: $REMOTE_NAME" -ForegroundColor Green
    Write-Host "[调试] 工作目录: $PWD" -ForegroundColor Green
    Write-Host ""

    # 检查是否有未提交的本地更改（可能被 checkout 覆盖）
    Write-Host "[调试] 正在检查本地更改..." -ForegroundColor Yellow
    $localChanges = git status --porcelain
    if ($localChanges) {
        # 检查更改的文件列表
        # git status --porcelain 格式: "XY filename"，前两列是状态，后面是文件名
        $changedFiles = @()
        foreach ($line in $localChanges) {
            # 跳过前3个字符（状态码和空格），获取文件名
            if ($line.Length -gt 3) {
                $fileName = $line.Substring(3).Trim()
                $changedFiles += $fileName
            }
        }
        
        $hasConfigDev = $false
        $otherFiles = @()
        
        foreach ($file in $changedFiles) {
            # 使用路径标准化比较，支持正斜杠和反斜杠
            $normalizedFile = $file -replace '\\', '/'
            if ($normalizedFile -eq "config/config.dev.ts") {
                $hasConfigDev = $true
            }
            else {
                $otherFiles += $file
            }
        }
        
        # 如果有其他文件的更改，停止并提示
        if ($otherFiles.Count -gt 0) {
            Write-Host "错误: 检测到本地有未提交的更改，且包含除 config/config.dev.ts 以外的文件" -ForegroundColor Red
            Write-Host "更改的文件列表:" -ForegroundColor Yellow
            foreach ($file in $changedFiles) {
                Write-Host "  - $file" -ForegroundColor Yellow
            }
            Write-Host ""
            Write-Host "请先提交或暂存这些更改后再执行合并操作" -ForegroundColor Yellow
            Write-Host "只有 config/config.dev.ts 文件的更改会被自动暂存处理" -ForegroundColor Yellow
            exit 1
        }
        
        # 如果只有 config/config.dev.ts 的更改，则暂存
        if ($hasConfigDev) {
            Write-Host "检测到 config/config.dev.ts 有未提交的更改，将在切换分支前暂存..." -ForegroundColor Yellow
            Write-Host "[命令] git stash push -m '临时暂存: 合并到test前'" -ForegroundColor DarkGray
            git stash push -m "临时暂存: 合并到test前"
            if ($LASTEXITCODE -ne 0) {
                Write-Host "错误: 暂存失败" -ForegroundColor Red
                exit 1
            }
            $hasStashed = $true
            Write-Host "已暂存 config/config.dev.ts 的更改" -ForegroundColor Green
        }
    }

    # 切换到 test 分支
    Write-Host "正在切换到 test 分支..." -ForegroundColor Cyan
    Write-Host "[命令] git checkout test" -ForegroundColor DarkGray
    git checkout test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 切换到 test 分支失败" -ForegroundColor Red
        # 如果暂存了，尝试恢复
        if ($hasStashed) {
            Write-Host "正在恢复暂存的更改..." -ForegroundColor Yellow
            git stash pop 2>&1 | Out-Null
        }
        exit 1
    }

    # 拉取 test 分支的最新代码
    Write-Host "正在拉取 test 分支的最新代码..." -ForegroundColor Cyan
    Write-Host "[命令] git pull $REMOTE_NAME test" -ForegroundColor DarkGray
    git pull $REMOTE_NAME test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 拉取 test 分支失败" -ForegroundColor Red
        Write-Host "[调试] 停留在 test 分支以便手动处理" -ForegroundColor Yellow
        Write-Host "您现在可以手动解决此问题或重试" -ForegroundColor Yellow
        Write-Host "当前分支: test" -ForegroundColor Yellow
        # 如果暂存了，尝试恢复（但需要先切换回原分支）
        if ($hasStashed) {
            Write-Host "正在切换回原分支以恢复暂存的更改..." -ForegroundColor Yellow
            git checkout $CURRENT_BRANCH 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                git stash pop 2>&1 | Out-Null
            }
        }
        exit 1
    }

    # 合并当前分支到 test
    Write-Host ""
    Write-Host "[调试] 即将合并: $CURRENT_BRANCH 到 test" -ForegroundColor Yellow
    Write-Host "[调试] 合并命令: git merge $CURRENT_BRANCH --no-ff --no-edit" -ForegroundColor DarkGray
    Write-Host "正在合并 $CURRENT_BRANCH 到 test 分支..." -ForegroundColor Cyan
    Write-Host "[命令] git merge $CURRENT_BRANCH --no-ff --no-edit" -ForegroundColor DarkGray
    git merge $CURRENT_BRANCH --no-ff --no-edit
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 合并失败，可能存在冲突。请手动解决" -ForegroundColor Red
        Write-Host "使用 'git merge --abort' 可以取消合并" -ForegroundColor Yellow
        Write-Host "[调试] 正在返回 $CURRENT_BRANCH 分支..." -ForegroundColor Yellow
        Write-Host "[命令] git checkout $CURRENT_BRANCH" -ForegroundColor DarkGray
        git checkout $CURRENT_BRANCH
        # 如果暂存了，恢复暂存的更改
        if ($hasStashed) {
            Write-Host "正在恢复暂存的更改..." -ForegroundColor Yellow
            git stash pop 2>&1 | Out-Null
        }
        exit 1
    }

    # 推送 test 分支
    Write-Host "正在推送 test 分支到远程..." -ForegroundColor Cyan
    Write-Host "[命令] git push $REMOTE_NAME test" -ForegroundColor DarkGray
    git push $REMOTE_NAME test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "错误: 推送 test 分支失败" -ForegroundColor Red
        Write-Host "[调试] 停留在 test 分支以便手动处理" -ForegroundColor Yellow
        Write-Host "您现在可以手动解决推送问题或重试" -ForegroundColor Yellow
        Write-Host "当前分支: test" -ForegroundColor Yellow
        # 如果暂存了，尝试恢复（但需要先切换回原分支）
        if ($hasStashed) {
            Write-Host "正在切换回原分支以恢复暂存的更改..." -ForegroundColor Yellow
            git checkout $CURRENT_BRANCH 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                git stash pop 2>&1 | Out-Null
            }
        }
        exit 1
    }

    # 返回原始分支
    Write-Host ""
    Write-Host "[调试] 正在返回原始分支: $CURRENT_BRANCH" -ForegroundColor Yellow
    Write-Host "正在返回 $CURRENT_BRANCH 分支..." -ForegroundColor Cyan
    Write-Host "[命令] git checkout $CURRENT_BRANCH" -ForegroundColor DarkGray
    git checkout $CURRENT_BRANCH
    if ($LASTEXITCODE -ne 0) {
        Write-Host "警告: 返回 $CURRENT_BRANCH 分支失败，请手动切换" -ForegroundColor Yellow
    }
    else {
        # 如果暂存了，恢复暂存的更改
        if ($hasStashed) {
            Write-Host "正在恢复暂存的更改..." -ForegroundColor Yellow
            Write-Host "[命令] git stash pop" -ForegroundColor DarkGray
            git stash pop
            if ($LASTEXITCODE -ne 0) {
                Write-Host "警告: 恢复暂存的更改时出现问题，请手动检查" -ForegroundColor Yellow
            }
            else {
                Write-Host "已恢复暂存的更改" -ForegroundColor Green
            }
        }
    }

    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host "完成: 已成功将 $CURRENT_BRANCH 合并到 test 分支并推送" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "发生错误: $_" -ForegroundColor Red
    # 如果暂存了，尝试恢复
    if ($hasStashed) {
        Write-Host "正在尝试恢复暂存的更改..." -ForegroundColor Yellow
        $currentBranchCheck = git rev-parse --abbrev-ref HEAD 2>&1
        if ($LASTEXITCODE -eq 0 -and $currentBranchCheck -eq $CURRENT_BRANCH) {
            git stash pop 2>&1 | Out-Null
        }
        else {
            Write-Host "警告: 无法自动恢复暂存的更改，请手动执行 'git stash pop'" -ForegroundColor Yellow
        }
    }
    exit 1
}

