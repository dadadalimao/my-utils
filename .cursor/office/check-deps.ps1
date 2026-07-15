# Office Skills 依赖自检脚本
# 用法: .\check-deps.ps1
# 退出码: 0=全部就绪, 1=存在缺失

$ErrorActionPreference = "SilentlyContinue"
$OfficeDir = $PSScriptRoot
$VenvPython = Join-Path $OfficeDir ".venv\Scripts\python.exe"
$NodeModules = Join-Path $OfficeDir "node_modules"

$script:Missing = 0
$script:Warn = 0

function Write-Status {
    param(
        [ValidateSet("OK", "MISS", "WARN")]
        [string]$Level,
        [string]$Name,
        [string]$Detail = ""
    )
    $icon = switch ($Level) {
        "OK"   { "[OK]  " }
        "MISS" { "[MISS]" ; $script:Missing++ }
        "WARN" { "[WARN]" ; $script:Warn++ }
    }
    $line = "$icon $Name"
    if ($Detail) { $line += " — $Detail" }
    Write-Host $line
}

function Get-CommandPath {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Find-WindowsTool {
    param(
        [string]$CommandName,
        [string[]]$CandidatePaths
    )
    $fromPath = Get-CommandPath $CommandName
    if ($fromPath) {
        return @{ Found = $true; Path = $fromPath; InPath = $true }
    }
    foreach ($p in $CandidatePaths) {
        if (Test-Path $p) {
            return @{ Found = $true; Path = $p; InPath = $false }
        }
    }
    return @{ Found = $false; Path = $null; InPath = $false }
}

function Test-PythonImport {
    param(
        [string]$PythonExe,
        [string]$ModuleName
    )
    $code = "import importlib.util; import sys; sys.exit(0 if importlib.util.find_spec('$ModuleName') else 1)"
    & $PythonExe -c $code 2>$null
    return ($LASTEXITCODE -eq 0)
}

function Test-NodePackage {
    param([string]$PackageName)
    $pkgDir = Join-Path $NodeModules $PackageName
    if (Test-Path (Join-Path $pkgDir "package.json")) { return $true }
    # scoped packages e.g. @scope/name
    if ($PackageName -match "^@") {
        $parts = $PackageName -split "/"
        $scoped = Join-Path $NodeModules ($parts[0] + "\" + $parts[1])
        return (Test-Path (Join-Path $scoped "package.json"))
    }
    return $false
}

Write-Host ""
Write-Host "Office Skills 依赖检查"
Write-Host "目录: $OfficeDir"
Write-Host ("=" * 60)

# --- Runtimes ---
Write-Host "`n## 运行时"
foreach ($item in @(
    @{ Name = "python"; Cmd = "python"; Args = @("--version") },
    @{ Name = "node"; Cmd = "node"; Args = @("--version") },
    @{ Name = "npm"; Cmd = "npm"; Args = @("--version") }
)) {
    $path = Get-CommandPath $item.Cmd
    if ($path) {
        $ver = (& $item.Cmd @($item.Args) 2>&1 | Select-Object -First 1)
        Write-Status -Level OK -Name $item.Name -Detail "$ver ($path)"
    } else {
        Write-Status -Level MISS -Name $item.Name
    }
}

# --- System tools ---
Write-Host "`n## 系统工具"
$soffice = Find-WindowsTool "soffice" @(
    "${env:ProgramFiles}\LibreOffice\program\soffice.exe",
    "${env:ProgramFiles(x86)}\LibreOffice\program\soffice.exe"
)
if ($soffice.Found) {
    if ($soffice.InPath) {
        Write-Status -Level OK -Name "soffice (LibreOffice)" -Detail $soffice.Path
    } else {
        Write-Status -Level WARN -Name "soffice (LibreOffice)" -Detail "已安装但未在 PATH: $($soffice.Path)"
    }
} else {
    Write-Status -Level MISS -Name "soffice (LibreOffice)"
}

$pdftoppm = Find-WindowsTool "pdftoppm" @(
    "${env:ProgramFiles}\MiKTeX\miktex\bin\x64\pdftoppm.exe",
    "${env:ProgramFiles(x86)}\MiKTeX\miktex\bin\x64\pdftoppm.exe"
)
if ($pdftoppm.Found) {
    if ($pdftoppm.InPath) {
        Write-Status -Level OK -Name "pdftoppm (Poppler)" -Detail $pdftoppm.Path
    } else {
        Write-Status -Level WARN -Name "pdftoppm (Poppler)" -Detail "已安装但未在 PATH: $($pdftoppm.Path)"
    }
} else {
    Write-Status -Level MISS -Name "pdftoppm (Poppler)"
}

$pandoc = Get-CommandPath "pandoc"
if ($pandoc) {
    $ver = (& pandoc --version 2>&1 | Select-Object -First 1)
    Write-Status -Level OK -Name "pandoc" -Detail "$ver ($pandoc)"
} else {
    Write-Status -Level MISS -Name "pandoc"
}

# --- Python venv ---
Write-Host "`n## Python 环境 (.venv)"
if (Test-Path $VenvPython) {
    Write-Status -Level OK -Name ".venv" -Detail $VenvPython
    $pyForCheck = $VenvPython
} else {
    Write-Status -Level MISS -Name ".venv" -Detail "未创建，请运行: python -m venv .venv"
    $pyForCheck = Get-CommandPath "python"
    if ($pyForCheck) {
        Write-Status -Level WARN -Name "python fallback" -Detail "将检查全局 Python 包（建议用 .venv）"
    }
}

# Python packages: requirements.txt import name mapping
$pythonPackages = @(
    @{ Pip = "python-pptx"; Import = "pptx" },
    @{ Pip = "openpyxl"; Import = "openpyxl" },
    @{ Pip = "pypdf"; Import = "pypdf" },
    @{ Pip = "defusedxml"; Import = "defusedxml" },
    @{ Pip = "lxml"; Import = "lxml" },
    @{ Pip = "Pillow"; Import = "PIL" },
    @{ Pip = "pdf2image"; Import = "pdf2image" },
    @{ Pip = "markitdown"; Import = "markitdown" },
    @{ Pip = "six"; Import = "six" },
    @{ Pip = "pandas"; Import = "pandas" }
)

Write-Host "`n## Python 包"
if (-not $pyForCheck) {
    Write-Status -Level MISS -Name "python (无法检查包)"
} else {
    foreach ($pkg in $pythonPackages) {
        if (Test-PythonImport -PythonExe $pyForCheck -ModuleName $pkg.Import) {
            Write-Status -Level OK -Name $pkg.Pip
        } else {
            Write-Status -Level MISS -Name $pkg.Pip -Detail "pip install $($pkg.Pip)"
        }
    }
}

# --- Node ---
Write-Host "`n## Node 环境 (node_modules)"
if (Test-Path $NodeModules) {
    Write-Status -Level OK -Name "node_modules" -Detail $NodeModules
} else {
    Write-Status -Level MISS -Name "node_modules" -Detail "未安装，请在本目录运行: npm install"
}

$nodePackages = @("docx", "pptxgenjs", "playwright", "react", "react-dom", "react-icons", "sharp")
Write-Host "`n## Node 包"
if (-not (Test-Path $NodeModules)) {
    foreach ($pkg in $nodePackages) {
        Write-Status -Level MISS -Name $pkg -Detail "需先 npm install"
    }
} else {
    foreach ($pkg in $nodePackages) {
        if (Test-NodePackage $pkg) {
            Write-Status -Level OK -Name $pkg
        } else {
            Write-Status -Level MISS -Name $pkg
        }
    }
}

# Playwright chromium (optional check)
Write-Host "`n## Playwright Chromium"
$pwCache = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (Test-Path $pwCache) {
    $browsers = Get-ChildItem $pwCache -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name
    if ($browsers -match "chromium") {
        Write-Status -Level OK -Name "chromium" -Detail ($browsers -join ", ")
    } else {
        Write-Status -Level WARN -Name "chromium" -Detail "playwright 目录存在但未检测到 chromium，可运行: npx playwright install chromium"
    }
} else {
    Write-Status -Level MISS -Name "chromium" -Detail "npm install 后会自动安装；或手动: npx playwright install chromium"
}

# --- Summary ---
Write-Host ""
Write-Host ("=" * 60)
Write-Host "缺失: $script:Missing  警告: $script:Warn"
if ($script:Missing -eq 0 -and $script:Warn -eq 0) {
    Write-Host "结果: 全部就绪"
    exit 0
}
if ($script:Missing -eq 0) {
    Write-Host "结果: 基本可用（有 PATH 警告，skill 脚本可能找不到 soffice/pdftoppm）"
    Write-Host "修复: 将 LibreOffice program 目录、Poppler bin 加入用户 PATH"
    exit 0
}
Write-Host "结果: 存在缺失，请参考 README.md 安装"
Write-Host ""
Write-Host "快速安装:"
Write-Host "  cd $OfficeDir"
Write-Host "  python -m venv .venv"
Write-Host "  .\.venv\Scripts\pip install -r requirements.txt"
Write-Host "  npm install"
exit 1
