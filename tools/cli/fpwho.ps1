# 功能：交互式查询 TCP Listen 端口占用，展示进程路径，支持终止占用进程

function fpwho {
    if ($PSVersionTable.PSVersion.Major -ge 6 -and $IsWindows -eq $false) {
        Write-Host 'fpwho 仅支持 Windows' -ForegroundColor Red
        return
    }

    while ($true) {
        Write-Host ''
        Write-Host '输入端口 (多个用 , 分隔，0/q 退出): ' -NoNewline -ForegroundColor Yellow
        $rawPorts = (Read-Host).Trim()

        if ($rawPorts -eq '' -or $rawPorts -eq '0' -or $rawPorts -match '^(?i)q$') {
            Write-Host '已退出' -ForegroundColor Green
            return
        }

        $ports = @(Parse-FpwhoPorts -PortInput $rawPorts)
        if ($ports.Count -eq 0) {
            Write-Host '未识别到有效端口 (范围 1-65535)' -ForegroundColor Red
            continue
        }

        $portLabel = ($ports | ForEach-Object { $_.ToString() }) -join ', '
        Write-Host "查询端口: $portLabel" -ForegroundColor Cyan

        $menuLoop = $true
        while ($menuLoop) {
            $entries = @(Get-FpwhoPortEntries -Ports $ports)

            if ($entries.Count -eq 0) {
                Write-Host '以上端口均无 TCP Listen 占用' -ForegroundColor Yellow
                break
            }

            Show-FpwhoMenu -Entries $entries

            Write-Host '输入编号终止进程，all 全部终止，0 退出: ' -NoNewline -ForegroundColor Yellow
            $choice = (Read-Host).Trim()

            if ($choice -eq '' -or $choice -eq '0' -or $choice -match '^(?i)q$') {
                Write-Host '已退出' -ForegroundColor Green
                return
            }

            if ($choice -match '^(?i)all$') {
                $stopped = 0
                $failed = 0
                foreach ($entry in $entries) {
                    if (Stop-FpwhoProcess -Entry $entry) { $stopped++ } else { $failed++ }
                }
                if ($failed -gt 0) {
                    Write-Host "批量终止完成: 成功 $stopped 个，失败 $failed 个" -ForegroundColor Yellow
                }
                Start-Sleep -Milliseconds 500
                $remaining = @(Get-FpwhoPortEntries -Ports $ports)
                if ($remaining.Count -eq 0) {
                    Write-Host '当前查询端口已全部释放' -ForegroundColor Green
                    $menuLoop = $false
                }
                continue
            }

            if ($choice -notmatch '^\d+$') {
                Write-Host '无效输入，请输入编号、all 或 0' -ForegroundColor Red
                continue
            }

            $index = [int]$choice
            $selected = $entries | Where-Object { $_.Order -eq $index } | Select-Object -First 1
            if (-not $selected) {
                Write-Host '无效的选择，请重新输入' -ForegroundColor Red
                continue
            }

            if (-not (Stop-FpwhoProcess -Entry $selected)) {
                continue
            }

            Start-Sleep -Milliseconds 500
            $remaining = @(Get-FpwhoPortEntries -Ports $ports)
            if ($remaining.Count -eq 0) {
                Write-Host '当前查询端口已全部释放' -ForegroundColor Green
                $menuLoop = $false
            }
        }
    }
}

function Parse-FpwhoPorts {
    param([string] $PortInput)

    $result = [System.Collections.Generic.List[int]]::new()
    foreach ($part in ($PortInput -split ',')) {
        $token = $part.Trim()
        if (-not $token) { continue }
        if ($token -notmatch '^\d+$') { continue }

        $port = [int]$token
        if ($port -lt 1 -or $port -gt 65535) { continue }
        if ($result -notcontains $port) {
            $result.Add($port)
        }
    }
    return @($result)
}

function Get-FpwhoProcessInfo {
    param([int] $ProcessId)

    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "PID $ProcessId" }
    $path = if ($proc) { $proc.Path } else { $null }

    if (-not $path) {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
        if ($cim) { $path = $cim.ExecutablePath }
    }

    if (-not $path) { $path = '(无法获取路径)' }

    return [pscustomobject]@{
        ProcessId   = $ProcessId
        ProcessName = $name
        Path        = $path
    }
}

function Get-FpwhoPortEntries {
    param([int[]] $Ports)

    $grouped = @{}

    foreach ($port in $Ports) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($conn in $conns) {
            $ownerPid = $conn.OwningProcess
            if (-not $grouped.ContainsKey($ownerPid)) {
                $info = Get-FpwhoProcessInfo -ProcessId $ownerPid
                $grouped[$ownerPid] = [pscustomobject]@{
                    ProcessId   = $info.ProcessId
                    ProcessName = $info.ProcessName
                    Path        = $info.Path
                    Ports       = [System.Collections.Generic.List[int]]::new()
                }
            }
            if ($grouped[$ownerPid].Ports -notcontains $port) {
                $grouped[$ownerPid].Ports.Add($port)
            }
        }
    }

    $order = 1
    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($item in ($grouped.Values | Sort-Object ProcessId)) {
        $item.Ports.Sort()
        $item | Add-Member -NotePropertyName Order -NotePropertyValue $order -Force
        $item | Add-Member -NotePropertyName PortLabel -NotePropertyValue (($item.Ports | ForEach-Object { $_.ToString() }) -join ', ') -Force
        $entries.Add($item)
        $order++
    }

    return @($entries)
}

function Show-FpwhoMenu {
    param($Entries)

    Write-Host ''
    Write-Host '-------------------------------------------' -ForegroundColor Cyan
    Write-Host '端口占用' -ForegroundColor Cyan
    Write-Host '-------------------------------------------' -ForegroundColor Cyan

    foreach ($entry in $Entries) {
        Write-Host "[$($entry.Order)] " -NoNewline -ForegroundColor Yellow
        Write-Host "终止 → " -NoNewline -ForegroundColor DarkYellow
        Write-Host "$($entry.ProcessName)  " -NoNewline -ForegroundColor White
        Write-Host "PID $($entry.ProcessId)" -ForegroundColor Gray
        Write-Host "    路径: $($entry.Path)" -ForegroundColor Gray
        Write-Host "    端口: $($entry.PortLabel) (Listen)" -ForegroundColor Gray
        Write-Host ''
    }

    Write-Host '[0] 退出' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '操作: 输入编号终止单个进程，输入 all 终止全部' -ForegroundColor DarkGray
    Write-Host ''
}

function Stop-FpwhoProcess {
    param($Entry)

    if ($Entry.ProcessId -in 0, 4) {
        Write-Host "警告: PID $($Entry.ProcessId) 为系统进程，终止可能影响系统稳定性" -ForegroundColor Yellow
    }

    try {
        Stop-Process -Id $Entry.ProcessId -Force -ErrorAction Stop
        Write-Host "已终止: $($Entry.ProcessName) (PID $($Entry.ProcessId))" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "终止失败 (PID $($Entry.ProcessId)): $_" -ForegroundColor Red
        Write-Host '提示: 可尝试以管理员身份运行 PowerShell' -ForegroundColor Yellow
        return $false
    }
}
