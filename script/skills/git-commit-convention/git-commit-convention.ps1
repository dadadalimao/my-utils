param(
  [string]$Message,

  [string[]]$Paths,

  [switch]$Push,

  [switch]$Help

)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Text) {
  Write-Host "[INFO] $Text" -ForegroundColor Cyan
}

function Write-WarnText([string]$Text) {
  Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function Fail([string]$Text) {
  Write-Error $Text
  exit 1
}

# 帮助信息（便于 agent/人快速理解参数）
function Show-Help {
  Write-Host "git-commit-convention.ps1 使用说明" -ForegroundColor Green
  Write-Host ""
  Write-Host "必填参数："
  Write-Host "  -Message   约定式提交说明：<type>: <描述> 或 <type>(<scope>): <描述>"
  Write-Host ""
  Write-Host "可选参数："
  Write-Host "  -Paths     仅提交指定文件路径（数组），例如：-Paths 'src/a.ts','src/b.ts'"
  Write-Host "  -Push       提交后执行 git push"
  Write-Host "  -Help       显示帮助并退出"
  Write-Host ""
  Write-Host "示例："
  Write-Host "  & `"<scriptPath>`" -Message `"fix: 优化数字人连接时序`""
  Write-Host "  & `"<scriptPath>`" -Message `"fix: 调整webrtc协商逻辑`" -Paths `"src/a.ts`",""src/b.ts`""
  Write-Host "  & `"<scriptPath>`" -Message `"fix: xxxx`" -Push"
}

if ($Help.IsPresent -or [string]::IsNullOrWhiteSpace($Message)) {
  Show-Help
  exit 0
}

# 1) 确认当前目录是 git 仓库
$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
  Fail "当前目录不是 git 仓库，请先切换到目标项目根目录。"
}

Write-Info "仓库根目录: $repoRoot"

# 2) 校验提交信息（一句话约定式提交）
# 允许: feat: xxx / fix(scope): xxx 等
$messagePattern = '^(feat|fix|docs|style|refactor|test|chore)(\([^)]+\))?: .+'
if ($Message -notmatch $messagePattern) {
  Fail "提交说明不符合规范。示例：fix: 修复数字人连接时序问题"
}

# 3) 获取变更文件并处理“前端仅 config.dev 不提交”限制
$changedFiles = @(git status --porcelain | ForEach-Object {
    if ($_ -match '^.{2}\s+(.*)$') { $matches[1] }
  }) | Where-Object { $_ } | Select-Object -Unique

if ($changedFiles.Count -eq 0) {
  Write-WarnText "没有可提交的变更。"
  exit 0
}

$repoName = Split-Path -Path $repoRoot -Leaf
$isFrontRepo = $repoName -eq 'sewage-treatment-plant-front'
$configDevOnly = $true
foreach ($file in $changedFiles) {
  if ($file -ne 'config/config.dev.ts' -and -not $file.StartsWith('config/config.dev.')) {
    $configDevOnly = $false
    break
  }
}

if ($isFrontRepo -and $configDevOnly) {
  Write-WarnText "检测到仅 config.dev 相关变更，按规范不执行提交。"
  exit 0
}

# 4) 暂存（默认全部；可指定路径）
if ($Paths -and $Paths.Count -gt 0) {
  Write-Info "按指定路径暂存: $($Paths -join ', ')"
  git add -- $Paths
} else {
  Write-Info "暂存全部变更"
  git add -A
}

# 5) 再次确认有可提交内容
$staged = git diff --cached --name-only
if (-not $staged) {
  Write-WarnText "没有已暂存内容，跳过提交。"
  exit 0
}

# 6) 提交
Write-Info "执行提交: $Message"
git commit -m $Message

# 7) 按需 push
if ($Push.IsPresent) {
  Write-Info "执行 push"
  git push
}

Write-Info "完成"
