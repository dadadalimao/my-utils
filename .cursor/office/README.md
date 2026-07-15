# Office Skills 依赖安装

本目录为 Cursor Agent Office skills（docx / pptx / xlsx / pdf）的**统一依赖**，源自社区版 [tfriedel/claude-office-skills](https://github.com/tfriedel/claude-office-skills)，并补充了 `docx`、`pandas`。

对应 skill 目录：`.cursor/skills/{docx,pptx,xlsx,pdf}/`

## LibreOffice 会装吗？

**不会。** `pip install` / `npm install` **都不包含** LibreOffice。

LibreOffice、Poppler（`pdftoppm`）、Pandoc 属于**系统工具**，需自行安装，并保证命令在 `PATH` 中可直接调用：

| 工具 | 作用 | 命令名 |
|------|------|--------|
| LibreOffice | PDF 转换、接受修订、Excel 公式重算 | `soffice` |
| Poppler | PDF → 图片（视觉 QA / 缩略图） | `pdftoppm` |
| Pandoc | Word 文本提取等 | `pandoc` |

Windows 常见情况：软件已安装但未进 PATH。例如：

- LibreOffice：`C:\Program Files\LibreOffice\program\`
- MiKTeX 自带的 pdftoppm：`C:\Program Files\MiKTeX\miktex\bin\x64\`

把上述目录加入用户 PATH 后，新开终端再验证：

```powershell
soffice --version
pdftoppm -v
pandoc --version
```

## 安装流程（PowerShell）

### 0. 前置

- Python 3.10+
- Node.js 18+ / npm
- （可选但推荐）已安装并配置好 PATH 的 LibreOffice、Poppler、Pandoc

```powershell
cd e:\sxhwork\my-utils\.cursor\office
```

### 1. Python 依赖

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

验证：

```powershell
python -c "import openpyxl, pandas, lxml, defusedxml, markitdown, PIL; print('python ok')"
```

之后跑 skill 内 Python 脚本时，优先用本目录的 `.venv`：

```powershell
.\.venv\Scripts\python.exe ..\skills\xlsx\scripts\recalc.py ...
```

### 2. Node 依赖

```powershell
npm install
```

`postinstall` 会执行 `playwright install chromium`（pptx 的 html2pptx 渲染需要）。首次可能较慢。

说明：skill 文档里常写 `npm install -g xxx`。本目录用**本地** `node_modules` 更统一；在本目录下执行 `npx docx` / `node` 脚本，或设置：

```powershell
$env:NODE_PATH = (Resolve-Path .\node_modules).Path
```

### 3. 系统工具（需单独安装）

**LibreOffice**

- 官网：https://www.libreoffice.org/download/
- 或 Chocolatey：`choco install libreoffice-fresh -y`

**Poppler（`pdftoppm`）**

- 若已装 MiKTeX，把其 `bin\x64` 加入 PATH 即可
- 或独立 Poppler for Windows / `choco install poppler`

**Pandoc**

- `choco install pandoc`（本机若已有可跳过）

### 4. 一键自检

```powershell
cd e:\sxhwork\my-utils\.cursor\office
.\check-deps.ps1
```

脚本会检查：运行时、系统工具（含「已装但未进 PATH」）、`.venv` / `node_modules`、Python 与 Node 包、Playwright Chromium。退出码 `0` 表示就绪，`1` 表示有缺失。

## 本目录文件

| 文件 | 说明 |
|------|------|
| `requirements.txt` | Python 包 |
| `package.json` | Node 包（含 docx / pptxgenjs / playwright 等） |
| `check-deps.ps1` | 依赖自检脚本 |
| `html2pptx-local.cjs` | HTML → PPTX 本地辅助脚本 |
| `.venv/` | Python 虚拟环境（gitignore，需本地创建） |
| `node_modules/` | Node 依赖（gitignore，需本地安装） |

## 能力对照（装齐后）

| 场景 | 主要依赖 |
|------|----------|
| 新建 Word | Node `docx` |
| 新建 PPT | Node `pptxgenjs`（+ playwright / react-icons 等） |
| 新建 / 编辑 Excel | Python `openpyxl` / `pandas` |
| 解包 / OOXML 校验 | Python `lxml` / `defusedxml` |
| Excel 公式重算 | LibreOffice + skill 内 `recalc.py` |
| 转 PDF / 缩略图预览 | LibreOffice + Poppler + Pillow |
| PDF 处理 | Python `pypdf` 等（见 pdf skill） |

## 来源说明

- Skills：社区版 `public/{docx,pptx,xlsx,pdf}`
- 依赖清单：社区版根目录 `requirements.txt` / `package.json`，并额外加入 `docx`、`pandas`
- 社区 README 亦写明系统工具需本机自备，仓库脚本不会代装 LibreOffice
