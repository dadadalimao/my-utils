# 无控制台启动 GUI（供 启动工具.vbs 调用）
#Requires -Version 5.1

$toolRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $toolRoot 'core\JavaTool.Core.ps1')

if (Test-JavaToolGuiInstanceRunning) {
    Invoke-JavaToolGuiActivateWindow | Out-Null
    exit 0
}

$guiScript = Join-Path $toolRoot 'gui\javaTool-gui.ps1'
if (-not (Test-Path $guiScript)) {
    Write-Error "找不到: $guiScript"
    exit 1
}

$ps = (Get-Command powershell.exe -ErrorAction Stop).Source
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ps
$psi.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File `"$guiScript`""
$psi.WorkingDirectory = $toolRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
[void][System.Diagnostics.Process]::Start($psi)
