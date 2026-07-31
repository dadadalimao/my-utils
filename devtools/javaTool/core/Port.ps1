# 端口监听检测、释放、冲突检测

function Test-JavaToolPortListening {
    param([int] $Port)
    if (-not $Port) { return $false }
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-JavaToolPortOwnerInstances {
    param([int] $Port)
    if (-not $Port) { return @() }
    $owners = [System.Collections.Generic.List[object]]::new()
    foreach ($inst in Get-JavaToolAllInstances) {
        $p = Get-JavaToolEffectivePort -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId
        if ($p -eq $Port) {
            $owners.Add($inst)
        }
    }
    return @($owners)
}

function Test-JavaToolPortConflict {
    param(
        [string] $ProjectId,
        [string] $ModuleId,
        [int] $Port
    )
    if (-not $Port) { return $null }
    if (-not (Test-JavaToolPortListening -Port $Port)) { return $null }

    $owners = Get-JavaToolPortOwnerInstances -Port $Port
    $others = @($owners | Where-Object {
        $_.ProjectId -ne $ProjectId -or $_.ModuleId -ne $ModuleId
    })
    if ($others.Count -gt 0) {
        $desc = ($others | ForEach-Object { "$($_.ProjectName)/$($_.ModuleLabel)" }) -join ', '
        return "端口 $Port 已被占用: $desc"
    }
    return $null
}

function Test-JavaToolInstanceRunning {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $port = Get-JavaToolEffectivePort -ProjectId $ProjectId -ModuleId $ModuleId
    if ($port -and (Test-JavaToolPortListening -Port $port)) {
        return 'port'
    }
    if (Test-JavaToolSessionAlive -ProjectId $ProjectId -ModuleId $ModuleId) {
        return 'session'
    }
    return $null
}

function Get-JavaToolRunningInstances {
    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($inst in Get-JavaToolAllInstances) {
        $state = Test-JavaToolInstanceRunning -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId
        if ($state) {
            $port = Get-JavaToolEffectivePort -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId
            $list.Add([pscustomobject]@{
                ProjectId   = $inst.ProjectId
                ProjectName = $inst.ProjectName
                ModuleId    = $inst.ModuleId
                Label       = $inst.ModuleLabel
                Port        = $port
                State       = $state
                InstanceKey = $inst.InstanceKey
            })
        }
    }
    return @($list)
}

function Stop-JavaToolPort {
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

function Stop-JavaToolModule {
    param(
        [string] $ProjectId,
        [string] $ModuleId,
        [scriptblock] $OnLog = { param($m) Write-Host $m }
    )

    $port = Get-JavaToolEffectivePort -ProjectId $ProjectId -ModuleId $ModuleId
    if ($port) {
        Stop-JavaToolPort -Port $port -OnLog $OnLog | Out-Null
    }
}
