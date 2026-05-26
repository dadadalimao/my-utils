# Java 本地服务管理 - 核心入口（CLI / GUI 共用）
#Requires -Version 5.1

$script:JavaToolRoot = Split-Path $PSScriptRoot -Parent

. (Join-Path $PSScriptRoot 'Config.ps1')
. (Join-Path $PSScriptRoot 'ProjectRegistry.ps1')
. (Join-Path $PSScriptRoot 'GuiHost.ps1')
. (Join-Path $PSScriptRoot 'Session.ps1')
. (Join-Path $PSScriptRoot 'Port.ps1')
. (Join-Path $PSScriptRoot 'Build.ps1')

Import-JavaToolProjects
Initialize-JavaToolFromLocalConfig
