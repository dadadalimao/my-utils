# my-utils

按能力域分区的个人工具与项目仓库（非 Monorepo / 无 workspace）。

## 仓库地图

| 区域 | 路径 | 说明 |
|------|------|------|
| Web 工具 | [`tools/web/`](tools/web/) | 纯浏览器小工具，打开 [`tools/web/index.html`](tools/web/index.html) |
| Node 工具 | [`tools/node/`](tools/node/) | 本地 Express 服务（GIF / 字体等），`cd tools/node && npm start` |
| CLI 脚本 | [`tools/cli/`](tools/cli/) | PowerShell / Node / Python 辅助脚本 |
| JavaTool | [`devtools/javaTool/`](devtools/javaTool/) | Java 项目启停 GUI |
| Mini | [`apps/mini/`](apps/mini/) | AI 写小说（uni-app + Nest），故事资料在 `apps/mini/story/` |
| 文档 | [`docs/`](docs/) | 提示词等备忘 |
| Cursor | [`.cursor/`](.cursor/) | Agent skills（保持独立） |

根目录 [`index.html`](index.html) 为分区总入口；[`start.ps1`](start.ps1) / [`start.bat`](start.bat) 为 wt 启动菜单（可选启动 node / mini / web / javaTool）。

---

## tools/web

打开 [`tools/web/index.html`](tools/web/index.html)，或直接打开对应页面。无需后端，推荐 Chrome / Edge。

### 工具列表

- [`tools/web/html/stringGetCity.html`](tools/web/html/stringGetCity.html) — 地址解析（省市区）
- [`tools/web/html/svg-png.html`](tools/web/html/svg-png.html) — SVG 预览与 PNG 导出
- [`tools/web/html/wordToHtml.html`](tools/web/html/wordToHtml.html) — Word → HTML
- [`tools/web/html/wordToRich.html`](tools/web/html/wordToRich.html) — Word → 富文本
- [`tools/web/html/objArrayToExcel.html`](tools/web/html/objArrayToExcel.html) — 对象数组 → Excel
- [`tools/web/html/批量画布调整.html`](tools/web/html/批量画布调整.html) — 图片批量画布
- [`tools/web/html/imageToBase64.html`](tools/web/html/imageToBase64.html) — 图片转 Base64
- [`tools/web/html/crop-black-border.html`](tools/web/html/crop-black-border.html) — 去黑边裁剪
- [`tools/web/html/Cursor用量数据.html`](tools/web/html/Cursor用量数据.html) — Cursor Usage CSV 汇总

共享脚本在 [`tools/web/js/`](tools/web/js/)。

## tools/node

```powershell
cd tools/node
npm install
npm start
```

浏览器访问 http://localhost:3920 。

## tools/cli

```powershell
pwsh -File tools/cli/git.ps1
pwsh -File tools/cli/shutdown-timer.ps1
```

豆包水印清理：`tools/cli/clean_doubao_watermark.py`。

## apps/mini

```powershell
cd apps/mini/apps
.\start.ps1
```

交互选择客户端：`1` H5 · `2` 微信小程序 · `3` 仅后端。也可从仓库根 [`start.ps1`](start.ps1) 选 Mini。

客户端与服务端分别为 `apps/mini/apps/client`、`apps/mini/apps/server`（独立 npm 包，无 workspace）。

## 注意事项

- Word 工具需 `.docx`；SVG 需合法 XML
- 地址解析暂不支持港澳台简称
- 本仓目录分类仅为组织方式，不引入 pnpm/yarn workspace / turbo / nx
