# GUI 单实例（VBS / launch-gui 重复启动时激活已有窗口）

$script:JavaToolGuiWindowTitle = 'Java 本地服务管理'
$script:JavaToolGuiMutexName = 'Local\JavaToolGui_SingleInstance'

function Initialize-JavaToolGuiActivateType {
    if ('JavaToolGuiActivate' -as [type]) { return }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class JavaToolGuiActivate {
    public const int SW_RESTORE = 9;
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
}

function Invoke-JavaToolGuiActivateWindow {
    param([string] $Title = $script:JavaToolGuiWindowTitle)
    Initialize-JavaToolGuiActivateType
    $hwnd = [JavaToolGuiActivate]::FindWindow($null, $Title)
    if ($hwnd -eq [IntPtr]::Zero) { return $false }
    [void][JavaToolGuiActivate]::ShowWindow($hwnd, [JavaToolGuiActivate]::SW_RESTORE)
    [void][JavaToolGuiActivate]::SetForegroundWindow($hwnd)
    return $true
}

function Test-JavaToolGuiInstanceRunning {
    $mutex = $null
    try {
        $mutex = [System.Threading.Mutex]::OpenExisting($script:JavaToolGuiMutexName)
        return $true
    }
    catch [System.Threading.WaitHandleCannotBeOpenedException] {
        return $false
    }
    finally {
        if ($mutex) { $mutex.Dispose() }
    }
}

function Invoke-JavaToolGuiSingleInstanceOrActivate {
    $createdNew = $false
    try {
        $script:JavaToolGuiAppMutex = New-Object System.Threading.Mutex($false, $script:JavaToolGuiMutexName, [ref]$createdNew)
    }
    catch {
        Invoke-JavaToolGuiActivateWindow | Out-Null
        return $false
    }
    if (-not $createdNew) {
        Invoke-JavaToolGuiActivateWindow | Out-Null
        if ($script:JavaToolGuiAppMutex) {
            try { $script:JavaToolGuiAppMutex.Dispose() } catch { }
            $script:JavaToolGuiAppMutex = $null
        }
        return $false
    }
    return $true
}

function Release-JavaToolGuiSingleInstance {
    if (-not $script:JavaToolGuiAppMutex) { return }
    try { [void]$script:JavaToolGuiAppMutex.ReleaseMutex() } catch { }
    try { $script:JavaToolGuiAppMutex.Dispose() } catch { }
    $script:JavaToolGuiAppMutex = $null
}
