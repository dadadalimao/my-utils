# 无控制台启动 GUI（供 启动工具.vbs 调用）
#Requires -Version 5.1

$guiScript = Join-Path $PSScriptRoot 'javaTool-gui.ps1'
if (-not (Test-Path $guiScript)) {
    Write-Error "找不到: $guiScript"
    exit 1
}

$ps = (Get-Command powershell.exe -ErrorAction Stop).Source
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $ps
$psi.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File `"$guiScript`""
$psi.WorkingDirectory = $PSScriptRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
[void][System.Diagnostics.Process]::Start($psi)
