# 兼容：转发至 scripts\launch-gui.ps1
& (Join-Path $PSScriptRoot 'scripts\launch-gui.ps1')
exit $LASTEXITCODE
