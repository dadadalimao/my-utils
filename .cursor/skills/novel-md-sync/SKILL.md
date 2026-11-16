---
name: novel-md-sync
description: >-
  把小程序小说从本地库导出成 Markdown，改完后从 exports 目录覆盖写回指定用户的一本书。
  用户提到导出小说、重新上传、回写、exports 目录、设定卡/道具卡落库，或要改《我的伪娘租客》等已同步书籍的正文、大纲、设定卡时使用。
---

# 小说 Markdown 导出与回写

服务在 `apps/mini/apps/server`，默认 `http://localhost:3000`。两个接口都**不登录**。只动查询参数里的那一本书，不改其他书，不读写账号设置和 API Key。

工作目录必须是 server 目录，导出根目录才是 `apps/mini/apps/server/exports`。

## 接口

PowerShell 里中文书名要编码：

```powershell
$uri = 'http://localhost:3000/export/novel?username=admin&title=' + [uri]::EscapeDataString('我的伪娘租客')
Invoke-RestMethod -Uri $uri -Method Get    # 导出，清空该书目录后重写
Invoke-RestMethod -Uri $uri -Method Post   # 读取该书 exports 目录，覆盖写回
```

`username`、`title` 必填。`title` 必须与快照里的书名完全一致。书名重复或目录不存在会失败。

服务没开时，在 `apps/mini/apps/server` 执行 `yarn start`。端口被旧进程占用时，先停掉占用 3000 的进程再启动。

## 改书流程

1. `GET` 导出。
2. 只改 `exports/{用户名}/{书名}/` 里的 Markdown。
3. `POST` 上传。
4. 看返回的 `chaptersUpdated` / `loreCreated` 等计数，抽查写回的正文或设定卡。

不要打包成 zip。不要直接改 `prisma/dev.db`。

## 目录

```
exports/{用户名}/{书名}/
  书籍.md
  正文/第N章-标题.md
  大纲/第N章-标题.md
  大纲/全书大纲.md
  设定/本书设定.md
  设定卡/人物/{名称}.md
  设定卡/道具/{名称}.md
  资料库/{标题}.md
```

标题本身已是「第N章…」时，文件名不再加一层章序前缀。

## 回写规则

- 正文章序来自文件名 `第{N}章`。同章序已有章节则覆盖标题和正文；没有则新建。
- 章纲文件覆盖对应章的摘要、事件、人物状态、未收束线、备注。没有章纲文件则保留库里的大纲。
- 设定卡按「类型 + 名称」合并。道具放 `设定卡/道具/`，人物放 `设定卡/人物/`。
- 资料库按标题合并。
- 目录里多出来的章节、设定卡、资料会新建。目录里没有的记录**不删除**。
- `书籍.md` 里的写作模式（轻量/长篇）、类型、预计字数、简介会写回。`设定/本书设定.md`、`大纲/全书大纲.md` 存在才覆盖对应字段。
- 导出时正文会 trim。回写以文件内容为准。

## 道具卡格式

```markdown
# 兰溪公寓楼

- 类型：道具
- 关键词：兰溪公寓楼、兰栖公寓、公寓楼
## 本体

【功能与数据】
- 身份：…
```

关键词用顿号分隔。本体写在 `## 本体` 下。新增卡写成文件后执行 `POST`，返回里 `loreCreated` 应增加。
