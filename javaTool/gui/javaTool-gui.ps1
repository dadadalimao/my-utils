# Java 本地服务管理 - 列表视图 GUI
#Requires -Version 5.1

$ErrorActionPreference = 'Continue'
$toolRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $toolRoot 'core\JavaTool.Core.ps1')

if (-not (Invoke-JavaToolGuiSingleInstanceOrActivate)) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:ToolRoot = $toolRoot
$script:ServiceScript = Join-Path $toolRoot 'scripts\service.ps1'
$script:PsExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$script:GuiForceClosing = $false
$script:RowTagByKey = @{}

function Get-SelectedRow {
    if ($script:ListView.SelectedItems.Count -eq 0) { return $null }
    $script:ListView.SelectedItems[0]
}

function Get-RowInstance {
    param($ListViewItem)
    if (-not $ListViewItem -or -not $ListViewItem.Tag) { return $null }
    $script:RowTagByKey[$ListViewItem.Tag]
}

function Get-InstanceStatusText {
    param(
        [string] $ProjectId,
        [string] $ModuleId
    )
    $state = Test-JavaToolInstanceRunning -ProjectId $ProjectId -ModuleId $ModuleId
    $port = Get-JavaToolEffectivePort -ProjectId $ProjectId -ModuleId $ModuleId
    switch ($state) {
        'port' { return "运行中 · $port" }
        'session' { return '终端存活' }
        default { return '未运行' }
    }
}

function Update-ListStatus {
    foreach ($item in $script:ListView.Items) {
        $inst = Get-RowInstance $item
        if (-not $inst) { continue }
        $item.SubItems[3].Text = $(if ($inst.Port) { [string]$inst.Port } else { '-' })
        $status = Get-InstanceStatusText -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId
        $item.SubItems[4].Text = $status
        if ($status -like '运行中*' -or $status -eq '终端存活') {
            $item.ForeColor = [Drawing.Color]::FromArgb(39, 174, 96)
        }
        else {
            $item.ForeColor = [Drawing.Color]::Black
        }
    }
}

function Load-SelectedToPanel {
    $row = Get-SelectedRow
    $inst = Get-RowInstance $row
    if (-not $inst) { return }

    $settings = Get-JavaToolProjectSettings -ProjectId $inst.ProjectId
    $script:TxtProject.Text = $settings.projectRoot
    $script:TxtProfile.Text = $settings.profile
    if ($inst.Port) {
        $script:TxtPort.Text = [string]$inst.Port
    }
    else {
        $script:TxtPort.Text = ''
    }
}

function Save-PanelToProject {
    $row = Get-SelectedRow
    $inst = Get-RowInstance $row
    if (-not $inst) { return }

    $root = $script:TxtProject.Text.Trim()
    $profile = $script:TxtProfile.Text.Trim()
    if ($root -and (Test-Path $root)) {
        Set-JavaToolProjectSettings -ProjectId $inst.ProjectId -ProjectRoot $root -Profile $profile
    }
    elseif ($profile) {
        Set-JavaToolProjectSettings -ProjectId $inst.ProjectId -Profile $profile
    }
}

function Build-ServiceArgs {
    param(
        [object] $Inst,
        [string] $ProjectRoot,
        [string] $Profile,
        [switch] $Stop,
        [switch] $BuildOnly,
        [switch] $Restart
    )

    $args = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $script:ServiceScript,
        '-Project', $Inst.ProjectId,
        '-Module', $Inst.ModuleId,
        '-ProjectRoot', $ProjectRoot
    )
    if ($Profile) { $args += '-Profile'; $args += $Profile }
    if ($Stop) { $args += '-Stop'; return $args }
    if ($script:ChkKillPort.Checked) { $args += '-KillPort' }
    if ($script:ChkForce.Checked) { $args += '-Force' }
    if ($script:ChkSkip.Checked) { $args += '-SkipBuild' }
    if ($script:ChkBootRun.Checked) { $args += '-BootRun' }
    if ($BuildOnly) { $args += '-BuildOnly' }
    if ($Restart) { $args += '-Restart' }
    return $args
}

