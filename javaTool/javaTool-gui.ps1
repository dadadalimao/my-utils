# 功能：智慧水务后端 - 终端管理工具（启动 = 打开终端并执行 stp-service.ps1）
#Requires -Version 5.1

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'StpService.Core.ps1')

if (-not (Invoke-StpGuiSingleInstanceOrActivate)) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:ServiceScript = Join-Path $PSScriptRoot 'stp-service.ps1'
$script:PsExe = (Get-Command powershell.exe -ErrorAction Stop).Source

function Get-UiParams {
    $mod = [string]$script:ComboModule.SelectedItem
    $root = $script:TxtProject.Text.Trim()
    $profile = $script:TxtProfile.Text.Trim()

    if (-not $mod) {
        [System.Windows.Forms.MessageBox]::Show('请选择模块', '提示') | Out-Null
        return $null
    }
    if (-not $root) {
        [System.Windows.Forms.MessageBox]::Show('请填写项目路径', '提示') | Out-Null
        return $null
    }
    if (-not (Test-Path $root)) {
        [System.Windows.Forms.MessageBox]::Show("项目路径不存在:`n$root", '提示') | Out-Null
        return $null
    }

    try { Set-StpSavedProjectRoot -ProjectRoot $root } catch { }

    $args = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $script:ServiceScript,
        '-Module', $mod,
        '-ProjectRoot', $root
    )
    # Profile 可能含逗号（如 dao,dev），必须作为单个参数传递
    if ($profile) { $args += '-Profile'; $args += $profile }
    if ($script:ChkKillPort.Checked) { $args += '-KillPort' }
    if ($script:ChkForce.Checked) { $args += '-Force' }
    if ($script:ChkSkip.Checked) { $args += '-SkipBuild' }
    if ($script:ChkBootRun.Checked) { $args += '-BootRun' }

    return @{ Module = $mod; Root = $root; Args = $args }
}

function Invoke-StpStopHidden {
    param($UiParams)

    $stopArgs = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', $script:ServiceScript,
        '-Module', $UiParams.Module,
        '-ProjectRoot', $UiParams.Root,
        '-Stop'
    )
    return Start-Process -FilePath $script:PsExe -ArgumentList $stopArgs -Wait -PassThru -WindowStyle Hidden
}

function Open-Terminal {
    param(
        [string[]] $PsArgs,
        [string] $ModuleName
    )

    Close-StpTerminalSession -ModuleName $ModuleName | Out-Null

    # 默认独立控制台（标题 STP-GUI-*，停止可关窗）；WT 杀子进程后标签常残留
    if ($script:ChkUseWt.Checked) {
        $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
        if ($wt) {
            $title = Get-StpTerminalWindowTitle -ModuleName $ModuleName
            $wtArgs = @('new-tab', '--title', $title, 'powershell', '-NoExit') + $PsArgs
            Start-Process -FilePath $wt.Source -ArgumentList $wtArgs
            return 'Windows Terminal'
        }
    }

    return (Start-StpLogTerminal -ModuleName $ModuleName -PsExe $script:PsExe -PsArgs $PsArgs)
}

function Start-InTerminal {
    param([switch] $BuildOnly, [switch] $Restart)

    $p = Get-UiParams
    if (-not $p) { return }

    if ($script:ChkForce.Checked -and $script:ChkSkip.Checked) {
        [System.Windows.Forms.MessageBox]::Show('已勾选「强制编译」，将忽略「跳过编译」', '提示') | Out-Null
    }

    if ($Restart) {
        Close-StpTerminalSession -ModuleName $p.Module | Out-Null
        $stopProc = Invoke-StpStopHidden -UiParams $p
        if ($stopProc.ExitCode -ne 0) {
            $script:LblHint.Text = "停止旧服务异常，退出码 $($stopProc.ExitCode)，仍将尝试重启"
        }
    }

    $args = @($p.Args)
    if ($BuildOnly) { $args += '-BuildOnly' }
    if ($Restart) { $args += '-Restart' }

    $kind = Open-Terminal -PsArgs $args -ModuleName $p.Module
    $action = if ($Restart) { '重启' } elseif ($BuildOnly) { '仅编译' } else { '启动' }
    $script:LblHint.Text = "已打开 $kind 窗口：$action $($p.Module)"
    Update-StatusLabel
}

