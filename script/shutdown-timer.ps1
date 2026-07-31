# 功能：定时关机（倒计时 / 指定时间），支持查看与取消当前预约
# 用法：pwsh -File script/shutdown-timer.ps1  或  . .\script\shutdown-timer.ps1; Invoke-ShutdownTimer

$ErrorActionPreference = 'Stop'

# 记录本工具发起的预约，便于「查看」；底层仍走系统 shutdown 命令
$script:ShutdownStatePath = Join-Path $env:LOCALAPPDATA 'my-utils\shutdown-schedule.json'

function Test-ShutdownTimerWindows {
    if ($PSVersionTable.PSVersion.Major -ge 6 -and $IsWindows -eq $false) {
        Write-Host '定时关机仅支持 Windows' -ForegroundColor Red
        return $false
    }
    return $true
}

<#
.SYNOPSIS
读取本工具保存的预约状态；已过期则清理并返回 $null。
#>
function Get-ShutdownScheduleState {
    if (-not (Test-Path -LiteralPath $script:ShutdownStatePath)) {
        return $null
    }

    try {
        $raw = Get-Content -LiteralPath $script:ShutdownStatePath -Raw -Encoding UTF8
        $state = $raw | ConvertFrom-Json
    }
    catch {
        Remove-Item -LiteralPath $script:ShutdownStatePath -Force -ErrorAction SilentlyContinue
        return $null
    }

    $shutdownAt = [datetime]::Parse($state.ShutdownAt, [cultureinfo]::InvariantCulture)
    if ($shutdownAt -le (Get-Date)) {
        Clear-ShutdownScheduleState
        return $null
    }

    return [PSCustomObject]@{
        Mode       = [string]$state.Mode
        Seconds    = [int]$state.Seconds
        ShutdownAt = $shutdownAt
        CreatedAt  = [datetime]::Parse($state.CreatedAt, [cultureinfo]::InvariantCulture)
    }
}

function Save-ShutdownScheduleState {
    param(
        [Parameter(Mandatory)][ValidateSet('countdown', 'at')][string]$Mode,
        [Parameter(Mandatory)][int]$Seconds,
        [Parameter(Mandatory)][datetime]$ShutdownAt
    )

    $dir = Split-Path -Parent $script:ShutdownStatePath
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $payload = [ordered]@{
        Mode       = $Mode
        Seconds    = $Seconds
        ShutdownAt = $ShutdownAt.ToString('o')
        CreatedAt  = (Get-Date).ToString('o')
    }
    ($payload | ConvertTo-Json) | Set-Content -LiteralPath $script:ShutdownStatePath -Encoding UTF8
}

function Clear-ShutdownScheduleState {
    if (Test-Path -LiteralPath $script:ShutdownStatePath) {
        Remove-Item -LiteralPath $script:ShutdownStatePath -Force -ErrorAction SilentlyContinue
    }
}

<#
.SYNOPSIS
解析倒计时输入，支持：纯分钟数、1h30m、90m、1:30（时:分）。
.OUTPUTS
总秒数；无效时返回 -1。
#>
function ConvertTo-CountdownSeconds {
    param([Parameter(Mandatory)][string]$InputText)

    $text = $InputText.Trim().ToLowerInvariant()
    if ($text -eq '') { return -1 }

    # 纯数字：按分钟
    if ($text -match '^\d+$') {
        $minutes = [int]$text
        if ($minutes -le 0) { return -1 }
        return $minutes * 60
    }

    # 时:分，如 1:30
    if ($text -match '^(\d+):([0-5]?\d)$') {
        $hours = [int]$Matches[1]
        $minutes = [int]$Matches[2]
        $total = $hours * 3600 + $minutes * 60
        if ($total -le 0) { return -1 }
        return $total
    }

    # 组合：1h30m / 90m / 2h
    if ($text -match '^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$') {
        $hours = if ($Matches[1]) { [int]$Matches[1] } else { 0 }
        $minutes = if ($Matches[2]) { [int]$Matches[2] } else { 0 }
        if (-not $Matches[1] -and -not $Matches[2]) { return -1 }
        $total = $hours * 3600 + $minutes * 60
        if ($total -le 0) { return -1 }
        return $total
    }

    return -1
}

