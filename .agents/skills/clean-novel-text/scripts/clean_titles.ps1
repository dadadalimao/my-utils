<#
.SYNOPSIS
    清洗小说章节标题：合并同一章的重复标题行，去掉 `111.` 这类序号与缩进，顺带检查整章重复和章号问题。

.DESCRIPTION
    - 同一章相邻两行标题（如 `111.第111章 X` + `　　第111章 X`）只留一行，统一成 `第N章 标题`。
    - 两行文字不同时保留更完整的一行，不按位置决定。
    - 章号不同的相邻标题不处理，只报告。
    - 正文、空行、换行符一律原样保留；加 -RemoveDuplicateChapters 才删除正文逐行相同的重复整章。
    - 只报告、不改动：章号重复、缺号、正文重叠导致的缺章。

.EXAMPLE
    pwsh -File clean_titles.ps1 -Source D:\novels\某书.txt

.EXAMPLE
    pwsh -File clean_titles.ps1 -Source D:\novels\某书.txt -RemoveDuplicateChapters
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$Source,

    # 输出目录，默认 <源文件目录>\output
    [string]$OutDir,

    # 逐处改动记录，默认 %TEMP%\title-clean-report.txt
    [string]$Report,

    # 删除正文逐行完全相同的重复整章（最后一章不删，避免删掉站点尾）
    [switch]$RemoveDuplicateChapters
)

$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)

$Source = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Source)
if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "找不到源文件: $Source" }
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $Source) 'output' }
else { $OutDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir) }
if (-not $Report) { $Report = Join-Path $env:TEMP 'title-clean-report.txt' }
else { $Report = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Report) }

# ---------------- 读取 ----------------
$raw = [System.IO.File]::ReadAllBytes($Source)
$hasBom = ($raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF)
$text = [System.Text.Encoding]::UTF8.GetString($raw)
if ($hasBom) { $text = $text.Substring(1) }

$eol = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$endsWithEol = $text.EndsWith($eol)
$lines = $text.Split([string[]]@($eol), [System.StringSplitOptions]::None)
$n = $lines.Count
if ($endsWithEol) { $n-- }   # 末尾空元素不算一行

# ---------------- 解析标题块 ----------------
$headRe = '^(?:(\d+)\.)?第(\d+)章[ \u3000\t]*(.*)$'
$contRe = '^[ \u3000\t]+(?:(\d+)\.)?第(\d+)章[ \u3000\t]*(.*)$'

$chapters = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $n; $i++) {
    if ($lines[$i] -match $headRe) {
        $block = New-Object System.Collections.Generic.List[int]
        $block.Add($i)
        $j = $i + 1
        while ($j -lt $n -and $lines[$j] -match $contRe) { $block.Add($j); $j++ }
        $chapters.Add([pscustomobject]@{
                Block    = $block
                First    = $i
                LastHead = ($j - 1)
                Num      = [int]([regex]::Match($lines[$i], '第(\d+)章').Groups[1].Value)
                BodyFrom = 0
                BodyTo   = -1
            })
        $i = $j - 1
    }
}
if ($chapters.Count -eq 0) { throw "没有找到章节标题（行首 第N章）: $Source" }

for ($k = 0; $k -lt $chapters.Count; $k++) {
    $c = $chapters[$k]
    $c.BodyFrom = $c.LastHead + 1
    $c.BodyTo = if ($k + 1 -lt $chapters.Count) { $chapters[$k + 1].First - 1 } else { $n - 1 }
}

# ---------------- 整章重复 ----------------
$removeSet = New-Object 'System.Collections.Generic.HashSet[int]'
$dupFound = New-Object System.Collections.Generic.List[object]
$seenBody = @{}
$sha = [System.Security.Cryptography.SHA256]::Create()

