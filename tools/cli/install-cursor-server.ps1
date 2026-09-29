# 功能：本机经代理下载 Cursor Remote SSH server，再 scp 到 Linux 主机并解压到标准目录
# 用法（Windows PowerShell 用 powershell；装了 PS7 也可用 pwsh）：
#   .\tools\cli\install-cursor-server.ps1 -Hosts yh-host
#   powershell -ExecutionPolicy Bypass -File tools/cli/install-cursor-server.ps1
#   powershell -ExecutionPolicy Bypass -File tools/cli/install-cursor-server.ps1 -Hosts target-host
#   powershell -ExecutionPolicy Bypass -File tools/cli/install-cursor-server.ps1 -DownloadOnly
#   # tar 已传到远端时只跑解压（跳过慢速 scp）
#   powershell -ExecutionPolicy Bypass -File tools/cli/install-cursor-server.ps1 -Hosts target-host -SkipUpload
#   # 仅清远端残留锁/进程（报 Could not acquire lock 时用）
#   powershell -ExecutionPolicy Bypass -File tools/cli/install-cursor-server.ps1 -Hosts target-host -CleanupOnly
# 场景：远端直连 Azure 易超时；SSH 限速约 100KB/s；本机 HTTP 代理可用

[CmdletBinding()]
param(
    [string[]]$Hosts = @("target-host", "yh-host"),
    [string]$Proxy = "http://127.0.0.1:7897",
    [string]$CacheDir = "$env:USERPROFILE\.ssh\cursor-server-cache",
    [string]$Arch = "linux-x64",
    [switch]$SkipDownload,
    [switch]$DownloadOnly,
    # tar 已在远端 /tmp/cursor-reh-<commit>.tar.gz 时跳过 scp（避免限速通道重传）
    [switch]$SkipUpload,
    # 安装成功后默认会清锁；加此开关则只清锁、不下载/安装
    [switch]$CleanupOnly
)

$ErrorActionPreference = "Stop"
$sshExe = "C:\Windows\System32\OpenSSH\ssh.exe"
$scpExe = "C:\Windows\System32\OpenSSH\scp.exe"

function Get-CursorProductInfo {
    $productPath = Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\product.json"
    if (-not (Test-Path $productPath)) {
        throw "未找到 Cursor product.json: $productPath"
    }
    $info = Get-Content $productPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $info.commit) {
        throw "product.json 中无 commit 字段"
    }
    return [pscustomobject]@{
        Version = $info.version
        Commit  = $info.commit
    }
}

