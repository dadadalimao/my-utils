# 智慧水务后端启动 - 共享核心逻辑（CLI / GUI 共用）

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

function Set-StpSavedProjectRoot {
    param([string] $ProjectRoot)
    @{ projectRoot = $ProjectRoot } | ConvertTo-Json | Set-Content (Get-StpConfigFile) -Encoding UTF8
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

function Get-StpLatestWriteTime {
    param([string[]] $ModuleNames, [string] $Root)

    $patterns = @('src\main\java\**\*.java', 'src\main\resources\**\*', 'build.gradle')
    $latest = [datetime]::MinValue

    foreach ($mod in $ModuleNames) {
        $modDir = Join-Path $Root $mod
        if (-not (Test-Path $modDir)) { continue }
        foreach ($pat in $patterns) {
            Get-ChildItem -Path (Join-Path $modDir $pat) -File -Recurse -ErrorAction SilentlyContinue |
                ForEach-Object { if ($_.LastWriteTime -gt $latest) { $latest = $_.LastWriteTime } }
        }
    }

    foreach ($f in @('build.gradle', 'settings.gradle', 'gradle.properties')) {
        $p = Join-Path $Root $f
        if ((Test-Path $p) -and (Get-Item $p).LastWriteTime -gt $latest) {
            $latest = (Get-Item $p).LastWriteTime
        }
    }
    return $latest
}

function Test-StpNeedBuild {
    param(
        [string] $JarPath,
        [string[]] $WatchModules,
        [string] $Root
    )

    if (-not (Test-Path $JarPath)) {
        return @{ NeedBuild = $true; Reason = 'jar 不存在，需要编译' }
    }

    $jarTime = (Get-Item $JarPath).LastWriteTime
    $srcTime = Get-StpLatestWriteTime -ModuleNames $WatchModules -Root $Root
    if ($srcTime -gt $jarTime) {
        return @{
            NeedBuild = $true
            Reason    = "源码/配置已更新 ($($srcTime.ToString('HH:mm:ss')) > $($jarTime.ToString('HH:mm:ss')))"
        }
    }
    return @{ NeedBuild = $false; Reason = '无变更，跳过编译' }
}

function Test-StpPortListening {
    param([int] $Port)
    if (-not $Port) { return $false }
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
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
        [System.Threading.CancellationToken] $CancelToken = [System.Threading.CancellationToken]::None
    )

    $gradlew = Join-Path $ProjectRoot 'gradlew.bat'
    if (-not (Test-Path $gradlew)) { throw "未找到 gradlew.bat: $gradlew" }

    & $OnLog ">>> 编译: $GradleTask -x test"

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
    $proc.add_OutputDataReceived({ if ($_.Data) { & $OnLog $_.Data } })
    $proc.add_ErrorDataReceived({ if ($_.Data) { & $OnLog $_.Data } })
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
    if ($SkipBuild) {
        if (-not (Test-Path $jarPath)) { throw "jar 不存在: $jarPath" }
        $needBuild = $false
        & $OnLog '>>> 跳过编译'
    }
    elseif ($Force) {
        & $OnLog '>>> 强制编译'
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
        Invoke-StpGradleBuild -ProjectRoot $ProjectRoot -GradleTask $cfg.GradleTask -OnLog $OnLog -CancelToken $CancelToken
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