for ($k = 0; $k -lt $chapters.Count; $k++) {
    $c = $chapters[$k]
    $bodyText = if ($c.BodyFrom -le $c.BodyTo) { ($lines[$c.BodyFrom..$c.BodyTo]) -join "`n" } else { '' }
    $hash = [System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($bodyText)))
    $key = "$($c.Num)|$hash"
    if ($seenBody.ContainsKey($key)) {
        $dupFound.Add([pscustomobject]@{ Keep = $seenBody[$key]; Drop = $k })
        $isLast = ($k -eq $chapters.Count - 1)
        if ($RemoveDuplicateChapters -and -not $isLast) { [void]$removeSet.Add($k) }
    }
    else { $seenBody[$key] = $k }
}

# ---------------- 生成输出 ----------------
$out = New-Object System.Collections.Generic.List[string]
$rep = New-Object System.Collections.Generic.List[string]
$merged = 0
$longerKept = 0
$prefixed = 0
$mixed = 0
$headsOut = 0
$indentOut = 0
$insertedBlanks = 0
$removedLines = 0

# 第一章之前的书名头等原样保留
for ($p = 0; $p -lt $chapters[0].First; $p++) { $out.Add($lines[$p]) }

for ($k = 0; $k -lt $chapters.Count; $k++) {
    $c = $chapters[$k]

    if ($removeSet.Contains($k)) {
        $removedLines += ($c.BodyTo - $c.First + 1)
        $rep.Add("整章重复 L$($c.First + 1)-L$($c.BodyTo + 1): 第$($c.Num)章 正文与前面重复，已整章删除")
        continue
    }

    # ---- 标题 ----
    $firstLine = $lines[$c.First]
    $null = $firstLine -match $headRe
    $firstPrefix = [bool]$Matches[1]
    $num = [int]$Matches[2]
    $title = $Matches[3].TrimEnd()
    $num2 = 0

    if ($c.Block.Count -ge 2) {
        $secondLine = $lines[$c.Block[1]]
        $null = $secondLine -match $contRe
        $num2 = [int]$Matches[2]
        $title2 = $Matches[3].TrimEnd()

        if ($num2 -eq $num) {
            if ($title2.Length -ge $title.Length) {
                if ($title2 -cne $title) { $longerKept++ }
                $title = $title2
            }
            $merged++
            $rep.Add("合并标题 L$($c.First + 1) + L$($c.Block[1] + 1): '第${num}章 $title' <- ['$firstLine'] + ['$secondLine']")
        }
        else {
            $mixed++
            $rep.Add("章号不同 L$($c.First + 1)/L$($c.Block[1] + 1): 两行都保留 -> ['$firstLine'] / ['$secondLine']")
        }
    }
    if ($firstPrefix) { $prefixed++ }

    if ($out.Count -gt 0 -and $out[$out.Count - 1] -ne '') { $out.Add(''); $insertedBlanks++ }

    $newHead = "第${num}章"
    if ($title) { $newHead += " $title" }
    $out.Add($newHead)
    $headsOut++

    if ($num2 -ne 0 -and $num2 -ne $num) {
        $out.Add($lines[$c.Block[1]])   # 章号不同的第二行原样保留
        $indentOut++
    }

    # ---- 正文 ----
    if ($c.BodyFrom -le $c.BodyTo) {
        for ($p = $c.BodyFrom; $p -le $c.BodyTo; $p++) { $out.Add($lines[$p]) }
    }
}

# ---------------- 写文件 ----------------
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$target = Join-Path $OutDir ([System.IO.Path]::GetFileName($Source))
$outText = ($out -join $eol)
if ($endsWithEol) { $outText += $eol }
[System.IO.File]::WriteAllText($target, $outText, $enc)

# ---------------- 章号检查 ----------------
$nums = @($chapters | ForEach-Object { $_.Num })
$dupNums = @($nums | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { [int]$_.Name } | Sort-Object)
$maxNum = [int]($nums | Measure-Object -Maximum).Maximum
$minNum = [int]($nums | Measure-Object -Minimum).Minimum
$missing = @($minNum..$maxNum | Where-Object { $_ -notin $nums })