function Test-ProxyReachable {
    param([string]$ProxyUrl)
    try {
        $uri = [Uri]$ProxyUrl
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($uri.Host, $uri.Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(2000, $false)
        if (-not $ok) {
            $tcp.Close()
            return $false
        }
        $tcp.EndConnect($iar)
        $tcp.Close()
        return $true
    }
    catch {
        return $false
    }
}

function Get-ServerDownloadUrls {
    param([string]$Commit, [string]$Version, [string]$ArchName)
    # 新旧两种路径均尝试
    @(
        "https://cursor.blob.core.windows.net/remote-releases/$Commit/vscode-reh-$ArchName.tar.gz",
        "https://cursor.blob.core.windows.net/remote-releases/$Version-$Commit/vscode-reh-$ArchName.tar.gz"
    )
}

function Save-CursorServerPackage {
    param(
        [string]$Commit,
        [string]$Version,
        [string]$ArchName,
        [string]$OutFile,
        [string]$ProxyUrl
    )

    if (-not (Test-ProxyReachable -ProxyUrl $ProxyUrl)) {
        throw "代理不可达: $ProxyUrl （请先启动本地代理后再执行）"
    }

    $urls = Get-ServerDownloadUrls -Commit $Commit -Version $Version -ArchName $ArchName
    $lastError = $null
    foreach ($url in $urls) {
        Write-Host "[download] 尝试: $url"
        Write-Host "[download] 代理: $ProxyUrl"
        try {
            $curlArgs = @(
                "-fL", "--retry", "3", "--retry-delay", "2",
                "-x", $ProxyUrl,
                "-o", $OutFile,
                "--connect-timeout", "30",
                $url
            )
            & curl.exe @curlArgs
            if ($LASTEXITCODE -eq 0 -and (Test-Path $OutFile) -and ((Get-Item $OutFile).Length -gt 1MB)) {
                $sizeMb = [math]::Round((Get-Item $OutFile).Length / 1MB, 1)
                Write-Host "[download] 完成: $OutFile ($sizeMb MB)"
                return $url
            }
            throw "下载结果异常或文件过小 (exit=$LASTEXITCODE)"
        }
        catch {
            $lastError = $_
            Write-Warning "[download] 失败: $($_.Exception.Message)"
            if (Test-Path $OutFile) {
                Remove-Item $OutFile -Force
            }
        }
    }
    throw "所有下载地址均失败。最后错误: $lastError"
}

function Get-SshTransferOpts {
    # 嵌套 ProxyCommand 下不要开 ControlMaster：Windows OpenSSH 会报
    # "getsockname failed: Not a socket" 并断开。
    # ServerAlive* 用于长传防空闲断开；-O 走旧 SCP 协议，比默认 SFTP 更稳。
    @(
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=120",
        "-o", "TCPKeepAlive=yes"
    )
}

function Write-UnixShellFile {
    param([string]$Path, [string]$Content)
    # 无 BOM + LF，避免 bash 报 "set: command not found"（BOM）和语法截断（CRLF）
    $normalized = ($Content -replace "`r`n", "`n") -replace "`r", "`n"
    if (-not $normalized.EndsWith("`n")) {
        $normalized += "`n"
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($Path, $normalized, $utf8NoBom)
}

function Install-OnRemoteHost {
    param(
        [string]$HostAlias,
        [string]$Commit,
        [string]$LocalTar,
        [switch]$SkipUpload
    )

    $remoteTar = "/tmp/cursor-reh-$Commit.tar.gz"
    $remoteSh = "/tmp/install-cursor-server-$Commit.sh"
    # Remote-SSH 1.1.x：目录为 ~/.cursor-server/bin/<platform>-<arch>/<commit>
    # 旧路径 ~/.cursor-server/bin/<commit> 不会被识别，仍会触发远端下载
    $remoteDir = '$HOME/.cursor-server/bin/linux-x64/' + $Commit
    $legacyDir = '$HOME/.cursor-server/bin/' + $Commit
    $sshOpts = Get-SshTransferOpts
    $sizeMb = [math]::Round((Get-Item $LocalTar).Length / 1MB, 1)
    $localSh = Join-Path $env:TEMP "install-cursor-server-$Commit.sh"

    Write-Host ""
    Write-Host "========== $HostAlias =========="

    if (-not $SkipUpload) {
        Write-Host "[scp] $LocalTar ($sizeMb MB) -> ${HostAlias}:$remoteTar"
        Write-Host "[提示] SSH 约 100KB/s 时可能需 15~20 分钟；后续还会再输一次密码上传安装脚本"
        & $scpExe -O @sshOpts $LocalTar "${HostAlias}:$remoteTar"
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "scp -O 失败，尝试无 -O 再传一次..."
            & $scpExe @sshOpts $LocalTar "${HostAlias}:$remoteTar"
            if ($LASTEXITCODE -ne 0) {
                throw "scp 到 $HostAlias 失败 (exit=$LASTEXITCODE)。可先手动测: scp -O `"$LocalTar`" ${HostAlias}:/tmp/"
            }
        }
    }
    else {
        Write-Host "[info] SkipUpload：假定远端已有 $remoteTar"
    }

    # 远端安装脚本：无 BOM/CRLF；装到 linux-x64/<commit>；若旧路径已有可直接搬迁
    $remoteScript = @"
#!/bin/bash
set -euo pipefail
REMOTE_TAR="$remoteTar"
REMOTE_DIR=$remoteDir
LEGACY_DIR=$legacyDir

mkdir -p "`$(dirname "`$REMOTE_DIR")"

# 若已按旧路径装过，直接搬到新路径，避免重传
if [ ! -e "`$REMOTE_DIR/bin/cursor-server" ] && [ -e "`$LEGACY_DIR/bin/cursor-server" ]; then
  echo "Migrating legacy install: `$LEGACY_DIR -> `$REMOTE_DIR"
  rm -rf "`$REMOTE_DIR"
  mv "`$LEGACY_DIR" "`$REMOTE_DIR"
fi

if [ -e "`$REMOTE_DIR/bin/cursor-server" ] && [ -s "`$REMOTE_DIR/bin/cursor-server" ]; then
  echo "Already installed: `$REMOTE_DIR"
  ls -la "`$REMOTE_DIR" | head -n 20
  rm -f "$remoteSh"
  exit 0
fi

if [ ! -f "`$REMOTE_TAR" ]; then
  echo "ERROR: missing archive `$REMOTE_TAR" >&2
  echo "请去掉 -SkipUpload 重新上传，或确认旧路径是否可迁移" >&2
  exit 1
fi

rm -rf "`$REMOTE_DIR"
mkdir -p "`$REMOTE_DIR"
tar -xzf "`$REMOTE_TAR" -C "`$REMOTE_DIR"
# tar 通常带顶层目录 vscode-reh-linux-x64/，摊平到 commit 目录
if [ ! -e "`$REMOTE_DIR/node" ] && [ ! -e "`$REMOTE_DIR/bin" ] && [ ! -e "`$REMOTE_DIR/out" ]; then
  inner=`$(find "`$REMOTE_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  if [ -n "`$inner" ]; then
    mv "`$inner"/* "`$REMOTE_DIR"/
    rm -rf "`$inner"
  fi
fi
rm -f "`$REMOTE_TAR"

if [ ! -e "`$REMOTE_DIR/bin/cursor-server" ] || [ ! -s "`$REMOTE_DIR/bin/cursor-server" ]; then
  echo "ERROR: install incomplete, missing `$REMOTE_DIR/bin/cursor-server" >&2
  ls -la "`$REMOTE_DIR" | head -n 40 >&2
  exit 1
fi

echo "OK installed: `$REMOTE_DIR"
ls -la "`$REMOTE_DIR" | head -n 20
rm -f "$remoteSh"
"@

    Write-UnixShellFile -Path $localSh -Content $remoteScript
    Write-Host "[scp] 安装脚本 -> ${HostAlias}:$remoteSh"
    & $scpExe -O @sshOpts $localSh "${HostAlias}:$remoteSh"
    if ($LASTEXITCODE -ne 0) {
        & $scpExe @sshOpts $localSh "${HostAlias}:$remoteSh"
        if ($LASTEXITCODE -ne 0) {
            throw "上传安装脚本失败: $HostAlias (exit=$LASTEXITCODE)"
        }
    }

    Write-Host "[ssh] 远端解压并校验..."
    & $sshExe @sshOpts $HostAlias "bash $remoteSh"
    if ($LASTEXITCODE -ne 0) {
        throw "远端安装失败: $HostAlias (exit=$LASTEXITCODE)"
    }

    Write-Host "[ok] $HostAlias 安装完成 (commit=$Commit)"
}

function Clear-RemoteCursorLock {
    param([string]$HostAlias)

    $sshOpts = Get-SshTransferOpts
    # 用 base64 传脚本，避免 Windows OpenSSH 剥引号导致 bash 语法错误
    $remoteScript = @'
set +e
echo "[cleanup] host=$(hostname) user=$(whoami)"
if [ -n "${XDG_RUNTIME_DIR:-}" ]; then
  rm -f "$XDG_RUNTIME_DIR"/cursor-remote-lock.* 2>/dev/null
fi
rm -f /run/user/*/cursor-remote-lock.* 2>/dev/null
rm -f /tmp/cursor-remote-lock.* 2>/dev/null
pkill -f 'cursor-remote-lock|cursor_remote_install' 2>/dev/null
pkill -f '/\.cursor-server/.*/bin/cursor-server' 2>/dev/null
sleep 1
echo "[cleanup] remaining locks:"
ls -la "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"/cursor-remote-lock.* 2>/dev/null || echo "(none)"
echo "[cleanup] done"
'@
    $normalized = (($remoteScript -replace "`r`n", "`n") -replace "`r", "`n").Trim() + "`n"
    $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($normalized))
    $remoteCmd = "echo $b64 | base64 -d | bash"

    Write-Host ""
    Write-Host "========== cleanup: $HostAlias =========="
    Write-Host "[ssh] 清理远端 Cursor 锁/残留进程（需输入密码）"
    & $sshExe @sshOpts $HostAlias $remoteCmd
    if ($LASTEXITCODE -ne 0) {
        throw "清理失败: $HostAlias (exit=$LASTEXITCODE)"
    }
    Write-Host "[ok] $HostAlias 清理完成"
}

# ---- main ----
$product = Get-CursorProductInfo
Write-Host "[info] Cursor $($product.Version) commit=$($product.Commit)"
Write-Host "[info] 目标主机: $($Hosts -join ', ')"
Write-Host "[info] 架构: $Arch"
Write-Host "[info] 代理: $Proxy"

if ($CleanupOnly) {
    foreach ($h in $Hosts) {
        Clear-RemoteCursorLock -HostAlias $h
    }
    Write-Host ""
    Write-Host "[done] 清理完成。请先关闭 Cursor 里旧的 Remote 连接，再只连一次。"
    exit 0
}

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$tarName = "vscode-reh-$Arch-$($product.Commit).tar.gz"
$localTar = Join-Path $CacheDir $tarName

if ($SkipDownload) {
    if (-not (Test-Path $localTar)) {
        throw "SkipDownload 已指定，但缓存不存在: $localTar"
    }
    Write-Host "[info] 跳过下载，使用缓存: $localTar"
}
else {
    if ((Test-Path $localTar) -and ((Get-Item $localTar).Length -gt 1MB)) {
        $sizeMb = [math]::Round((Get-Item $localTar).Length / 1MB, 1)
        Write-Host "[info] 已有缓存 ($sizeMb MB)，跳过下载: $localTar"
        Write-Host "[info] 如需强制重下，请删除该文件后重跑"
    }
    else {
        Save-CursorServerPackage -Commit $product.Commit -Version $product.Version `
            -ArchName $Arch -OutFile $localTar -ProxyUrl $Proxy
    }
}

if ($DownloadOnly) {
    Write-Host "[done] DownloadOnly，文件: $localTar"
    exit 0
}

foreach ($h in $Hosts) {
    Install-OnRemoteHost -HostAlias $h -Commit $product.Commit -LocalTar $localTar -SkipUpload:$SkipUpload
    # 安装后顺手清锁，避免上次失败残留导致 reconnect 卡在 Install in progress
    Clear-RemoteCursorLock -HostAlias $h
}

Write-Host ""
Write-Host "[done] 全部完成。可在 Cursor 中重新 Remote-SSH 连接上述主机。"
Write-Host "[tip] 客户端禁自动更新时，同 commit 无需再装；升级 Cursor 后请再跑本脚本。"
Write-Host "[tip] 若报 Could not acquire lock，执行: -Hosts <主机> -CleanupOnly"
