# 按书名合并「书名(起-止章).txt」分卷为完整 txt
# 用法：
#   pwsh -File tools/cli/merge-novel-txt.ps1
#   powershell -File tools/cli/merge-novel-txt.ps1 -Path "C:\Users\sheng\Desktop\txt\3"
# 默认输出到「所在文件夹/output」

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [string]$Path = (Get-Location).Path,

    [Parameter()]
    [string]$OutDir,

    [Parameter()]
    [switch]$DeleteSource,

    [Parameter()]
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
# 源文件为 UTF-8 无 BOM（与速读谷导出一致）
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false

<#
.SYNOPSIS
从文件名解析书名与章节区间。
#>
function Get-NovelVolumeInfo {
    param([System.IO.FileInfo]$File)

    # 贪婪匹配书名，回退到最后一个「(数字-数字章)」
    if ($File.Name -notmatch '^(?<name>.+)\((?<start>\d+)-(?<end>\d+)章\)\.txt$') {
        return $null
    }

    return [pscustomobject]@{
        File      = $File
        Name      = $Matches['name']
        Start     = [int]$Matches['start']
        End       = [int]$Matches['end']
        FullName  = $File.FullName
    }
}

<#
.SYNOPSIS
去掉分卷开头重复的书名 / 作者 / 来源头（仅后续卷使用）。
#>
function Remove-NovelVolumeHeader {
    param([string]$Text)

    $pattern = '^《[^\r\n]+》\r?\n作者：[^\r\n]+\r?\n来源：[^\r\n]+\r?\n网址：[^\r\n]+\r?\n+'
    return [regex]::Replace($Text, $pattern, '', 1)
}

<#
.SYNOPSIS
去掉分卷末尾站点推广页脚（末卷保留）。
#>
function Remove-NovelVolumeFooter {
    param([string]$Text)

    $pattern = '\r?\n+更多精彩小说，请访问：[^\r\n]+\s*$'
    return [regex]::Replace($Text, $pattern, '', 1)
}

function Read-Utf8File {
    param([string]$FilePath)
    return [System.IO.File]::ReadAllText($FilePath, $script:Utf8NoBom)
}

function Write-Utf8File {
    param([string]$FilePath, [string]$Content)
    [System.IO.File]::WriteAllText($FilePath, $Content, $script:Utf8NoBom)
}

$workDir = [System.IO.Path]::GetFullPath($Path)
if (-not (Test-Path -LiteralPath $workDir -PathType Container)) {
    Write-Host "目录不存在: $workDir" -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $workDir 'output'
}
else {
    $OutDir = [System.IO.Path]::GetFullPath($OutDir)
}

if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$volumes = Get-ChildItem -LiteralPath $workDir -File -Filter '*.txt' |
    ForEach-Object { Get-NovelVolumeInfo -File $_ } |
    Where-Object { $null -ne $_ }

if ($volumes.Count -eq 0) {
    Write-Host "未找到「书名(起-止章).txt」格式的文件。"
    Write-Host "查找目录: $workDir"
    exit 0
}

$groups = $volumes | Group-Object -Property Name
Write-Host "查找目录: $workDir"
Write-Host "输出目录: $OutDir"
Write-Host ("共 {0} 个分卷，{1} 部书。" -f $volumes.Count, $groups.Count)
Write-Host ""

$mergedCount = 0
$skippedCount = 0

foreach ($group in $groups) {
    $bookName = $group.Name
    $parts = @($group.Group | Sort-Object Start, End)

    if ($parts.Count -eq 1) {
        Write-Host "跳过（已是单文件）: $($parts[0].File.Name)"
        $skippedCount++
        continue
    }

    $startChapter = $parts[0].Start
    $endChapter = ($parts | Measure-Object -Property End -Maximum).Maximum
    $outName = "{0}({1}-{2}章).txt" -f $bookName, $startChapter, $endChapter
    $outPath = Join-Path $OutDir $outName

    $sourcePaths = @($parts | ForEach-Object { $_.FullName })
    if ($sourcePaths -contains $outPath) {
        Write-Warning "跳过（输出名与某个分卷相同）: $outName"
        $skippedCount++
        continue
    }

    if ((Test-Path -LiteralPath $outPath) -and -not $Force) {
        Write-Warning "已存在，跳过（可用 -Force 覆盖）: $outName"
        $skippedCount++
        continue
    }

    # 检查章节是否连续，有缺口仍合并但给出提示
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $expected = $parts[$i - 1].End + 1
        if ($parts[$i].Start -ne $expected) {
            Write-Warning ("{0}: 章节可能不连续（{1}-{2} 之后是 {3}-{4}）" -f `
                $bookName, $parts[$i - 1].Start, $parts[$i - 1].End, $parts[$i].Start, $parts[$i].End)
        }
        if ($parts[$i].Start -le $parts[$i - 1].End) {
            Write-Warning ("{0}: 章节区间重叠（{1}-{2} 与 {3}-{4}）" -f `
                $bookName, $parts[$i - 1].Start, $parts[$i - 1].End, $parts[$i].Start, $parts[$i].End)
        }
    }

    $preview = ($parts | ForEach-Object { "{0}-{1}" -f $_.Start, $_.End }) -join ' + '
    if (-not $PSCmdlet.ShouldProcess($outName, "合并 $preview")) {
        continue
    }

    Write-Host "合并: $bookName"
    Write-Host "  $preview -> $outName"

    $builder = New-Object System.Text.StringBuilder
    $lastIndex = $parts.Count - 1
    for ($i = 0; $i -lt $parts.Count; $i++) {
        $text = Read-Utf8File -FilePath $parts[$i].FullName
        # 第一卷保留书名头；后续卷去掉重复头，避免整书出现多次作者/来源
        if ($i -gt 0) {
            $text = Remove-NovelVolumeHeader -Text $text
        }
        # 非末卷去掉站点页脚，只在全书末尾留一次
        if ($i -lt $lastIndex) {
            $text = Remove-NovelVolumeFooter -Text $text
        }
        $text = $text.TrimEnd()
        [void]$builder.Append($text)
        if ($i -lt $lastIndex) {
            [void]$builder.Append("`r`n`r`n")
        }
        else {
            [void]$builder.Append("`r`n")
        }
        Write-Host ("  已读 {0} ({1:N1} MB)" -f $parts[$i].File.Name, ($parts[$i].File.Length / 1MB))
    }

    Write-Utf8File -FilePath $outPath -Content $builder.ToString()
    $outSize = (Get-Item -LiteralPath $outPath).Length
    Write-Host ("  写出 {0} ({1:N1} MB)" -f $outName, ($outSize / 1MB))

    if ($DeleteSource) {
        foreach ($part in $parts) {
            Remove-Item -LiteralPath $part.FullName -Force
            Write-Host "  已删除分卷: $($part.File.Name)"
        }
    }

    $mergedCount++
    Write-Host ""
}

Write-Host ("完成。合并 {0} 部，跳过 {1} 部。" -f $mergedCount, $skippedCount)
if (-not $DeleteSource -and $mergedCount -gt 0) {
    Write-Host "原分卷已保留。确认无误后可用 -DeleteSource 删除分卷。"
}
