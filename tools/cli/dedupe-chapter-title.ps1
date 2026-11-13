# 去掉紧挨着的重复章节标题。
# 常见于正文把章名又缩进抄了一遍：
#   第1章 标题
#   　　第1章 标题
# 只删后一行；中间隔了空行或正文的不处理。
#
# 用法：
#   pwsh -File tools/cli/dedupe-chapter-title.ps1 -Path "书.txt"
#   pwsh -File tools/cli/dedupe-chapter-title.ps1 -Path "书.txt" -OutPath "书.fixed.txt"
#   pwsh -File tools/cli/dedupe-chapter-title.ps1 -Path "书.txt" -InPlace

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter()]
    [string]$OutPath,

    [Parameter()]
    [switch]$InPlace,

    [Parameter()]
    [switch]$NoBackup,

    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
# 小说 txt 与速读谷导出一致，按 UTF-8 无 BOM 读写
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false
# 阿拉伯数字、全角数字、中文数字都算章序号
$script:ChapterPattern = '^第[0-9０-９一二三四五六七八九十百千万零〇两]+章'

<#
.SYNOPSIS
判断一行去掉首尾空白后是不是章节标题。
#>
function Test-ChapterTitleLine {
    param([string]$Line)
    $text = $Line.Trim()
    return ($text.Length -gt 0) -and ($text -match $script:ChapterPattern)
}

<#
.SYNOPSIS
探测文件换行符，写出时沿用，避免整本被改成另一种换行。
#>
function Get-FileNewLine {
    param([string]$FilePath)

    $stream = [System.IO.File]::OpenRead($FilePath)
    try {
        $buf = New-Object byte[] 8192
        $read = $stream.Read($buf, 0, $buf.Length)
        for ($i = 0; $i -lt ($read - 1); $i++) {
            if ($buf[$i] -eq 13 -and $buf[$i + 1] -eq 10) { return "`r`n" }
        }
        for ($i = 0; $i -lt $read; $i++) {
            if ($buf[$i] -eq 10) { return "`n" }
            if ($buf[$i] -eq 13) { return "`r" }
        }
        return "`r`n"
    }
    finally {
        $stream.Dispose()
    }
}

if ($InPlace -and -not [string]::IsNullOrWhiteSpace($OutPath)) {
    Write-Host "-InPlace 与 -OutPath 只能选一个。" -ForegroundColor Red
    exit 1
}

$sourcePath = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    Write-Host "文件不存在: $sourcePath" -ForegroundColor Red
    exit 1
}

$writeOutput = $InPlace -or -not [string]::IsNullOrWhiteSpace($OutPath)
$targetPath = $null
$tempPath = $null
$backupPath = $null

if ($InPlace) {
    $tempPath = "$sourcePath.dedupe.tmp"
    $backupPath = "$sourcePath.bak"
    $targetPath = $tempPath
}
elseif ($writeOutput) {
    $targetPath = [System.IO.Path]::GetFullPath($OutPath)
    if ((Test-Path -LiteralPath $targetPath) -and -not $Force) {
        Write-Host "输出已存在，跳过（可用 -Force 覆盖）: $targetPath" -ForegroundColor Yellow
        exit 1
    }
    if ($targetPath -eq $sourcePath) {
        Write-Host "-OutPath 不能与原文件相同，覆盖请用 -InPlace。" -ForegroundColor Red
        exit 1
    }
}

if ($writeOutput -and -not $PSCmdlet.ShouldProcess($sourcePath, "去掉重复章节标题")) {
    exit 0
}

if ($InPlace -and -not $NoBackup -and (Test-Path -LiteralPath $backupPath) -and -not $Force) {
    Write-Host "备份已存在，跳过（可用 -Force 覆盖备份）: $backupPath" -ForegroundColor Yellow
    exit 1
}

$newline = Get-FileNewLine -FilePath $sourcePath
$reader = New-Object System.IO.StreamReader($sourcePath, $script:Utf8NoBom, $true)
$writer = $null
if ($writeOutput) {
    $writer = New-Object System.IO.StreamWriter($targetPath, $false, $script:Utf8NoBom)
    $writer.NewLine = $newline
}

$removed = 0
$lineNo = 0
$pending = $null
$pendingTitle = $false
$samples = New-Object System.Collections.Generic.List[string]

try {
    while ($null -ne ($line = $reader.ReadLine())) {
        $lineNo++
        $isTitle = Test-ChapterTitleLine -Line $line
        $trimmed = $line.Trim()

        # 上一行已是章名，本行去掉缩进后完全相同，则本行是重复章名
        if ($pendingTitle -and $isTitle -and $trimmed -eq $pending.Trim()) {
            $removed++
            if ($samples.Count -lt 8) {
                $samples.Add(("{0}: {1}" -f $lineNo, $trimmed))
            }
            continue
        }

        if ($null -ne $pending -and $null -ne $writer) {
            $writer.Write($pending)
            $writer.Write($newline)
        }
        $pending = $line
        $pendingTitle = $isTitle
    }

    if ($null -ne $pending -and $null -ne $writer) {
        $writer.Write($pending)
        $writer.Write($newline)
    }
}
finally {
    $reader.Dispose()
    if ($null -ne $writer) {
        $writer.Dispose()
    }
}

Write-Host "文件: $sourcePath"
Write-Host ("重复章节标题: {0} 处" -f $removed)
foreach ($sample in $samples) {
    Write-Host ("  {0}" -f $sample)
}
if ($removed -gt $samples.Count) {
    Write-Host ("  ... 其余 {0} 处已省略" -f ($removed - $samples.Count))
}

if (-not $writeOutput) {
    Write-Host ""
    Write-Host "未改文件。写出副本: -OutPath `"路径`""
    Write-Host "直接改原文件并留 .bak: -InPlace"
    exit 0
}

if ($removed -eq 0) {
    if ($InPlace -and (Test-Path -LiteralPath $tempPath)) {
        Remove-Item -LiteralPath $tempPath -Force
    }
    elseif (-not $InPlace -and (Test-Path -LiteralPath $targetPath)) {
        Remove-Item -LiteralPath $targetPath -Force
    }
    Write-Host "没有可删除的重复行，未写出文件。"
    exit 0
}

if ($InPlace) {
    if (-not $NoBackup) {
        Copy-Item -LiteralPath $sourcePath -Destination $backupPath -Force
        Write-Host "已备份: $backupPath"
    }
    Move-Item -LiteralPath $tempPath -Destination $sourcePath -Force
    Write-Host "已写回: $sourcePath"
}
else {
    Write-Host "已写出: $targetPath"
}
