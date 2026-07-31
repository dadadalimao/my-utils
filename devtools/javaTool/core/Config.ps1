# 全局与按项目配置读写、旧版数据迁移

$script:JavaToolAutoCloseTerminal = $true

function Get-JavaToolDataDir {
    $dir = Join-Path $script:JavaToolRoot 'data'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $dir
}

function Get-JavaToolConfigFile {
    Join-Path (Get-JavaToolDataDir) 'config.local.json'
}

function Get-JavaToolSessionDir {
    $dir = Join-Path (Get-JavaToolDataDir) 'sessions'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $dir
}

function Invoke-JavaToolLegacyMigration {
    $legacyConfig = Join-Path $script:JavaToolRoot 'config.local.json'
    $newConfig = Get-JavaToolConfigFile
    if ((Test-Path $legacyConfig) -and -not (Test-Path $newConfig)) {
        $j = Get-Content $legacyConfig -Raw -Encoding UTF8 | ConvertFrom-Json
        $projects = @{}
        if ($j.projectRoot) {
            $projects['stp'] = @{
                projectRoot = [string]$j.projectRoot
                profile     = 'dao,dev'
            }
        }
        [ordered]@{
            autoCloseTerminal = if ($null -ne $j.autoCloseTerminal) { [bool]$j.autoCloseTerminal } else { $true }
            projects          = $projects
            portOverrides     = @{}
        } | ConvertTo-Json -Depth 6 | Set-Content $newConfig -Encoding UTF8
    }

    $legacySessions = Join-Path $script:JavaToolRoot 'sessions'
    $newSessions = Get-JavaToolSessionDir
    if (Test-Path $legacySessions) {
        Get-ChildItem $legacySessions -Filter '*.session.json' -ErrorAction SilentlyContinue | ForEach-Object {
            $base = $_.BaseName -replace '\.session$', ''
            $targetName = if ($base -eq 'admin' -or $base -eq 'prec-aer') { "stp.$base.session.json" } else { $_.Name }
            $target = Join-Path $newSessions $targetName
            if (-not (Test-Path $target)) {
                Copy-Item $_.FullName $target -Force
            }
        }
    }
}

function Get-JavaToolLocalConfig {
    Invoke-JavaToolLegacyMigration
    $cfg = [ordered]@{
        autoCloseTerminal = $true
        projects          = @{}
        portOverrides     = @{}
    }
    $file = Get-JavaToolConfigFile
    if (-not (Test-Path $file)) { return $cfg }
    try {
        $j = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $j.autoCloseTerminal) { $cfg.autoCloseTerminal = [bool]$j.autoCloseTerminal }
        if ($j.projects) {
            $j.projects.PSObject.Properties | ForEach-Object {
                $cfg.projects[$_.Name] = @{
                    projectRoot = if ($_.Value.projectRoot) { [string]$_.Value.projectRoot } else { '' }
                    profile     = if ($_.Value.profile) { [string]$_.Value.profile } else { '' }
                }
            }
        }
        if ($j.portOverrides) {
            $j.portOverrides.PSObject.Properties | ForEach-Object {
                $projId = $_.Name
                $mods = @{}
                $_.Value.PSObject.Properties | ForEach-Object {
                    $mods[$_.Name] = [int]$_.Value
                }
                $cfg.portOverrides[$projId] = $mods
            }
        }
    }
    catch { }
    return $cfg
}

function Save-JavaToolLocalConfig {
    param([hashtable] $Config)
    $out = [ordered]@{
        autoCloseTerminal = [bool]$Config.autoCloseTerminal
        projects          = @{}
        portOverrides     = @{}
    }
    foreach ($projId in $Config.projects.Keys) {
        $p = $Config.projects[$projId]
        $out.projects[$projId] = [ordered]@{
            projectRoot = [string]$p.projectRoot
            profile     = [string]$p.profile
        }
    }
    foreach ($projId in $Config.portOverrides.Keys) {
        $mods = $Config.portOverrides[$projId]
        $modOut = [ordered]@{}
        foreach ($mid in $mods.Keys) {
            $modOut[$mid] = [int]$mods[$mid]
        }
        $out.portOverrides[$projId] = $modOut
    }
    $out | ConvertTo-Json -Depth 8 | Set-Content (Get-JavaToolConfigFile) -Encoding UTF8
}

function Get-JavaToolProjectSettings {
    param([string] $ProjectId)
    $proj = Get-JavaToolProject -ProjectId $ProjectId
    if (-not $proj) { return $null }
    $cfg = Get-JavaToolLocalConfig
    $saved = $cfg.projects[$ProjectId]
    @{
        projectRoot = if ($saved -and $saved.projectRoot -and (Test-Path $saved.projectRoot)) {
            $saved.projectRoot
        }
        else {
            $proj.DefaultRoot
        }
        profile = if ($saved -and $saved.profile) { $saved.profile } else { $proj.DefaultProfile }
    }
}

function Set-JavaToolProjectSettings {
    param(
        [string] $ProjectId,
        [string] $ProjectRoot,
        [string] $Profile
    )
    $cfg = Get-JavaToolLocalConfig
    if (-not $cfg.projects.ContainsKey($ProjectId)) {
        $cfg.projects[$ProjectId] = @{ projectRoot = ''; profile = '' }
    }
    if ($PSBoundParameters.ContainsKey('ProjectRoot')) {
        $cfg.projects[$ProjectId].projectRoot = $ProjectRoot
    }
    if ($PSBoundParameters.ContainsKey('Profile')) {
        $cfg.projects[$ProjectId].profile = $Profile
    }
    Save-JavaToolLocalConfig $cfg
}

function Get-JavaToolEffectivePort {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $mod = Get-JavaToolModuleConfig -ProjectId $ProjectId -ModuleId $ModuleId
    if (-not $mod) { return $null }
    $cfg = Get-JavaToolLocalConfig
    if ($cfg.portOverrides.ContainsKey($ProjectId) -and $cfg.portOverrides[$ProjectId].ContainsKey($ModuleId)) {
        return [int]$cfg.portOverrides[$ProjectId][$ModuleId]
    }
    if ($null -eq $mod.Port) { return $null }
    return [int]$mod.Port
}

function Set-JavaToolPortOverride {
    param(
        [string] $ProjectId,
        [string] $ModuleId,
        [int] $Port
    )
    $cfg = Get-JavaToolLocalConfig
    if (-not $cfg.portOverrides.ContainsKey($ProjectId)) {
        $cfg.portOverrides[$ProjectId] = @{}
    }
    $cfg.portOverrides[$ProjectId][$ModuleId] = $Port
    Save-JavaToolLocalConfig $cfg
}

function Set-JavaToolAutoCloseTerminalPreference {
    param([bool] $Enabled)
    $script:JavaToolAutoCloseTerminal = $Enabled
    $cfg = Get-JavaToolLocalConfig
    $cfg.autoCloseTerminal = $Enabled
    Save-JavaToolLocalConfig $cfg
}

function Initialize-JavaToolFromLocalConfig {
    Invoke-JavaToolLegacyMigration
    $cfg = Get-JavaToolLocalConfig
    $script:JavaToolAutoCloseTerminal = [bool]$cfg.autoCloseTerminal
}
