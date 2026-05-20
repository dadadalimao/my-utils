# 智慧水务后端启动 - 共享核心逻辑（CLI / GUI 共用）

# 停止/重启/再次启动时是否自动关闭日志终端（可由 config.local.json / GUI 覆盖）
$script:StpAutoCloseTerminal = $true

$script:StpDefaultProjectRoot = 'E:\sxhwork\java\sewage-treatment-plant-service'

$script:StpModuleConfig = @{
    admin = @{
        Label        = '管理端 API'
        GradleTask   = ':admin:bootJar'
        JarRelPath   = 'admin\build\libs\admin.jar'
        Port         = 8080
        WatchModules = @('admin', 'dao', 'common', 'attachment')
    }
    'prec-aer' = @{
        Label        = '曝气服务'
        GradleTask   = ':prec-aer:bootJar'
        JarRelPath   = 'prec-aer\build\libs\prec-aer.jar'
        Port         = $null
        WatchModules = @('prec-aer', 'dao', 'common')
    }
}

function Get-StpConfigFile {
    Join-Path $PSScriptRoot 'config.local.json'
}

function Get-StpSavedProjectRoot {
    $file = Get-StpConfigFile
    if (-not (Test-Path $file)) { return $script:StpDefaultProjectRoot }
    try {
        $json = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.projectRoot -and (Test-Path $json.projectRoot)) {
            return $json.projectRoot
        }
    }
    catch { }
    return $script:StpDefaultProjectRoot
}

function Get-StpLocalConfig {
  $cfg = [ordered]@{
    projectRoot       = $script:StpDefaultProjectRoot
    autoCloseTerminal = $true
  }
  $file = Get-StpConfigFile
  if (-not (Test-Path $file)) { return $cfg }
  try {
    $j = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($j.projectRoot) { $cfg.projectRoot = [string]$j.projectRoot }
    if ($null -ne $j.autoCloseTerminal) { $cfg.autoCloseTerminal = [bool]$j.autoCloseTerminal }
  }
  catch { }
  return $cfg
}

function Save-StpLocalConfig {
  param([hashtable] $Patch)
  $cfg = Get-StpLocalConfig
  foreach ($key in $Patch.Keys) { $cfg[$key] = $Patch[$key] }
  [ordered]@{
    projectRoot       = $cfg.projectRoot
    autoCloseTerminal = [bool]$cfg.autoCloseTerminal
  } | ConvertTo-Json | Set-Content (Get-StpConfigFile) -Encoding UTF8
}

function Set-StpSavedProjectRoot {
  param([string] $ProjectRoot)
  Save-StpLocalConfig @{ projectRoot = $ProjectRoot }
}

function Set-StpAutoCloseTerminalPreference {
  param([bool] $Enabled)
  $script:StpAutoCloseTerminal = $Enabled
  Save-StpLocalConfig @{ autoCloseTerminal = $Enabled }
}

function Initialize-StpFromLocalConfig {
  $cfg = Get-StpLocalConfig
  $script:StpAutoCloseTerminal = [bool]$cfg.autoCloseTerminal
}

# ---------------------------------------------------------------------------
# GUI 单实例（VBS / launch-gui 重复启动时激活已有窗口）
# ---------------------------------------------------------------------------

$script:StpGuiWindowTitle = '智慧水务后端 · 终端管理'
$script:StpGuiMutexName = 'Local\StpJavaToolGui_SingleInstance'

