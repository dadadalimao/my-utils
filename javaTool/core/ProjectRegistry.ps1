# 扫描 projects/*.ps1 注册多项目

$script:JavaToolProjects = @{}

function Get-JavaToolInstanceKey {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    "$ProjectId.$ModuleId"
}

function Import-JavaToolProjects {
    $script:JavaToolProjects = @{}
    $dir = Join-Path $script:JavaToolRoot 'projects'
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        return
    }
    Get-ChildItem $dir -Filter '*.ps1' -File | Where-Object {
        -not $_.Name.StartsWith('_')
    } | ForEach-Object {
        $def = & $_.FullName
        if (-not $def -or -not $def.Id) {
            throw "项目定义无效: $($_.Name)（需返回含 Id 的 hashtable）"
        }
        $id = [string]$def.Id
        if ($script:JavaToolProjects.ContainsKey($id)) {
            throw "重复的项目 Id: $id（文件 $($_.Name)）"
        }
        $script:JavaToolProjects[$id] = $def
    }
}

function Get-JavaToolProjects {
    @($script:JavaToolProjects.Values | Sort-Object { $_.Name })
}

function Get-JavaToolProject {
    param([string] $ProjectId)
    if ($script:JavaToolProjects.ContainsKey($ProjectId)) {
        return $script:JavaToolProjects[$ProjectId]
    }
    $null
}

function Get-JavaToolModuleConfig {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $proj = Get-JavaToolProject -ProjectId $ProjectId
    if (-not $proj -or -not $proj.Modules) { return $null }
    $mods = $proj.Modules
    if ($mods -is [hashtable] -and $mods.ContainsKey($ModuleId)) {
        return $mods[$ModuleId]
    }
    if ($mods.PSObject.Properties.Name -contains $ModuleId) {
        return $mods.$ModuleId
    }
    $null
}

function Get-JavaToolAllInstances {
    $list = [System.Collections.Generic.List[object]]::new()
    foreach ($proj in Get-JavaToolProjects) {
        $projId = [string]$proj.Id
        $modTable = $proj.Modules
        $modIds = if ($modTable -is [hashtable]) { @($modTable.Keys) } else { @($modTable.PSObject.Properties.Name) }
        foreach ($modId in $modIds) {
            $mod = Get-JavaToolModuleConfig -ProjectId $projId -ModuleId $modId
            $list.Add([pscustomobject]@{
                ProjectId   = $projId
                ProjectName = $proj.Name
                ModuleId    = $modId
                ModuleLabel = $mod.Label
                InstanceKey = (Get-JavaToolInstanceKey -ProjectId $projId -ModuleId $modId)
            })
        }
    }
    return @($list)
}
