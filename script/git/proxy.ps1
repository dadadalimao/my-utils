#!/usr/bin/env pwsh
# Git 代理设置脚本
# 功能：交互式设置全局 Git 代理（127.0.0.1；默认 7897；可取消/查看；展示含当前目录仓库 local 与全局；亦支持命令行传参）
<#
.SYNOPSIS
    为本机 Git 配置 HTTP(S) 代理（固定 127.0.0.1，仅端口可变），用于 VPN/本地转发工具。

.DESCRIPTION
    无参数：进入交互菜单（适合从 git.ps1 启动）。
    有参数时（命令行）：
    - 省略对应默认：设置 http.proxy / https.proxy 为 http://127.0.0.1:7897
    - 端口为 0：取消上述代理配置
    - 参数 c：查看全局与（若当前目录在仓库内）本地仓库代理配置
    - 其他端口：设置为 http://127.0.0.1:<端口>

    使用 git config --global，作用于当前用户全局配置。
    展示配置时会根据「当前工作目录」读取当前仓库的 git config --local（若不在仓库内则提示）。
#>

param(
    [Parameter(Position = 0, HelpMessage = "省略=交互菜单；或 7897 默认/0 取消/c 查看/1-65535 端口")]
    [string]$Arg
)

$ErrorActionPreference = "Stop"

$ProxyHost = "127.0.0.1"

function Remove-GitProxy {
    # 键不存在时 git 会返回非零，忽略即可
    foreach ($key in @("http.proxy", "https.proxy")) {
        $null = git config --global --unset $key 2>&1
    }
}

function Set-GitProxy {
    param([int]$Port)
    $url = "http://${ProxyHost}:$Port"
    git config --global http.proxy $url
    if ($LASTEXITCODE -ne 0) { throw "设置 http.proxy 失败" }
    git config --global https.proxy $url
    if ($LASTEXITCODE -ne 0) { throw "设置 https.proxy 失败" }
}

# 判断当前工作目录是否在某 Git 工作树内（用于读取 --local）
function Test-GitInWorkTree {
    $null = git rev-parse --is-inside-work-tree 2>$null
    return ($LASTEXITCODE -eq 0)
}

# 显示全局与当前工作目录所在仓库的 local http.proxy / https.proxy（local 优先于 global）
function Show-GitProxyCurrent {
    Write-Host ""
    Write-Host "全局 (git config --global):" -ForegroundColor Gray
    $http = git config --global --get http.proxy 2>$null
    $https = git config --global --get https.proxy 2>$null
    if ($http) { Write-Host "  http.proxy  = $http" -ForegroundColor White }
    if ($https) { Write-Host "  https.proxy = $https" -ForegroundColor White }
    if (-not $http -and -not $https) {
        Write-Host "  （未设置）" -ForegroundColor DarkGray
    }

    Write-Host ""
    if (Test-GitInWorkTree) {
        $top = (git rev-parse --show-toplevel 2>$null)
        if ($top) { $top = $top.Trim() }
        Write-Host "当前仓库本地 (git config --local):" -ForegroundColor Gray
        Write-Host "  仓库根目录: $top" -ForegroundColor DarkGray
        Write-Host "  工作目录:   $(Get-Location)" -ForegroundColor DarkGray
        $lHttp = git config --local --get http.proxy 2>$null
        $lHttps = git config --local --get https.proxy 2>$null
        if ($lHttp) { Write-Host "  http.proxy  = $lHttp" -ForegroundColor White }
        if ($lHttps) { Write-Host "  https.proxy = $lHttps" -ForegroundColor White }
        if (-not $lHttp -and -not $lHttps) {
            Write-Host "  （未设置）" -ForegroundColor DarkGray
        }
        Write-Host "  说明: 单仓库 local 优先于 global；本脚本仅修改全局。" -ForegroundColor DarkGray
    }
    else {
        Write-Host "当前工作目录不在 Git 仓库内: $(Get-Location)" -ForegroundColor DarkGray
        Write-Host "  （无法读取 .git/config 的 local 代理；仅上方全局生效。）" -ForegroundColor DarkGray
    }
}

