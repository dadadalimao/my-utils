# Git 脚本管理工具
# 功能：提供交互式菜单，可选执行 script/git 目录下的脚本

$ErrorActionPreference = "Stop"

# 脚本目录
$scriptDir = Join-Path $PSScriptRoot "git"

# 检查脚本目录是否存在
if (-not (Test-Path $scriptDir)) {
    Write-Host "错误: 脚本目录不存在: $scriptDir" -ForegroundColor Red
    exit 1
}

# 从 script/git 目录自动读取 .ps1 脚本列表，描述取自脚本内首行 "# 功能：xxx"
function Get-ScriptList {
    $files = Get-ChildItem -Path $scriptDir -Filter "*.ps1" -File | Sort-Object Name
    $list = [System.Collections.ArrayList]::new()
    $index = 1
    foreach ($f in $files) {
        $desc = "（无描述）"
        $head = (Get-Content -Path $f.FullName -First 15 -ErrorAction SilentlyContinue) -join "`n"
        if ($head -match '(?m)^#\s*功能[：:]\s*(.+)$') {
            $desc = $Matches[1].Trim()
        }
        $null = $list.Add([PSCustomObject]@{
            Order    = $index
            Name     = $f.Name
            Description = $desc
        })
        $index++
    }
    return $list
}

# 显示菜单（使用当前 $scripts 列表，描述来自各脚本内 "# 功能：xxx"）
function Show-Menu {
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "Git 脚本管理工具" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""

    foreach ($script in $scripts) {
        $scriptPath = Join-Path $scriptDir $script.Name
        $exists = Test-Path $scriptPath
        $status = if ($exists) { "✓" } else { "✗" }
        $color = if ($exists) { "Green" } else { "Red" }
        
        Write-Host "[$($script.Order)] " -NoNewline -ForegroundColor Yellow
        Write-Host "$status " -NoNewline -ForegroundColor $color
        Write-Host "$($script.Name)" -NoNewline -ForegroundColor White
        Write-Host " - $($script.Description)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "[0] 退出" -ForegroundColor Yellow
    Write-Host ""
}

# 执行选中的脚本
function Invoke-Script {
    param(
        [string]$ScriptName
    )
    
    $scriptPath = Join-Path $scriptDir $ScriptName
    
    if (-not (Test-Path $scriptPath)) {
        Write-Host "错误: 脚本不存在: $ScriptName" -ForegroundColor Red
        return $false
    }
    
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "正在执行: $ScriptName" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""
    
    try {
        & $scriptPath
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            Write-Host ""
            Write-Host "脚本执行完成，退出码: $exitCode" -ForegroundColor Yellow
        }
        return $true
    }
    catch {
        Write-Host "执行脚本时发生错误: $_" -ForegroundColor Red
        return $false
    }
}

# 主循环（每次显示菜单前自动刷新脚本列表）
while ($true) {
    $scripts = Get-ScriptList
    Show-Menu
    
    Write-Host "请选择要执行的脚本 (输入数字): " -NoNewline -ForegroundColor Yellow
    $choice = Read-Host
    
    # 清除输入
    $choice = $choice.Trim()
    
    # 检查是否退出
    if ($choice -eq "0" -or $choice -eq "" -or $choice -eq "q" -or $choice -eq "Q") {
        Write-Host ""
        Write-Host "已退出" -ForegroundColor Green
        break
    }
    
    # 查找对应的脚本
    $selectedScript = $scripts | Where-Object { $_.Order -eq [int]$choice } | Select-Object -First 1
    
    if ($selectedScript) {
        $result = Invoke-Script -ScriptName $selectedScript.Name
        
        Write-Host ""
        Write-Host "按任意键继续..." -ForegroundColor Gray
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
    else {
        Write-Host ""
        Write-Host "无效的选择，请重新输入" -ForegroundColor Red
        Start-Sleep -Seconds 1
    }
}