# ---------------- 报告 ----------------
$rp = New-Object System.Collections.Generic.List[string]
$rp.Add("# 标题清洗记录 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$rp.Add("# 源文件: $Source")
$rp.Add("# 输出:   $target")
$rp.Add('')
$rp.Add("## 标题合并（$merged 处，其中带序号 $prefixed 处，选用更长的一行 $longerKept 处）")
$mergedLines = [string[]]@($rep | Where-Object { $_ -like '合并标题*' })
if ($mergedLines.Count) { $rp.AddRange($mergedLines) }
$rp.Add('')
$rp.Add("## 章号不同的相邻标题（$mixed 处，原样保留）")
$mixedLines = [string[]]@($rep | Where-Object { $_ -like '章号不同*' })
if ($mixedLines.Count) { $rp.AddRange($mixedLines) }
$rp.Add('')
$rp.Add("## 整章重复（$($dupFound.Count) 处）")
foreach ($d in $dupFound) {
    $kc = $chapters[$d.Keep]; $dc = $chapters[$d.Drop]
    $state = if ($removeSet.Contains($d.Drop)) { '已删除' } else { '仅报告' }
    $rp.Add("第$($dc.Num)章 L$($dc.First + 1) 与 L$($kc.First + 1) 正文逐行相同 -> $state")
}
$rp.Add('')
$rp.Add('## 章号重复（正文不同则两个都保留）')
$rp.Add($(if ($dupNums.Count) { ($dupNums | ForEach-Object { "第${_}章" }) -join '、' } else { '无' }))
$rp.Add('')
$rp.Add('## 缺号')
$rp.Add($(if ($missing.Count) { ($missing | ForEach-Object { "第${_}章" }) -join '、' } else { '无' }))
$rp.Add('')
[System.IO.File]::WriteAllText($Report, (($rp -join "`r`n") + "`r`n"), $enc)

# ---------------- 校验 ----------------
$chk = Get-Content -LiteralPath $target -Encoding UTF8
$headChk = @($chk | Where-Object { $_ -match $headRe })
$indentChk = @($chk | Where-Object { $_ -match $contRe })
$prefixChk = @($chk | Where-Object { $_ -match '^\d+\.第\d+章' })
$trailChk = @($headChk | Where-Object { $_ -ne $_.TrimEnd() })
$verr = New-Object System.Collections.Generic.List[string]
if ($headChk.Count -ne $headsOut) { $verr.Add("标题行数 $($headChk.Count) != 预期 $headsOut") }
if ($indentChk.Count -ne $indentOut) { $verr.Add("缩进标题行 $($indentChk.Count) != 章号不同处 $indentOut") }
if ($prefixChk.Count -ne 0) { $verr.Add("仍有 $($prefixChk.Count) 行带 N. 序号") }
if ($trailChk.Count -ne 0) { $verr.Add("仍有 $($trailChk.Count) 行标题带行尾空白") }
$ok = ($verr.Count -eq 0)

# ---------------- 控制台汇总 ----------------
"源文件   : $Source"
"输出     : $target"
"报告     : $Report"
"标题行   : $($chapters.Count) 章，输出 $headsOut 行（合并 $merged 处，其中带序号 $prefixed 处，选长版 $longerKept 处）"
"章号不同 : $mixed 处（原样保留，见报告）"
"整章重复 : $($dupFound.Count) 处（删除 $($removeSet.Count) 章，仅报告 $($dupFound.Count - $removeSet.Count) 章）"
"章号重复 : $(if ($dupNums.Count) { ($dupNums -join ', ') } else { '无' })"
"缺号     : $(if ($missing.Count) { ($missing -join ', ') } else { '无' })"
"删除行数 : $removedLines，补空行 $insertedBlanks"
"校验     : $(if ($ok) { 'PASS' } else { 'FAIL: ' + ($verr -join '；') })"
if (-not $ok) { exit 1 }