# 根据首个参数执行一次后退出（供命令行使用）
function Invoke-GitProxyFromArg {
    param([string]$Value)

    $mode = "set"
    $listenPort = 7897

    if ($null -eq $Value -or $Value -eq "") {
        $mode = "set"
        $listenPort = 7897
    }
    elseif ($Value -match '^[cC]$') {
        $mode = "show"
    }
    elseif ($Value -eq "0") {
        $mode = "unset"
    }
    elseif ($Value -match '^\d+$') {
        $n = [int]$Value
        if ($n -eq 0) {
            $mode = "unset"
        }
        elseif ($n -ge 1 -and $n -le 65535) {
            $mode = "set"
            $listenPort = $n
        }
        else {
            Write-Host "错误: 端口须在 1-65535 之间（0 表示取消代理）" -ForegroundColor Red
            exit 1
        }
    }
    else {
        Write-Host "错误: 无效参数 `"$Value`"。用法: 省略=交互菜单；7897 默认；0=取消；c=查看；1-65535 端口" -ForegroundColor Red
        exit 1
    }

    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "Git 代理（$ProxyHost，仅端口可变）" -ForegroundColor Cyan
    Write-Host "===========================================" -ForegroundColor Cyan

    try {
        switch ($mode) {
            "show" {
                Write-Host "查看当前 Git 代理配置（全局与当前目录仓库 local）" -ForegroundColor Yellow
                Show-GitProxyCurrent
            }
            "unset" {
                Write-Host "正在取消全局 http.proxy / https.proxy ..." -ForegroundColor Yellow
                Remove-GitProxy
                Write-Host "已取消 Git 代理配置。" -ForegroundColor Green
                Show-GitProxyCurrent
            }
            "set" {
                Write-Host "正在设置全局代理为 http://${ProxyHost}:$listenPort ..." -ForegroundColor Yellow
                Set-GitProxy -Port $listenPort
                Write-Host "已设置: http.proxy 与 https.proxy -> http://${ProxyHost}:$listenPort" -ForegroundColor Green
                Show-GitProxyCurrent
            }
        }
    }
    catch {
        Write-Host "错误: $_" -ForegroundColor Red
        exit 1
    }

    exit 0
}

# 无参数：交互式菜单（git.ps1 直接调用脚本时走此分支）
function Invoke-GitProxyInteractive {
    while ($true) {
        Write-Host ""
        Write-Host "===========================================" -ForegroundColor Cyan
        Write-Host "Git 代理（$ProxyHost，仅端口可变）" -ForegroundColor Cyan
        Write-Host "===========================================" -ForegroundColor Cyan
        Show-GitProxyCurrent

        Write-Host ""
        Write-Host "请选择操作:" -ForegroundColor Yellow
        Write-Host "  [1] 设为默认端口 7897" -ForegroundColor White
        Write-Host "  [2] 指定其他端口 (1-65535)" -ForegroundColor White
        Write-Host "  [3] 取消代理" -ForegroundColor White
        Write-Host "  [0] 退出" -ForegroundColor White
        Write-Host ""
        $choice = (Read-Host "请输入数字").Trim()

        try {
            switch ($choice) {
                "0" {
                    Write-Host "已退出。" -ForegroundColor Green
                    return
                }
                "1" {
                    Write-Host "正在设置为默认端口 7897 ..." -ForegroundColor Yellow
                    Set-GitProxy -Port 7897
                    Write-Host "已设置: http.proxy 与 https.proxy -> http://${ProxyHost}:7897" -ForegroundColor Green
                    Show-GitProxyCurrent
                }
                "2" {
                    $raw = Read-Host "请输入端口号 (1-65535)"
                    $raw = if ($null -ne $raw) { $raw.Trim() } else { "" }
                    if ($raw -notmatch '^\d+$') {
                        Write-Host "错误: 请输入有效数字。" -ForegroundColor Red
                    }
                    else {
                        $p = [int]$raw
                        if ($p -lt 1 -or $p -gt 65535) {
                            Write-Host "错误: 端口须在 1-65535 之间。" -ForegroundColor Red
                        }
                        else {
                            Write-Host "正在设置全局代理为 http://${ProxyHost}:$p ..." -ForegroundColor Yellow
                            Set-GitProxy -Port $p
                            Write-Host "已设置: http.proxy 与 https.proxy -> http://${ProxyHost}:$p" -ForegroundColor Green
                            Show-GitProxyCurrent
                        }
                    }
                }
                "3" {
                    Write-Host "正在取消全局 http.proxy / https.proxy ..." -ForegroundColor Yellow
                    Remove-GitProxy
                    Write-Host "已取消 Git 代理配置。" -ForegroundColor Green
                    Show-GitProxyCurrent
                }
                default {
                    Write-Host "无效选项，请输入 0-3。" -ForegroundColor Red
                }
            }
        }
        catch {
            Write-Host "错误: $_" -ForegroundColor Red
        }

        Write-Host ""
        $null = Read-Host "按 Enter 返回菜单"
    }
}

if ($null -eq $Arg -or $Arg -eq "") {
    Invoke-GitProxyInteractive
    exit 0
}

Invoke-GitProxyFromArg -Value $Arg