<#
.SYNOPSIS
解析指定关机时间。支持：HH:mm、今天/明天 HH:mm、yyyy-MM-dd HH:mm。
.DESCRIPTION
仅写时刻且已过：默认滚到次日。
#>
function ConvertTo-ShutdownDateTime {
    param([Parameter(Mandatory)][string]$InputText)

    $text = $InputText.Trim()
    if ($text -eq '') { return $null }

    $now = Get-Date
    $culture = [cultureinfo]::InvariantCulture

    # yyyy-MM-dd HH:mm 或 yyyy/MM/dd HH:mm
    if ($text -match '^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})$') {
        $dt = Get-Date -Year ([int]$Matches[1]) -Month ([int]$Matches[2]) -Day ([int]$Matches[3]) `
            -Hour ([int]$Matches[4]) -Minute ([int]$Matches[5]) -Second 0
        return $dt
    }

    # 今天/明天 HH:mm
    if ($text -match '^(今天|明天)\s+(\d{1,2}):(\d{2})$') {
        $base = if ($Matches[1] -eq '今天') { $now.Date } else { $now.Date.AddDays(1) }
        return $base.AddHours([int]$Matches[2]).AddMinutes([int]$Matches[3])
    }

    # HH:mm（已过则次日）
    if ($text -match '^(\d{1,2}):(\d{2})$') {
        $dt = $now.Date.AddHours([int]$Matches[1]).AddMinutes([int]$Matches[2])
        if ($dt -le $now) {
            $dt = $dt.AddDays(1)
        }
        return $dt
    }

    # 兜底：尝试 .NET 解析
    try {
        return [datetime]::Parse($text, $culture, [System.Globalization.DateTimeStyles]::AssumeLocal)
    }
    catch {
        return $null
    }
}

function Format-Duration {
    param([Parameter(Mandatory)][int]$Seconds)

    if ($Seconds -lt 0) { $Seconds = 0 }
    $ts = [TimeSpan]::FromSeconds($Seconds)
    if ($ts.TotalHours -ge 1) {
        return ('{0} 小时 {1} 分 {2} 秒' -f [int][math]::Floor($ts.TotalHours), $ts.Minutes, $ts.Seconds)
    }
    if ($ts.TotalMinutes -ge 1) {
        return ('{0} 分 {1} 秒' -f [int][math]::Floor($ts.TotalMinutes), $ts.Seconds)
    }
    return ('{0} 秒' -f $ts.Seconds)
}

<#
.SYNOPSIS
调用系统 shutdown 预约关机。
.DESCRIPTION
Windows 同一时间仅允许一个关机预约，新预约会覆盖旧预约。
#>
function Start-SystemShutdown {
    param(
        [Parameter(Mandatory)][int]$Seconds,
        [Parameter(Mandatory)][ValidateSet('countdown', 'at')][string]$Mode,
        [Parameter(Mandatory)][datetime]$ShutdownAt
    )

    # shutdown /t 上限约 10 年
    if ($Seconds -lt 1 -or $Seconds -gt 315360000) {
        Write-Host '倒计时秒数超出系统允许范围 (1 ~ 315360000)' -ForegroundColor Red
        return $false
    }

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & shutdown.exe /s /t $Seconds /c "my-utils 定时关机" 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    if ($exitCode -ne 0) {
        Write-Host "预约失败 (exit=$exitCode): $output" -ForegroundColor Red
        return $false
    }

    Save-ShutdownScheduleState -Mode $Mode -Seconds $Seconds -ShutdownAt $ShutdownAt
    Write-Host "已预约关机：$($ShutdownAt.ToString('yyyy-MM-dd HH:mm:ss'))（剩余 $(Format-Duration -Seconds $Seconds)）" -ForegroundColor Green
    return $true
}

function Show-ShutdownSchedule {
    $state = Get-ShutdownScheduleState
    if ($null -eq $state) {
        Write-Host '当前没有本工具记录的关机预约' -ForegroundColor Yellow
        Write-Host '（若曾用其他方式执行 shutdown，此处不会显示）' -ForegroundColor DarkGray
        return
    }

    $remain = [int][math]::Ceiling(($state.ShutdownAt - (Get-Date)).TotalSeconds)
    $modeText = if ($state.Mode -eq 'at') { '指定时间' } else { '倒计时' }

    Write-Host ''
    Write-Host '当前预约：' -ForegroundColor Cyan
    Write-Host "  模式     : $modeText"
    Write-Host "  关机时间 : $($state.ShutdownAt.ToString('yyyy-MM-dd HH:mm:ss'))"
    Write-Host "  剩余时间 : $(Format-Duration -Seconds $remain)"
    Write-Host "  创建于   : $($state.CreatedAt.ToString('yyyy-MM-dd HH:mm:ss'))"
}

function Stop-ScheduledShutdown {
    $hadState = $null -ne (Get-ShutdownScheduleState)

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & shutdown.exe /a 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    Clear-ShutdownScheduleState

    # 1116：没有正在进行的关机操作
    if ($exitCode -eq 0) {
        Write-Host '已取消关机预约' -ForegroundColor Green
    }
    elseif ($exitCode -eq 1116) {
        if ($hadState) {
            Write-Host '本地记录已清除；系统侧当前无待执行的关机' -ForegroundColor Yellow
        }
        else {
            Write-Host '当前没有可取消的关机预约' -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "取消失败 (exit=$exitCode): $output" -ForegroundColor Red
        return
    }

    # 避免把 shutdown.exe 的非零码留给宿主进程
    $global:LASTEXITCODE = 0
}

function Test-ShutdownConfirm {
    param([string]$Answer)
    return ($Answer -eq '' -or $Answer -match '^(?i)(y|yes|是)$')
}

function Invoke-CountdownShutdown {
    Write-Host ''
    Write-Host '输入倒计时（例：30 / 90m / 1h30m / 1:30）：' -NoNewline -ForegroundColor Yellow
    $raw = (Read-Host).Trim()
    if ($raw -eq '' -or $raw -match '^(?i)q$') {
        Write-Host '已取消输入' -ForegroundColor DarkGray
        return
    }

    $seconds = ConvertTo-CountdownSeconds -InputText $raw
    if ($seconds -lt 1) {
        Write-Host '无法识别的倒计时格式' -ForegroundColor Red
        return
    }

    $shutdownAt = (Get-Date).AddSeconds($seconds)
    Write-Host "将在 $(Format-Duration -Seconds $seconds) 后关机（$($shutdownAt.ToString('HH:mm:ss'))），确认？[Y/n]：" -NoNewline -ForegroundColor Yellow
    $confirm = (Read-Host).Trim()
    if (-not (Test-ShutdownConfirm -Answer $confirm)) {
        Write-Host '已放弃' -ForegroundColor DarkGray
        return
    }

    [void](Start-SystemShutdown -Seconds $seconds -Mode countdown -ShutdownAt $shutdownAt)
}

function Invoke-AtTimeShutdown {
    Write-Host ''
    Write-Host '输入关机时间（例：23:30 / 今天 23:30 / 明天 08:00 / 2026-07-23 01:00）：' -NoNewline -ForegroundColor Yellow
    $raw = (Read-Host).Trim()
    if ($raw -eq '' -or $raw -match '^(?i)q$') {
        Write-Host '已取消输入' -ForegroundColor DarkGray
        return
    }

    $shutdownAt = ConvertTo-ShutdownDateTime -InputText $raw
    if ($null -eq $shutdownAt) {
        Write-Host '无法识别的时间格式' -ForegroundColor Red
        return
    }

    $seconds = [int][math]::Ceiling(($shutdownAt - (Get-Date)).TotalSeconds)
    if ($seconds -lt 1) {
        Write-Host '目标时间必须晚于当前时间' -ForegroundColor Red
        return
    }

    Write-Host "将于 $($shutdownAt.ToString('yyyy-MM-dd HH:mm:ss')) 关机（剩余 $(Format-Duration -Seconds $seconds)），确认？[Y/n]：" -NoNewline -ForegroundColor Yellow
    $confirm = (Read-Host).Trim()
    if (-not (Test-ShutdownConfirm -Answer $confirm)) {
        Write-Host '已放弃' -ForegroundColor DarkGray
        return
    }

    [void](Start-SystemShutdown -Seconds $seconds -Mode at -ShutdownAt $shutdownAt)
}

function Show-ShutdownTimerMenu {
    Write-Host ''
    Write-Host '===========================================' -ForegroundColor Cyan
    Write-Host '定时关机' -ForegroundColor Cyan
    Write-Host '===========================================' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '[1] ' -NoNewline -ForegroundColor Yellow; Write-Host '倒计时关机'
    Write-Host '[2] ' -NoNewline -ForegroundColor Yellow; Write-Host '指定时间关机'
    Write-Host '[3] ' -NoNewline -ForegroundColor Yellow; Write-Host '查看当前预约'
    Write-Host '[4] ' -NoNewline -ForegroundColor Yellow; Write-Host '取消预约'
    Write-Host ''
    Write-Host '[0] 退出' -ForegroundColor Yellow
    Write-Host ''
}

function Invoke-ShutdownTimer {
    if (-not (Test-ShutdownTimerWindows)) { return }

    while ($true) {
        Show-ShutdownTimerMenu
        Write-Host '请选择: ' -NoNewline -ForegroundColor Yellow
        $choice = (Read-Host).Trim()

        switch -Regex ($choice) {
            '^(0|q)$' {
                Write-Host '已退出' -ForegroundColor Green
                return
            }
            '^1$' { Invoke-CountdownShutdown }
            '^2$' { Invoke-AtTimeShutdown }
            '^3$' { Show-ShutdownSchedule }
            '^4$' { Stop-ScheduledShutdown }
            default { Write-Host '无效选项，请输入 0-4' -ForegroundColor Red }
        }
    }
}

# 直接执行脚本时进入菜单；被 dot-source 时仅加载函数
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-ShutdownTimer
}