function Stop-ServiceQuick {
    $p = Get-UiParams
    if (-not $p) { return }

    # 先关终端（含 Java 子进程），再隐藏 Stop 确保端口释放
    $closed = Close-StpTerminalSession -ModuleName $p.Module
    $proc = Invoke-StpStopHidden -UiParams $p

    Update-StatusLabel
    $msg = if ($proc.ExitCode -eq 0) { '已停止服务（端口已释放）' } else { "停止完成，退出码 $($proc.ExitCode)" }
    if ($closed) { $msg += '，已关闭日志终端' }
    else { $msg += '；若终端仍停留请手动关标签' }
    $script:LblHint.Text = $msg
}

function Update-StpHintText {
    if ($script:StpAutoCloseTerminal) {
        $script:LblHint.Text = '独立控制台：停止可自动关窗；Gradle 日志直接输出到终端'
    }
    else {
        $script:LblHint.Text = '已关闭自动关窗：停止/重启不会关终端，便于查看编译日志'
    }
}

function Update-StatusLabel {
    $mod = [string]$script:ComboModule.SelectedItem
    if (-not $mod) { return }
    $port = $script:StpModuleConfig[$mod].Port
    if ($port -and (Test-StpPortListening -Port $port)) {
        $script:LblStatus.Text = "运行中 · 端口 $port"
        $script:LblStatus.ForeColor = [Drawing.Color]::FromArgb(39, 174, 96)
    }
    else {
        $script:LblStatus.Text = '未运行'
        $script:LblStatus.ForeColor = [Drawing.Color]::FromArgb(127, 140, 141)
    }
}

# ---------------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = $script:StpGuiWindowTitle
$form.Size = New-Object System.Drawing.Size(520, 378)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Add_FormClosed({ Release-StpGuiSingleInstance })

$y = 16; $pad = 14

$lblMod = New-Object System.Windows.Forms.Label
$lblMod.Text = '模块'; $lblMod.Location = New-Object System.Drawing.Point($pad, $y); $lblMod.AutoSize = $true
$form.Controls.Add($lblMod)

$combo = New-Object System.Windows.Forms.ComboBox
$script:ComboModule = $combo
$combo.Location = New-Object System.Drawing.Point(72, ($y - 3))
$combo.Size = New-Object System.Drawing.Size(140, 28)
$combo.DropDownStyle = 'DropDownList'
[void]$combo.Items.AddRange(@('admin', 'prec-aer'))
$combo.SelectedIndex = 0
$form.Controls.Add($combo)

$lblStatus = New-Object System.Windows.Forms.Label
$script:LblStatus = $lblStatus
$lblStatus.Text = '未运行'
$lblStatus.Location = New-Object System.Drawing.Point(230, $y)
$lblStatus.AutoSize = $true
$lblStatus.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9, [Drawing.FontStyle]::Bold)
$form.Controls.Add($lblStatus)

$y += 38

$lblRoot = New-Object System.Windows.Forms.Label
$lblRoot.Text = '项目'; $lblRoot.Location = New-Object System.Drawing.Point($pad, $y); $lblRoot.AutoSize = $true
$form.Controls.Add($lblRoot)

$txtProject = New-Object System.Windows.Forms.TextBox
$script:TxtProject = $txtProject
$txtProject.Location = New-Object System.Drawing.Point(72, ($y - 3))
$txtProject.Size = New-Object System.Drawing.Size(330, 28)
$txtProject.Text = Get-StpSavedProjectRoot
$form.Controls.Add($txtProject)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = '...'
$btnBrowse.Location = New-Object System.Drawing.Point(408, ($y - 4))
$btnBrowse.Size = New-Object System.Drawing.Size(36, 28)
$btnBrowse.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($script:TxtProject.Text -and (Test-Path $script:TxtProject.Text)) { $dlg.SelectedPath = $script:TxtProject.Text }
    if ($dlg.ShowDialog() -eq 'OK') { $script:TxtProject.Text = $dlg.SelectedPath }
})
$form.Controls.Add($btnBrowse)

$y += 38

$lblProfile = New-Object System.Windows.Forms.Label
$lblProfile.Text = 'Profile'; $lblProfile.Location = New-Object System.Drawing.Point($pad, $y); $lblProfile.AutoSize = $true
$form.Controls.Add($lblProfile)