function Initialize-StpGuiActivateType {
    if ('StpGuiActivate' -as [type]) { return }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class StpGuiActivate {
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

function Invoke-StpGuiActivateWindow {
    param([string] $Title = $script:StpGuiWindowTitle)
    Initialize-StpGuiActivateType
    $hwnd = [StpGuiActivate]::FindWindow($null, $Title)
    if ($hwnd -eq [IntPtr]::Zero) { return $false }
    [void][StpGuiActivate]::ShowWindow($hwnd, [StpGuiActivate]::SW_RESTORE)
    [void][StpGuiActivate]::SetForegroundWindow($hwnd)
    return $true
}

function Test-StpGuiInstanceRunning {
    $mutex = $null
    try {
        $mutex = [System.Threading.Mutex]::OpenExisting($script:StpGuiMutexName)
        return $true
    }
    catch [System.Threading.WaitHandleCannotBeOpenedException] {
        return $false
    }
    finally {
        if ($mutex) { $mutex.Dispose() }
    }
}

function Invoke-StpGuiSingleInstanceOrActivate {
    $createdNew = $false
    try {
        $script:StpGuiAppMutex = New-Object System.Threading.Mutex($false, $script:StpGuiMutexName, [ref]$createdNew)
    }
    catch {
        Invoke-StpGuiActivateWindow | Out-Null
        return $false
    }
    if (-not $createdNew) {
        Invoke-StpGuiActivateWindow | Out-Null
        if ($script:StpGuiAppMutex) {
            try { $script:StpGuiAppMutex.Dispose() } catch { }
            $script:StpGuiAppMutex = $null
        }
        return $false
    }
    return $true
}

function Release-StpGuiSingleInstance {
    if (-not $script:StpGuiAppMutex) { return }
    try { [void]$script:StpGuiAppMutex.ReleaseMutex() } catch { }
    try { $script:StpGuiAppMutex.Dispose() } catch { }
    $script:StpGuiAppMutex = $null
}

# ---------------------------------------------------------------------------
# 终端 session（GUI 方案 A：记录日志终端 PID，停止/重启时关闭旧窗口）
# ---------------------------------------------------------------------------

function Get-StpTerminalWindowTitle {
    param([string] $ModuleName)
    "STP-GUI-$ModuleName"
}

# 终端模式结束时等待按键（不可对终端模式使用 exit，否则会无视 -NoExit 直接关窗）
function Wait-StpConsoleBeforeClose {
    param([int] $ExitCode = 0)
    if ($ExitCode -ne 0) {
        Write-Host ">>> 退出码: $ExitCode" -ForegroundColor Red
    }
    if (-not $script:StpAutoCloseTerminal) {
        Write-Host '>>> [调试] 已禁用自动关终端，请查看上方日志后手动关闭窗口' -ForegroundColor Yellow
    }
    else {
        Write-Host '>>> 按 Enter 关闭此窗口（也可在 GUI 点「停止」）' -ForegroundColor Gray
    }
    $null = Read-Host
}

function Initialize-StpWinCloseType {
    if ('StpWinClose' -as [type]) { return }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class StpWinClose {
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

# 向匹配标题的窗口发送 WM_CLOSE（适用于独立控制台；WT 标题栏含标签名时亦有效）
function Close-StpWindowsByTitleMarker {
    param([string] $Marker)
    if (-not $Marker) { return $false }
    Initialize-StpWinCloseType
    [StpWinClose]::CloseMatching($Marker)
    return [StpWinClose]::Closed -gt 0
}

# 独立控制台启动（Start-Process 传参数组，避免 cmd 拆坏 -Profile dao,dev 等含逗号参数）
function Start-StpLogTerminal {
    param(
        [string] $ModuleName,
        [string] $PsExe,
        [string[]] $PsArgs
    )
    # -NoExit：编译失败/异常时保留窗口；正常停止由 GUI Close-StpTerminalSession 关闭
    $launchArgs = @('-NoExit') + $PsArgs
    $proc = Start-Process -FilePath $PsExe -ArgumentList $launchArgs -WorkingDirectory $PSScriptRoot -PassThru
    Save-StpSession -ModuleName $ModuleName -ShellPid $proc.Id -Kind 'console'
    return '控制台'
}

function Get-StpSessionDir {
    $dir = Join-Path $PSScriptRoot 'sessions'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $dir
}

function Get-StpSessionPath {
    param([string] $ModuleName)
    Join-Path (Get-StpSessionDir) "$ModuleName.session.json"
}

function Save-StpSession {
    param(
        [string] $ModuleName,
        [int] $ShellPid,
        [string] $Kind = 'powershell'
    )
    @{
        module      = $ModuleName
        shellPid    = $ShellPid
        kind        = $Kind
        windowTitle = (Get-StpTerminalWindowTitle -ModuleName $ModuleName)
        startedAt   = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content (Get-StpSessionPath -ModuleName $ModuleName) -Encoding UTF8
}

function Get-StpSession {
    param([string] $ModuleName)
    $path = Get-StpSessionPath -ModuleName $ModuleName
    if (-not (Test-Path $path)) { return $null }
    try { return Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return $null }
}

function Remove-StpSession {
    param([string] $ModuleName)
    $path = Get-StpSessionPath -ModuleName $ModuleName
    if (Test-Path $path) { Remove-Item $path -Force -ErrorAction SilentlyContinue }
}

function Test-StpSessionAlive {
    param([string] $ModuleName)
    $s = Get-StpSession -ModuleName $ModuleName
    if (-not $s -or -not $s.shellPid) { return $false }
    return $null -ne (Get-Process -Id ([int]$s.shellPid) -ErrorAction SilentlyContinue)
}

# 按 session 或命令行匹配 stp-service.ps1 的终端进程 PID
function Get-StpTerminalPids {
    param([string] $ModuleName)

    $pids = [System.Collections.Generic.List[int]]::new()
    $s = Get-StpSession -ModuleName $ModuleName
    if ($s -and $s.shellPid) { $pids.Add([int]$s.shellPid) }

    $names = @('powershell.exe', 'pwsh.exe')
    foreach ($name in $names) {
        Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
            Where-Object {
                $cmd = $_.CommandLine
                $cmd -and $cmd -like '*stp-service.ps1*' -and $cmd -like "*-Module*$ModuleName*"
            } |
            ForEach-Object { $pids.Add($_.ProcessId) }
    }
    $pids | Select-Object -Unique
}

# 关闭该模块对应的日志终端窗口，并清除 session
function Close-StpTerminalSession {
    param([string] $ModuleName)

    if (-not $script:StpAutoCloseTerminal) {
        return $false
    }

    $title = Get-StpTerminalWindowTitle -ModuleName $ModuleName
    $closed = $false

    if (Close-StpWindowsByTitleMarker -Marker $title) { $closed = $true }

    foreach ($shellPid in @(Get-StpTerminalPids -ModuleName $ModuleName)) {
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
    Remove-StpSession -ModuleName $ModuleName
    return $closed
}

function Get-StpJavaExe {
    if ($env:JAVA_HOME) {
        $javaExe = Join-Path $env:JAVA_HOME 'bin\java.exe'
        if (Test-Path $javaExe) { return $javaExe }
        throw "JAVA_HOME 无效: $env:JAVA_HOME"
    }
    $javaCmd = Get-Command java -ErrorAction SilentlyContinue
    if ($javaCmd) { return $javaCmd.Source }
    throw '未找到 Java：请安装 JDK 11 并设置 JAVA_HOME 或将 java 加入 PATH'
}

function Update-StpLatestWriteTime {
    param(
        [ref] $Latest,
        [System.IO.FileSystemInfo[]] $Items
    )
    foreach ($item in $Items) {
        if ($item.LastWriteTime -gt $Latest.Value) {
            $Latest.Value = $item.LastWriteTime
        }
    }
}

function Get-StpLatestWriteTime {
    param(
        [string[]] $ModuleNames,
        [string] $Root,
        [string[]] $AdditionalPaths = @()
    )

    $latest = [datetime]::MinValue
    $latestRef = [ref]$latest
    $fileCount = 0

    foreach ($mod in $ModuleNames) {
        $modDir = Join-Path $Root $mod
        if (-not (Test-Path $modDir)) { continue }

        $javaDir = Join-Path $modDir 'src\main\java'
        if (Test-Path $javaDir) {
            $javaFiles = @(Get-ChildItem -Path $javaDir -Filter '*.java' -Recurse -File -ErrorAction SilentlyContinue)
            $fileCount += $javaFiles.Count
            Update-StpLatestWriteTime -Latest $latestRef -Items $javaFiles
        }

        $resDir = Join-Path $modDir 'src\main\resources'
        if (Test-Path $resDir) {
            $resFiles = @(Get-ChildItem -Path $resDir -Recurse -File -ErrorAction SilentlyContinue)
            $fileCount += $resFiles.Count
            Update-StpLatestWriteTime -Latest $latestRef -Items $resFiles
        }

        $modGradle = Join-Path $modDir 'build.gradle'
        if (Test-Path $modGradle) {
            $fileCount++
            Update-StpLatestWriteTime -Latest $latestRef -Items @(Get-Item $modGradle)
        }
    }

    foreach ($f in @('build.gradle', 'settings.gradle', 'gradle.properties')) {
        $p = Join-Path $Root $f
        if (Test-Path $p) {
            $fileCount++
            Update-StpLatestWriteTime -Latest $latestRef -Items @(Get-Item $p)
        }
    }

    foreach ($rel in $AdditionalPaths) {
        $p = if ([IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $Root $rel }
        if (-not (Test-Path $p)) { continue }
        if ((Get-Item $p).PSIsContainer) {
            $extra = @(Get-ChildItem -Path $p -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -notmatch '\\build\\|\\\.gradle\\|\\.git\\' })
            $fileCount += $extra.Count
            Update-StpLatestWriteTime -Latest $latestRef -Items $extra
        }
        else {
            $fileCount++
            Update-StpLatestWriteTime -Latest $latestRef -Items @(Get-Item $p)
        }
    }

    return @{ Latest = $latestRef.Value; FileCount = $fileCount }
}

function Test-StpNeedBuild {
    param(
        [string] $JarPath,
        [string[]] $WatchModules,
        [string] $Root,
        [string[]] $AdditionalPaths = @()
    )

    if (-not (Test-Path $JarPath)) {
        return @{ NeedBuild = $true; Reason = 'jar 不存在，需要编译' }
    }

    $scan = Get-StpLatestWriteTime -ModuleNames $WatchModules -Root $Root -AdditionalPaths $AdditionalPaths
    $srcTime = $scan.Latest
    $jarTime = (Get-Item $JarPath).LastWriteTime
    $threshold = [TimeSpan]::FromSeconds(1)

    if ($scan.FileCount -eq 0) {
        return @{
            NeedBuild = $true
            Reason    = '未扫描到源码/配置，建议编译'
        }
    }

    if (($srcTime - $jarTime) -gt $threshold) {
        return @{
            NeedBuild        = $true
            Reason           = "源码/配置已更新 ($($srcTime.ToString('yyyy-MM-dd HH:mm:ss')) > $($jarTime.ToString('yyyy-MM-dd HH:mm:ss')))"
            LatestSourceTime = $srcTime
            JarTime          = $jarTime
        }
    }

    return @{
        NeedBuild        = $false
        Reason           = "无变更（源码最新 $($srcTime.ToString('HH:mm:ss'))，Jar $($jarTime.ToString('HH:mm:ss'))）"
        LatestSourceTime = $srcTime
        JarTime          = $jarTime
    }
}

function Test-StpPortListening {
    param([int] $Port)
    if (-not $Port) { return $false }
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# 返回仍在运行的模块列表（端口监听或日志终端 session 存活）
function Get-StpRunningModules {
    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($entry in $script:StpModuleConfig.GetEnumerator()) {
        $name = $entry.Key
        $cfg = $entry.Value
        $running = $false
        if ($cfg.Port -and (Test-StpPortListening -Port $cfg.Port)) {
            $running = $true
        }
        elseif (Test-StpSessionAlive -ModuleName $name) {
            $running = $true
        }
        if ($running) {
            $list.Add([pscustomobject]@{
                Name  = $name
                Label = $cfg.Label
                Port  = $cfg.Port
            })
        }
    }
    return @($list)
}

function Stop-StpPort {
    param(
        [int] $Port,
        [scriptblock] $OnLog
    )

    if (-not $Port) { return $false }

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        & $OnLog "端口 $Port 无监听进程"
        return $false
    }

    foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            & $OnLog "结束进程: $($proc.ProcessName) (PID $procId)"
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 800
    return $true
}

function Stop-StpModule {
    param(
        [string] $ModuleName,
        [scriptblock] $OnLog = { param($m) Write-Host $m }
    )

    $cfg = $script:StpModuleConfig[$ModuleName]
    if ($cfg.Port) {
        Stop-StpPort -Port $cfg.Port -OnLog $OnLog | Out-Null
    }
}

function Invoke-StpGradleBuild {
    param(
        [string] $ProjectRoot,
        [string] $GradleTask,
        [scriptblock] $OnLog,
        [System.Threading.CancellationToken] $CancelToken = [System.Threading.CancellationToken]::None,
        [bool] $Foreground = $false
    )

    $gradlew = Join-Path $ProjectRoot 'gradlew.bat'
    if (-not (Test-Path $gradlew)) { throw "未找到 gradlew.bat: $gradlew" }

    & $OnLog ">>> 编译: $GradleTask -x test"

    # 终端模式：Gradle 直接输出到当前控制台，避免重定向 + 异步事件在 Stop 下导致宿主闪退
    if ($Foreground) {
        Push-Location $ProjectRoot
        try {
            & $gradlew $GradleTask '-x', 'test', '--console=plain'
            $code = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } else { 0 }
            if ($code -ne 0) {
                throw "Gradle 编译失败，退出码 $code"
            }
        }
        finally {
            Pop-Location
        }
        & $OnLog '>>> 编译完成'
        return
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $gradlew
    $psi.Arguments = "$GradleTask -x test --console=plain"
    $psi.WorkingDirectory = $ProjectRoot
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8

    $proc = [System.Diagnostics.Process]::Start($psi)
    if (-not $proc) {
        throw "无法启动 Gradle: $gradlew"
    }

    $logLine = {
        param($Line)
        try {
            if ($null -ne $Line -and $Line.Length -gt 0) { & $OnLog $Line }
        }
        catch { }
    }
    $proc.add_OutputDataReceived({
        param($sender, $e)
        & $logLine $e.Data
    })
    $proc.add_ErrorDataReceived({
        param($sender, $e)
        & $logLine $e.Data
    })
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()

    while (-not $proc.HasExited) {
        if ($CancelToken.IsCancellationRequested) {
            try { $proc.Kill($true) } catch { }
            throw '编译已取消'
        }
        Start-Sleep -Milliseconds 200
    }
    $proc.WaitForExit()
    try { $proc.CancelOutputRead() } catch { }
    try { $proc.CancelErrorRead() } catch { }

    if ($proc.ExitCode -ne 0) {
        throw "Gradle 编译失败，退出码 $($proc.ExitCode)"
    }
    & $OnLog '>>> 编译完成'
}

function Start-StpJavaForeground {
    param(
        [string] $JavaExe,
        [string] $JarPath,
        [string] $ProfileOverride,
        [bool] $SpringDebug,
        [scriptblock] $OnLog
    )

    $argList = @(
        '-Dfile.encoding=UTF-8',
        '-Dspring.output.ansi.enabled=ALWAYS',
        '-jar', $JarPath
    )
    if ($ProfileOverride) { $argList += "--spring.profiles.active=$ProfileOverride" }
    if ($SpringDebug) { $argList += '--debug' }

    & $OnLog ">>> 启动: $JavaExe $($argList -join ' ')"
    & $OnLog '>>> 日志输出在当前终端，Ctrl+C 可停止'
    & $OnLog '>>> 上下文初始化后若长时间停住，多在连 Redis/RabbitMQ，请确认 192.168.1.121 / 10.0.0.50 可达'

    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
    }
    catch { }

    # 不用 2>&1 管道，避免 PowerShell 管道提前结束导致“日志断掉、进程还在/已死看不清”
    $proc = Start-Process -FilePath $JavaExe -ArgumentList $argList -Wait -NoNewWindow -PassThru
    $code = if ($proc) { $proc.ExitCode } else { -1 }
    & $OnLog ">>> Java 进程已结束，退出码: $code"
    $global:LASTEXITCODE = $code
    return $null
}

function Start-StpBootRunForeground {
    param(
        [string] $ProjectRoot,
        [string] $GradleTask,
        [string] $ProfileOverride,
        [bool] $SpringDebug,
        [scriptblock] $OnLog
    )

    $gradlew = Join-Path $ProjectRoot 'gradlew.bat'
    if (-not (Test-Path $gradlew)) { throw "未找到 gradlew.bat: $gradlew" }

    $springArgs = if ($ProfileOverride) { "--spring.profiles.active=$ProfileOverride" } else { '' }
    if ($SpringDebug) { $springArgs = if ($springArgs) { "$springArgs --debug" } else { '--debug' } }

    $gArgs = @($GradleTask, '-x', 'test', '--console=plain')
    if ($springArgs) {
        $gArgs += @('--args', $springArgs)
    }

    & $OnLog ">>> bootRun（终端日志更完整）: $gradlew $($gArgs -join ' ')"
    & $OnLog '>>> Ctrl+C 可停止'

    Push-Location $ProjectRoot
    try {
        & $gradlew @gArgs
        $global:LASTEXITCODE = $LASTEXITCODE
        & $OnLog ">>> bootRun 已结束，退出码: $LASTEXITCODE"
    }
    finally {
        Pop-Location
    }
    return $null
}

function Start-StpJavaProcess {
    param(
        [string] $JavaExe,
        [string] $JarPath,
        [string] $ProfileOverride,
        [scriptblock] $OnLog
    )

    $args = "-Dfile.encoding=UTF-8 -jar `"$JarPath`""
    if ($ProfileOverride) { $args += " --spring.profiles.active=$ProfileOverride" }

    & $OnLog ">>> 启动: $JavaExe $args"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $JavaExe
    $psi.Arguments = $args
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8

    $proc = [System.Diagnostics.Process]::Start($psi)
    if (-not $proc) {
        throw "无法启动 Java 进程: $JavaExe"
    }

    $writeLine = {
        param($line, $isErr)
        if ($line) { & $OnLog $(if ($isErr) { "[ERR] $line" } else { $line }) }
    }

    $proc.add_OutputDataReceived({ & $writeLine $_.Data $false })
    $proc.add_ErrorDataReceived({ & $writeLine $_.Data $true })
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()

    return $proc
}

function Invoke-StpStart {
    param(
        [string] $ModuleName,
        [string] $ProjectRoot,
        [string] $Profile,
        [bool] $Force,
        [bool] $SkipBuild,
        [bool] $BuildOnly,
        [bool] $KillPortBeforeStart,
        [bool] $UseConsole,
        [bool] $UseBootRun,
        [bool] $SpringDebug,
        [scriptblock] $OnLog,
        [ref] $RunningProcess,
        [System.Threading.CancellationToken] $CancelToken = [System.Threading.CancellationToken]::None
    )

    if (-not (Test-Path $ProjectRoot)) {
        throw "项目目录不存在: $ProjectRoot"
    }

    $cfg = $script:StpModuleConfig[$ModuleName]
    $jarPath = Join-Path $ProjectRoot $cfg.JarRelPath
    $javaExe = Get-StpJavaExe

    & $OnLog "模块: $ModuleName - $($cfg.Label)"
    & $OnLog "Jar : $jarPath"

    $needBuild = $true
    if ($Force) {
        $needBuild = $true
        & $OnLog '>>> 强制编译'
    }
    elseif ($SkipBuild) {
        if (-not (Test-Path $jarPath)) { throw "jar 不存在: $jarPath" }
        $needBuild = $false
        & $OnLog '>>> 跳过编译'
    }
    else {
        $r = Test-StpNeedBuild -JarPath $jarPath -WatchModules $cfg.WatchModules -Root $ProjectRoot
        $needBuild = $r.NeedBuild
        & $OnLog ">>> $($r.Reason)"
    }

    $runTask = $cfg.GradleTask -replace ':bootJar$', ':bootRun'

    # bootRun 模式：由 Gradle 负责编译并启动，终端日志最完整
    if ($UseConsole -and $UseBootRun -and -not $BuildOnly) {
        if ($KillPortBeforeStart -and $cfg.Port) {
            Stop-StpPort -Port $cfg.Port -OnLog $OnLog | Out-Null
        }
        $null = Start-StpBootRunForeground -ProjectRoot $ProjectRoot -GradleTask $runTask `
            -ProfileOverride $Profile -SpringDebug:$SpringDebug -OnLog $OnLog
        $RunningProcess.Value = $null
        return $null
    }

    if ($needBuild) {
        Invoke-StpGradleBuild -ProjectRoot $ProjectRoot -GradleTask $cfg.GradleTask -OnLog $OnLog `
            -CancelToken $CancelToken -Foreground:$UseConsole
        if (-not (Test-Path $jarPath)) { throw "编译完成但未找到 jar" }
    }

    if ($BuildOnly) {
        & $OnLog '>>> 仅编译，未启动'
        return $null
    }

    if ($KillPortBeforeStart -and $cfg.Port) {
        Stop-StpPort -Port $cfg.Port -OnLog $OnLog | Out-Null
    }

    if ($UseConsole) {
        $null = Start-StpJavaForeground -JavaExe $javaExe -JarPath $jarPath -ProfileOverride $Profile -SpringDebug:$SpringDebug -OnLog $OnLog
        $RunningProcess.Value = $null
        return $null
    }

    $proc = Start-StpJavaProcess -JavaExe $javaExe -JarPath $jarPath -ProfileOverride $Profile -OnLog $OnLog
    $RunningProcess.Value = $proc
    return $proc
}

Initialize-StpFromLocalConfig
