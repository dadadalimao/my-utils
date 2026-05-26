# 终端 session：记录日志终端 PID，停止/重启时关闭旧窗口

function Get-JavaToolTerminalWindowTitle {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    "JavaTool-$ProjectId-$ModuleId"
}

function Wait-JavaToolConsoleBeforeClose {
    param([int] $ExitCode = 0)
    if ($ExitCode -ne 0) {
        Write-Host ">>> 退出码: $ExitCode" -ForegroundColor Red
    }
    if (-not $script:JavaToolAutoCloseTerminal) {
        Write-Host '>>> [调试] 已禁用自动关终端，请查看上方日志后手动关闭窗口' -ForegroundColor Yellow
    }
    else {
        Write-Host '>>> 按 Enter 关闭此窗口（也可在 GUI 点「停止」）' -ForegroundColor Gray
    }
    $null = Read-Host
}

function Initialize-JavaToolWinCloseType {
    if ('JavaToolWinClose' -as [type]) { return }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class JavaToolWinClose {
    public static string Target = "";
    public static int Closed = 0;
    public const uint WM_CLOSE = 0x0010;
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnum, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
    private static bool Callback(IntPtr hWnd, IntPtr lParam) {
        if (!IsWindowVisible(hWnd)) return true;
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, 512);
        if (sb.ToString().IndexOf(Target, StringComparison.OrdinalIgnoreCase) >= 0) {
            PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            Closed++;
        }
        return true;
    }
    public static void CloseMatching(string target) {
        Target = target ?? "";
        Closed = 0;
        EnumWindows(Callback, IntPtr.Zero);
    }
}
'@
}

function Close-JavaToolWindowsByTitleMarker {
    param([string] $Marker)
    if (-not $Marker) { return $false }
    Initialize-JavaToolWinCloseType
    [JavaToolWinClose]::CloseMatching($Marker)
    return [JavaToolWinClose]::Closed -gt 0
}

function Get-JavaToolServiceScriptPath {
    Join-Path $script:JavaToolRoot 'scripts\service.ps1'
}

function Start-JavaToolLogTerminal {
    param(
        [string] $ProjectId,
        [string] $ModuleId,
        [string] $PsExe,
        [string[]] $PsArgs
    )
    $launchArgs = @('-NoExit') + $PsArgs
    $proc = Start-Process -FilePath $PsExe -ArgumentList $launchArgs -WorkingDirectory $script:JavaToolRoot -PassThru
    Save-JavaToolSession -ProjectId $ProjectId -ModuleId $ModuleId -ShellPid $proc.Id -Kind 'console'
    return '控制台'
}

function Get-JavaToolSessionPath {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $key = Get-JavaToolInstanceKey -ProjectId $ProjectId -ModuleId $ModuleId
    Join-Path (Get-JavaToolSessionDir) "$key.session.json"
}

function Get-JavaToolLegacySessionPath {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    if ($ProjectId -ne 'stp') { return $null }
    $legacyDir = Join-Path $script:JavaToolRoot 'sessions'
    $legacy = Join-Path $legacyDir "$ModuleId.session.json"
    if (Test-Path $legacy) { return $legacy }
    $null
}

function Save-JavaToolSession {
    param(
        [string] $ProjectId,
        [string] $ModuleId,
        [int] $ShellPid,
        [string] $Kind = 'powershell'
    )
    @{
        projectId   = $ProjectId
        moduleId    = $ModuleId
        instanceKey = (Get-JavaToolInstanceKey -ProjectId $ProjectId -ModuleId $ModuleId)
        shellPid    = $ShellPid
        kind        = $Kind
        windowTitle = (Get-JavaToolTerminalWindowTitle -ProjectId $ProjectId -ModuleId $ModuleId)
        startedAt   = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content (Get-JavaToolSessionPath -ProjectId $ProjectId -ModuleId $ModuleId) -Encoding UTF8
}

function Get-JavaToolSession {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $path = Get-JavaToolSessionPath -ProjectId $ProjectId -ModuleId $ModuleId
    if (Test-Path $path) {
        try { return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    $legacy = Get-JavaToolLegacySessionPath -ProjectId $ProjectId -ModuleId $ModuleId
    if ($legacy) {
        try { return Get-Content $legacy -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    return $null
}

function Remove-JavaToolSession {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $path = Get-JavaToolSessionPath -ProjectId $ProjectId -ModuleId $ModuleId
    if (Test-Path $path) { Remove-Item $path -Force -ErrorAction SilentlyContinue }
    $legacy = Get-JavaToolLegacySessionPath -ProjectId $ProjectId -ModuleId $ModuleId
    if ($legacy -and (Test-Path $legacy)) { Remove-Item $legacy -Force -ErrorAction SilentlyContinue }
}

function Test-JavaToolSessionAlive {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $s = Get-JavaToolSession -ProjectId $ProjectId -ModuleId $ModuleId
    if (-not $s -or -not $s.shellPid) { return $false }
    return $null -ne (Get-Process -Id ([int]$s.shellPid) -ErrorAction SilentlyContinue)
}

function Get-JavaToolTerminalPids {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )

    $pids = [System.Collections.Generic.List[int]]::new()
    $s = Get-JavaToolSession -ProjectId $ProjectId -ModuleId $ModuleId
    if ($s -and $s.shellPid) { $pids.Add([int]$s.shellPid) }

    $serviceScript = Get-JavaToolServiceScriptPath
    $names = @('powershell.exe', 'pwsh.exe')
    foreach ($name in $names) {
        Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
            Where-Object {
                $cmd = $_.CommandLine
                $cmd -and (
                    $cmd -like "*service.ps1*" -or $cmd -like "*stp-service.ps1*"
                ) -and $cmd -like "*-Project*$ProjectId*" -and $cmd -like "*-Module*$ModuleId*"
            } |
            ForEach-Object { $pids.Add($_.ProcessId) }
    }
    $pids | Select-Object -Unique
}

function Close-JavaToolTerminalSession {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )

    if (-not $script:JavaToolAutoCloseTerminal) {
        return $false
    }

    $title = Get-JavaToolTerminalWindowTitle -ProjectId $ProjectId -ModuleId $ModuleId
    $closed = $false

    if (Close-JavaToolWindowsByTitleMarker -Marker $title) { $closed = $true }

    foreach ($shellPid in @(Get-JavaToolTerminalPids -ProjectId $ProjectId -ModuleId $ModuleId)) {
        if (-not (Get-Process -Id $shellPid -ErrorAction SilentlyContinue)) { continue }
        & taskkill.exe /PID $shellPid /T /F 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $closed = $true }
        else {
            try {
                Stop-Process -Id $shellPid -Force -ErrorAction SilentlyContinue
                $closed = $true
            }
            catch { }
        }
    }

    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle -like "*$title*" } |
        ForEach-Object {
            & taskkill.exe /PID $_.Id /T /F 2>$null | Out-Null
            $closed = $true
        }

    Start-Sleep -Milliseconds 300
    Remove-JavaToolSession -ProjectId $ProjectId -ModuleId $ModuleId
    return $closed
}