function Test-StartPreconditions {
    param($Inst)

    $root = $script:TxtProject.Text.Trim()
    if (-not $root) {
        [System.Windows.Forms.MessageBox]::Show('请填写项目路径', '提示') | Out-Null
        return $false
    }
    if (-not (Test-Path $root)) {
        [System.Windows.Forms.MessageBox]::Show("项目路径不存在:`n$root", '提示') | Out-Null
        return $false
    }

    Save-PanelToProject

    $port = Get-JavaToolEffectivePort -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId
    $conflict = Test-JavaToolPortConflict -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId -Port $port
    if ($conflict) {
        [System.Windows.Forms.MessageBox]::Show($conflict, '端口冲突', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
        return $false
    }

    $running = Test-JavaToolInstanceRunning -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId
    if ($running) {
        $ans = [System.Windows.Forms.MessageBox]::Show(
            "$($Inst.ProjectName) / $($Inst.ModuleLabel) 似乎已在运行，是否先停止再启动？",
            '已在运行',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        if ($ans -ne [System.Windows.Forms.DialogResult]::Yes) { return $false }
        Stop-InstanceQuiet -Inst $Inst -ProjectRoot $root
    }
    return $true
}

function Stop-InstanceQuiet {
    param(
        $Inst,
        [string] $ProjectRoot
    )

    Close-JavaToolTerminalSession -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId | Out-Null
    $stopArgs = Build-ServiceArgs -Inst $Inst -ProjectRoot $ProjectRoot -Profile $script:TxtProfile.Text.Trim() -Stop
    $proc = Start-Process -FilePath $script:PsExe -ArgumentList $stopArgs -Wait -PassThru -WindowStyle Hidden
    return @{
        TerminalClosed = $true
        ExitCode       = $proc.ExitCode
    }
}

function Open-TerminalForInstance {
    param(
        $Inst,
        [string[]] $PsArgs
    )

    Close-JavaToolTerminalSession -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId | Out-Null

    if ($script:ChkUseWt.Checked) {
        $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
        if ($wt) {
            $title = Get-JavaToolTerminalWindowTitle -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId
            $wtArgs = @('new-tab', '--title', $title, 'powershell', '-NoExit') + $PsArgs
            Start-Process -FilePath $wt.Source -ArgumentList $wtArgs
            return 'Windows Terminal'
        }
    }

    return (Start-JavaToolLogTerminal -ProjectId $Inst.ProjectId -ModuleId $Inst.ModuleId -PsExe $script:PsExe -PsArgs $PsArgs)
}

function Start-SelectedInstance {
    param([switch] $BuildOnly, [switch] $Restart)

    $inst = Get-RowInstance (Get-SelectedRow)
    if (-not $inst) {
        [System.Windows.Forms.MessageBox]::Show('请先在列表中选择一行', '提示') | Out-Null
        return
    }

    if ($script:ChkForce.Checked -and $script:ChkSkip.Checked) {
        [System.Windows.Forms.MessageBox]::Show('已勾选「强制编译」，将忽略「跳过编译」', '提示') | Out-Null
    }

    $root = $script:TxtProject.Text.Trim()
    $profile = $script:TxtProfile.Text.Trim()

    if (-not $Restart -and -not $BuildOnly) {
        if (-not (Test-StartPreconditions -Inst $inst)) { return }
    }
    else {
        if (-not $root -or -not (Test-Path $root)) {
            [System.Windows.Forms.MessageBox]::Show('请填写有效的项目路径', '提示') | Out-Null
            return
        }
        Save-PanelToProject
    }

    if ($Restart) {
        Close-JavaToolTerminalSession -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId | Out-Null
        $stopArgs = Build-ServiceArgs -Inst $inst -ProjectRoot $root -Profile $profile -Stop
        $stopProc = Start-Process -FilePath $script:PsExe -ArgumentList $stopArgs -Wait -PassThru -WindowStyle Hidden
        if ($stopProc.ExitCode -ne 0) {
            $script:LblHint.Text = "停止旧服务异常，退出码 $($stopProc.ExitCode)，仍将尝试重启"
        }
    }

    $args = Build-ServiceArgs -Inst $inst -ProjectRoot $root -Profile $profile -BuildOnly:$BuildOnly -Restart:$Restart
    $kind = Open-TerminalForInstance -Inst $inst -PsArgs $args
    $action = if ($Restart) { '重启' } elseif ($BuildOnly) { '仅编译' } else { '启动' }
    $script:LblHint.Text = "已打开 $kind ：$action $($inst.ProjectName) / $($inst.ModuleLabel)"
    Update-ListStatus
}

function Stop-SelectedInstance {
    $inst = Get-RowInstance (Get-SelectedRow)
    if (-not $inst) {
        [System.Windows.Forms.MessageBox]::Show('请先在列表中选择一行', '提示') | Out-Null
        return
    }

    $root = $script:TxtProject.Text.Trim()
    if (-not $root -or -not (Test-Path $root)) {
        $settings = Get-JavaToolProjectSettings -ProjectId $inst.ProjectId
        $root = $settings.projectRoot
    }

    $result = Stop-InstanceQuiet -Inst $inst -ProjectRoot $root
    Update-ListStatus
    $msg = if ($result.ExitCode -eq 0) { '已停止服务' } else { "停止完成，退出码 $($result.ExitCode)" }
    $script:LblHint.Text = "$msg ：$($inst.ProjectName) / $($inst.ModuleLabel)"
}

function Save-PortFromPanel {
    $inst = Get-RowInstance (Get-SelectedRow)
    if (-not $inst) { return }

    $txt = $script:TxtPort.Text.Trim()
    if (-not $txt) {
        [System.Windows.Forms.MessageBox]::Show('请输入端口号', '提示') | Out-Null
        return
    }
    $portNum = 0
    if (-not [int]::TryParse($txt, [ref]$portNum) -or $portNum -lt 1 -or $portNum -gt 65535) {
        [System.Windows.Forms.MessageBox]::Show('端口无效（1-65535）', '提示') | Out-Null
        return
    }

    Set-JavaToolPortOverride -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId -Port $portNum
    $inst.Port = $portNum
    $script:RowTagByKey[$inst.InstanceKey] = $inst
    Update-ListStatus
    $script:LblHint.Text = "已保存端口 $portNum ：$($inst.InstanceKey)"
}

function Confirm-GuiClose {
    param($FormClosingEventArgs)

    if ($script:GuiForceClosing) { return }

    $running = @(Get-JavaToolRunningInstances)
    if ($running.Count -eq 0) { return }

    $lines = ($running | ForEach-Object {
        $p = if ($_.Port) { "端口 $($_.Port)" } else { '无端口' }
        "- $($_.ProjectName) / $($_.Label)（$p）"
    }) -join "`n"

    $answer = [System.Windows.Forms.MessageBox]::Show(
        "检测到以下服务仍在运行：`n$lines`n`n确认关闭将停止服务并关闭日志终端。",
        '确认关闭',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
        $FormClosingEventArgs.Cancel = $true
        return
    }

    $script:GuiForceClosing = $true
    $script:StatusTimer.Stop()

    foreach ($item in $running) {
        try {
            $settings = Get-JavaToolProjectSettings -ProjectId $item.ProjectId
            $inst = [pscustomobject]@{
                ProjectId   = $item.ProjectId
                ModuleId    = $item.ModuleId
                ProjectName = $item.ProjectName
                ModuleLabel = $item.Label
            }
            Stop-InstanceQuiet -Inst $inst -ProjectRoot $settings.projectRoot | Out-Null
        }
        catch { }
    }
}

function Update-HintText {
    if ($script:JavaToolAutoCloseTerminal) {
        $script:LblHint.Text = '选中列表行后配置路径/Profile；停止可自动关终端'
    }
    else {
        $script:LblHint.Text = '已关闭自动关窗：停止/重启不会关终端'
    }
}

function Refresh-ProjectList {
    $prevKey = $null
    $sel = Get-SelectedRow
    if ($sel -and $sel.Tag) { $prevKey = [string]$sel.Tag }

    try {
        Import-JavaToolProjects
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            '刷新失败',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    Initialize-ListRows

    if ($prevKey) {
        foreach ($item in $script:ListView.Items) {
            if ([string]$item.Tag -eq $prevKey) {
                $item.Selected = $true
                $item.Focused = $true
                Load-SelectedToPanel
                break
            }
        }
    }

    Update-ListStatus
    $count = @(Get-JavaToolProjects).Count
    $rowCount = $script:ListView.Items.Count
    $script:LblHint.Text = "已刷新：$count 个项目，$rowCount 个模块"
}

function Initialize-ListRows {
    $script:ListView.Items.Clear()
    $script:RowTagByKey = @{}
    foreach ($inst in Get-JavaToolAllInstances) {
        $port = Get-JavaToolEffectivePort -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId
        $tag = $inst.InstanceKey
        $rowObj = [pscustomobject]@{
            ProjectId   = $inst.ProjectId
            ModuleId    = $inst.ModuleId
            ProjectName = $inst.ProjectName
            ModuleLabel = $inst.ModuleLabel
            InstanceKey = $tag
            Port        = $port
        }
        $script:RowTagByKey[$tag] = $rowObj

        $status = Get-InstanceStatusText -ProjectId $inst.ProjectId -ModuleId $inst.ModuleId
        $lvItem = New-Object System.Windows.Forms.ListViewItem($inst.ProjectName)
        [void]$lvItem.SubItems.Add($inst.ModuleLabel)
        [void]$lvItem.SubItems.Add($inst.ModuleId)
        [void]$lvItem.SubItems.Add($(if ($port) { [string]$port } else { '-' }))
        [void]$lvItem.SubItems.Add($status)
        $lvItem.Tag = $tag
        [void]$script:ListView.Items.Add($lvItem)
    }
    if ($script:ListView.Items.Count -gt 0) {
        $script:ListView.Items[0].Selected = $true
        Load-SelectedToPanel
    }
}

# ---------------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = $script:JavaToolGuiWindowTitle
$form.Size = New-Object System.Drawing.Size(720, 520)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$form.MinimumSize = New-Object System.Drawing.Size(640, 480)
$form.Add_FormClosing({ param($s, $e) Confirm-GuiClose -FormClosingEventArgs $e })
$form.Add_FormClosed({ Release-JavaToolGuiSingleInstance })

$pad = 12
$y = $pad

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = '刷新项目'
$btnRefresh.Location = New-Object System.Drawing.Point(612, $y)
$btnRefresh.Size = New-Object System.Drawing.Size(80, 28)
$btnRefresh.Add_Click({ Refresh-ProjectList })
$form.Controls.Add($btnRefresh)

$lv = New-Object System.Windows.Forms.ListView
$script:ListView = $lv
$lv.Location = New-Object System.Drawing.Point($pad, $y)
$lv.Size = New-Object System.Drawing.Size(592, 200)
$lv.View = 'Details'
$lv.FullRowSelect = $true
$lv.GridLines = $true
$lv.MultiSelect = $false
$lv.HideSelection = $false
[void]$lv.Columns.Add('项目', 120)
[void]$lv.Columns.Add('模块', 140)
[void]$lv.Columns.Add('ID', 80)
[void]$lv.Columns.Add('端口', 60)
[void]$lv.Columns.Add('状态', 120)
$lv.Add_SelectedIndexChanged({ Load-SelectedToPanel })
$form.Controls.Add($lv)

$y += 210

$lblRoot = New-Object System.Windows.Forms.Label
$lblRoot.Text = '路径'; $lblRoot.Location = New-Object System.Drawing.Point($pad, $y); $lblRoot.AutoSize = $true
$form.Controls.Add($lblRoot)

$txtProject = New-Object System.Windows.Forms.TextBox
$script:TxtProject = $txtProject
$txtProject.Location = New-Object System.Drawing.Point(48, ($y - 3))
$txtProject.Size = New-Object System.Drawing.Size(480, 28)
$form.Controls.Add($txtProject)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = '...'
$btnBrowse.Location = New-Object System.Drawing.Point(534, ($y - 4))
$btnBrowse.Size = New-Object System.Drawing.Size(36, 28)
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($script:TxtProject.Text -and (Test-Path $script:TxtProject.Text)) { $dlg.SelectedPath = $script:TxtProject.Text }
    if ($dlg.ShowDialog() -eq 'OK') {
        $script:TxtProject.Text = $dlg.SelectedPath
        Save-PanelToProject
    }
})
$form.Controls.Add($btnBrowse)

$y += 34

$lblProfile = New-Object System.Windows.Forms.Label
$lblProfile.Text = 'Profile'; $lblProfile.Location = New-Object System.Drawing.Point($pad, $y); $lblProfile.AutoSize = $true
$form.Controls.Add($lblProfile)

$txtProfile = New-Object System.Windows.Forms.TextBox
$script:TxtProfile = $txtProfile
$txtProfile.Location = New-Object System.Drawing.Point(56, ($y - 3))
$txtProfile.Size = New-Object System.Drawing.Size(140, 28)
$form.Controls.Add($txtProfile)

$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = '端口'; $lblPort.Location = New-Object System.Drawing.Point(210, $y); $lblPort.AutoSize = $true
$form.Controls.Add($lblPort)

$txtPort = New-Object System.Windows.Forms.TextBox
$script:TxtPort = $txtPort
$txtPort.Location = New-Object System.Drawing.Point(248, ($y - 3))
$txtPort.Size = New-Object System.Drawing.Size(60, 28)
$form.Controls.Add($txtPort)

$btnSavePort = New-Object System.Windows.Forms.Button
$btnSavePort.Text = '保存端口'
$btnSavePort.Location = New-Object System.Drawing.Point(316, ($y - 4))
$btnSavePort.Size = New-Object System.Drawing.Size(80, 28)
$btnSavePort.Add_Click({ Save-PortFromPanel })
$form.Controls.Add($btnSavePort)

$chkKill = New-Object System.Windows.Forms.CheckBox
$script:ChkKillPort = $chkKill
$chkKill.Text = '启动前释放端口'; $chkKill.Location = New-Object System.Drawing.Point(410, ($y - 2))
$chkKill.AutoSize = $true; $chkKill.Checked = $true
$form.Controls.Add($chkKill)

$chkForce = New-Object System.Windows.Forms.CheckBox
$script:ChkForce = $chkForce
$chkForce.Text = '强制编译'; $chkForce.Location = New-Object System.Drawing.Point(540, ($y - 2))
$chkForce.AutoSize = $true
$form.Controls.Add($chkForce)

$y += 30

$chkSkip = New-Object System.Windows.Forms.CheckBox
$script:ChkSkip = $chkSkip
$chkSkip.Text = '跳过编译'; $chkSkip.Location = New-Object System.Drawing.Point($pad, ($y - 2))
$chkSkip.AutoSize = $true
$form.Controls.Add($chkSkip)

$chkBootRun = New-Object System.Windows.Forms.CheckBox
$script:ChkBootRun = $chkBootRun
$chkBootRun.Text = 'bootRun'; $chkBootRun.Location = New-Object System.Drawing.Point(110, ($y - 2))
$chkBootRun.AutoSize = $true
$form.Controls.Add($chkBootRun)

$chkUseWt = New-Object System.Windows.Forms.CheckBox
$script:ChkUseWt = $chkUseWt
$chkUseWt.Text = 'Windows Terminal'; $chkUseWt.Location = New-Object System.Drawing.Point(200, ($y - 2))
$chkUseWt.AutoSize = $true
$form.Controls.Add($chkUseWt)

$chkAutoClose = New-Object System.Windows.Forms.CheckBox
$script:ChkAutoCloseTerminal = $chkAutoClose
$chkAutoClose.Text = '停止时自动关终端'
$chkAutoClose.Location = New-Object System.Drawing.Point(350, ($y - 2))
$chkAutoClose.AutoSize = $true
$chkAutoClose.Checked = $script:JavaToolAutoCloseTerminal
$chkAutoClose.Add_CheckedChanged({
    Set-JavaToolAutoCloseTerminalPreference -Enabled $script:ChkAutoCloseTerminal.Checked
    Update-HintText
})
$form.Controls.Add($chkAutoClose)

$y += 38

function New-Btn($text, $x, $w, $color) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text; $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, 36)
    $b.FlatStyle = 'Flat'; $b.BackColor = $color; $b.ForeColor = [Drawing.Color]::White
    $b.FlatAppearance.BorderSize = 0
    $form.Controls.Add($b); return $b
}