$txtProfile = New-Object System.Windows.Forms.TextBox
$script:TxtProfile = $txtProfile
$txtProfile.Location = New-Object System.Drawing.Point(72, ($y - 3))
$txtProfile.Size = New-Object System.Drawing.Size(160, 28)
$txtProfile.Text = 'dao,dev'
$form.Controls.Add($txtProfile)

$chkKill = New-Object System.Windows.Forms.CheckBox
$script:ChkKillPort = $chkKill
$chkKill.Text = '启动前释放端口'; $chkKill.Location = New-Object System.Drawing.Point(250, ($y - 2))
$chkKill.AutoSize = $true; $chkKill.Checked = $true
$form.Controls.Add($chkKill)

$chkForce = New-Object System.Windows.Forms.CheckBox
$script:ChkForce = $chkForce
$chkForce.Text = '强制编译'; $chkForce.Location = New-Object System.Drawing.Point(380, ($y - 2))
$chkForce.AutoSize = $true
$form.Controls.Add($chkForce)

$y += 30

$chkSkip = New-Object System.Windows.Forms.CheckBox
$script:ChkSkip = $chkSkip
$chkSkip.Text = '跳过编译'; $chkSkip.Location = New-Object System.Drawing.Point(72, ($y - 2))
$chkSkip.AutoSize = $true
$form.Controls.Add($chkSkip)

$chkBootRun = New-Object System.Windows.Forms.CheckBox
$script:ChkBootRun = $chkBootRun
$chkBootRun.Text = 'bootRun（日志更全）'; $chkBootRun.Location = New-Object System.Drawing.Point(180, ($y - 2))
$chkBootRun.AutoSize = $true
$form.Controls.Add($chkBootRun)

$chkUseWt = New-Object System.Windows.Forms.CheckBox
$script:ChkUseWt = $chkUseWt
$chkUseWt.Text = 'Windows Terminal'; $chkUseWt.Location = New-Object System.Drawing.Point(330, ($y - 2))
$chkUseWt.AutoSize = $true; $chkUseWt.Checked = $false
$form.Controls.Add($chkUseWt)

$y += 30

$chkAutoClose = New-Object System.Windows.Forms.CheckBox
$script:ChkAutoCloseTerminal = $chkAutoClose
$chkAutoClose.Text = '停止时自动关终端'
$chkAutoClose.Location = New-Object System.Drawing.Point(72, ($y - 2))
$chkAutoClose.AutoSize = $true
$chkAutoClose.Checked = $script:StpAutoCloseTerminal
$chkAutoClose.Add_CheckedChanged({
    Set-StpAutoCloseTerminalPreference -Enabled $script:ChkAutoCloseTerminal.Checked
    Update-StpHintText
})
$form.Controls.Add($chkAutoClose)

$y += 38

function New-Btn($text, $x, $w, $color) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $text; $b.Location = New-Object System.Drawing.Point($x, $y)
    $b.Size = New-Object System.Drawing.Size($w, 40)
    $b.FlatStyle = 'Flat'; $b.BackColor = $color; $b.ForeColor = [Drawing.Color]::White
    $b.FlatAppearance.BorderSize = 0
    $form.Controls.Add($b); return $b
}

$btnStart = New-Btn '打开终端启动' $pad 130 ([Drawing.Color]::FromArgb(41, 128, 185))
$btnStop = New-Btn '停止' 152 80 ([Drawing.Color]::FromArgb(192, 57, 43))
$btnRestart = New-Btn '重启' 242 80 ([Drawing.Color]::FromArgb(142, 68, 173))
$btnBuild = New-Btn '仅编译' 332 80 ([Drawing.Color]::FromArgb(39, 174, 96))

$btnStart.Add_Click({ Start-InTerminal })
$btnStop.Add_Click({ Stop-ServiceQuick })
$btnRestart.Add_Click({ Start-InTerminal -Restart })
$btnBuild.Add_Click({ Start-InTerminal -BuildOnly })

$y += 52

$lblHint = New-Object System.Windows.Forms.Label
$script:LblHint = $lblHint
Update-StpHintText
$lblHint.Location = New-Object System.Drawing.Point($pad, $y)
$lblHint.Size = New-Object System.Drawing.Size(460, 40)
$lblHint.ForeColor = [Drawing.Color]::Gray
$form.Controls.Add($lblHint)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-StatusLabel })
$timer.Start()

Update-StatusLabel
[void]$form.ShowDialog()
