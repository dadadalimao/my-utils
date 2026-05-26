# Gradle 编译与 Java 进程启动

function Get-JavaToolJavaExe {
    if ($env:JAVA_HOME) {
        $javaExe = Join-Path $env:JAVA_HOME 'bin\java.exe'
        if (Test-Path $javaExe) { return $javaExe }
        throw "JAVA_HOME 无效: $env:JAVA_HOME"
    }
    $javaCmd = Get-Command java -ErrorAction SilentlyContinue
    if ($javaCmd) { return $javaCmd.Source }
    throw '未找到 Java：请安装 JDK 11 并设置 JAVA_HOME 或将 java 加入 PATH'
}

function Update-JavaToolLatestWriteTime {
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

function Get-JavaToolLatestWriteTime {
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
            Update-JavaToolLatestWriteTime -Latest $latestRef -Items $javaFiles
        }

        $resDir = Join-Path $modDir 'src\main\resources'
        if (Test-Path $resDir) {
            $resFiles = @(Get-ChildItem -Path $resDir -Recurse -File -ErrorAction SilentlyContinue)
            $fileCount += $resFiles.Count
            Update-JavaToolLatestWriteTime -Latest $latestRef -Items $resFiles
        }

        $modGradle = Join-Path $modDir 'build.gradle'
        if (Test-Path $modGradle) {
            $fileCount++
            Update-JavaToolLatestWriteTime -Latest $latestRef -Items @(Get-Item $modGradle)
        }
    }

    foreach ($f in @('build.gradle', 'settings.gradle', 'gradle.properties')) {
        $p = Join-Path $Root $f
        if (Test-Path $p) {
            $fileCount++
            Update-JavaToolLatestWriteTime -Latest $latestRef -Items @(Get-Item $p)
        }
    }

    foreach ($rel in $AdditionalPaths) {
        $p = if ([IO.Path]::IsPathRooted($rel)) { $rel } else { Join-Path $Root $rel }
        if (-not (Test-Path $p)) { continue }
        if ((Get-Item $p).PSIsContainer) {
            $extra = @(Get-ChildItem -Path $p -Recurse -File -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -notmatch '\\build\\|\\\.gradle\\|\\.git\\' })
            $fileCount += $extra.Count
            Update-JavaToolLatestWriteTime -Latest $latestRef -Items $extra
        }
        else {
            $fileCount++
            Update-JavaToolLatestWriteTime -Latest $latestRef -Items @(Get-Item $p)
        }
    }

    return @{ Latest = $latestRef.Value; FileCount = $fileCount }
}

function Test-JavaToolNeedBuild {
    param(
        [string] $JarPath,
        [string[]] $WatchModules,
        [string] $Root,
        [string[]] $AdditionalPaths = @()
    )

    if (-not (Test-Path $JarPath)) {
        return @{ NeedBuild = $true; Reason = 'jar 不存在，需要编译' }
    }

    $scan = Get-JavaToolLatestWriteTime -ModuleNames $WatchModules -Root $Root -AdditionalPaths $AdditionalPaths
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

function Invoke-JavaToolGradleBuild {
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

function Start-JavaToolJavaForeground {
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
    & $OnLog '>>> 上下文初始化后若长时间停住，多在连 Redis/RabbitMQ，请确认依赖服务可达'

    try {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        $OutputEncoding = [System.Text.Encoding]::UTF8
    }
    catch { }

    $proc = Start-Process -FilePath $JavaExe -ArgumentList $argList -Wait -NoNewWindow -PassThru
    $code = if ($proc) { $proc.ExitCode } else { -1 }
    & $OnLog ">>> Java 进程已结束，退出码: $code"
    $global:LASTEXITCODE = $code
    return $null
}

function Start-JavaToolBootRunForeground {
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

function Start-JavaToolJavaProcess {
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

function Invoke-JavaToolStart {
    param(
        [string] $ProjectId,
        [string] $ModuleId,
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

    $cfg = Get-JavaToolModuleConfig -ProjectId $ProjectId -ModuleId $ModuleId
    if (-not $cfg) { throw "未知模块: $ProjectId / $ModuleId" }

    $port = Get-JavaToolEffectivePort -ProjectId $ProjectId -ModuleId $ModuleId
    $jarPath = Join-Path $ProjectRoot $cfg.JarRelPath
    $javaExe = Get-JavaToolJavaExe
    $proj = Get-JavaToolProject -ProjectId $ProjectId

    & $OnLog "项目: $($proj.Name) ($ProjectId)"
    & $OnLog "模块: $ModuleId - $($cfg.Label)"
    & $OnLog "Jar : $jarPath"
    if ($port) { & $OnLog "端口: $port" }

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
        $r = Test-JavaToolNeedBuild -JarPath $jarPath -WatchModules $cfg.WatchModules -Root $ProjectRoot
        $needBuild = $r.NeedBuild
        & $OnLog ">>> $($r.Reason)"
    }

    $runTask = $cfg.GradleTask -replace ':bootJar$', ':bootRun'

    if ($UseConsole -and $UseBootRun -and -not $BuildOnly) {
        if ($KillPortBeforeStart -and $port) {
            Stop-JavaToolPort -Port $port -OnLog $OnLog | Out-Null
        }
        $null = Start-JavaToolBootRunForeground -ProjectRoot $ProjectRoot -GradleTask $runTask `
            -ProfileOverride $Profile -SpringDebug:$SpringDebug -OnLog $OnLog
        $RunningProcess.Value = $null
        return $null
    }

    if ($needBuild) {
        Invoke-JavaToolGradleBuild -ProjectRoot $ProjectRoot -GradleTask $cfg.GradleTask -OnLog $OnLog `
            -CancelToken $CancelToken -Foreground:$UseConsole
        if (-not (Test-Path $jarPath)) { throw "编译完成但未找到 jar" }
    }

    if ($BuildOnly) {
        & $OnLog '>>> 仅编译，未启动'
        return $null
    }

    if ($KillPortBeforeStart -and $port) {
        Stop-JavaToolPort -Port $port -OnLog $OnLog | Out-Null
    }

    if ($UseConsole) {
        $null = Start-JavaToolJavaForeground -JavaExe $javaExe -JarPath $jarPath -ProfileOverride $Profile -SpringDebug:$SpringDebug -OnLog $OnLog
        $RunningProcess.Value = $null
        return $null
    }

    $proc = Start-JavaToolJavaProcess -JavaExe $javaExe -JarPath $jarPath -ProfileOverride $Profile -OnLog $OnLog
    $RunningProcess.Value = $proc
    return $proc
}