$btnStart = New-Btn '启动' $pad 90 ([Drawing.Color]::FromArgb(41, 128, 185))
$btnStop = New-Btn '停止' 108 70 ([Drawing.Color]::FromArgb(192, 57, 43))
$btnRestart = New-Btn '重启' 186 70 ([Drawing.Color]::FromArgb(142, 68, 173))
$btnBuild = New-Btn '仅编译' 264 70 ([Drawing.Color]::FromArgb(39, 174, 96))

$btnStart.Add_Click({ Start-SelectedInstance })
$btnStop.Add_Click({ Stop-SelectedInstance })
$btnRestart.Add_Click({ Start-SelectedInstance -Restart })
$btnBuild.Add_Click({ Start-SelectedInstance -BuildOnly })

$y += 46

$lblHint = New-Object System.Windows.Forms.Label
$script:LblHint = $lblHint
Update-HintText
$lblHint.Location = New-Object System.Drawing.Point($pad, $y)
$lblHint.Size = New-Object System.Drawing.Size(680, 36)
$lblHint.ForeColor = [Drawing.Color]::Gray
$form.Controls.Add($lblHint)

$script:StatusTimer = New-Object System.Windows.Forms.Timer
$script:StatusTimer.Interval = 2000
$script:StatusTimer.Add_Tick({ Update-ListStatus })
$script:StatusTimer.Start()

Initialize-ListRows
Update-ListStatus
[void]$form.ShowDialog()
