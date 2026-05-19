' 静默启动 GUI（CreateNoWindow，不依赖 Linux screen）
Option Explicit

Dim shell, fso, scriptDir, launcher, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = scriptDir & "\launch-gui.ps1"

If Not fso.FileExists(launcher) Then
    MsgBox "找不到脚本：" & launcher, vbCritical, "启动失败"
    WScript.Quit 1
End If

shell.CurrentDirectory = scriptDir

' 外层短暂隐藏启动 launch-gui.ps1，由其以 CreateNoWindow 拉起 GUI 进程（无控制台、无任务栏 PS）
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & launcher & """"

On Error Resume Next
shell.Run cmd, 0, False
If Err.Number <> 0 Then
    MsgBox "启动失败：" & Err.Description, vbCritical, "启动失败"
    WScript.Quit Err.Number
End If
