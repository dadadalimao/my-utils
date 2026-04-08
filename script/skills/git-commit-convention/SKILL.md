---
name: git-commit-convention
description: Submits git changes with conventional one-line commit messages (e.g. feat: xxxxx, fix: xxxxx). Use when the user asks to commit, submit git, push code, or write a commit message. Supports specifying which project root to run in when the workspace has multiple repos.
---

# Git 提交（规范说明）

在用户要求提交代码、提交 git、或写提交说明时使用本技能。提交说明需符合约定式提交规范，且用一句话总结。

## 执行流程

1. **确定项目目录**
   - 若用户指定了项目（如「在前端项目提交」「sewage-treatment-plant-front」「java 服务」），在对应工作区根目录下执行 git。
   - 未指定时，在当前或用户所在的项目目录执行。

2. **查看状态**
   - 在目标目录执行 `git status`，确认是否有变更、是否已有暂存。
   - **前端项目限制**：若当前为前端项目（如 `sewage-treatment-plant-front`），且**仅有** `config.dev` 相关文件（如 `config/config.dev.ts`）的变动，则**不执行提交**，直接告知用户并结束。

3. **暂存变更**
   - 若用户未说明只提交部分文件，默认 `git add -A` 或按用户要求 `git add` 指定路径。
   - 若无变更可提交，告知用户并结束。

4. **撰写提交说明**
   - 严格采用**一句话**的约定式提交格式：`<type>: <简短描述>`。
   - 描述用中文或英文均可，与项目习惯一致即可；一句话总结，不要多段或列表。

5. **执行提交（PowerShell 优先）**
   - 在 `sewage-treatment-plant-front` 前端仓库中，优先使用脚本：
     - `.\scripts\git-commit-convention.ps1 -Message "<提交说明>"`
     - 如需仅提交部分路径：`.\scripts\git-commit-convention.ps1 -Message "<提交说明>" -Paths "src/a.ts","src/b.ts"`
     - 仅当用户明确要求推送时再加 `-Push`
   - 在其他仓库（或脚本不可用）时，用 PowerShell 兼容命令执行：
     - `git add -A; git commit -m "<提交说明>"`
   - 禁止使用 bash heredoc、`&&` 这类不兼容 PowerShell 的语法。

## 提交说明规范（约定式提交）

- **type** 与描述之间用英文冒号+空格，例如：`feat: 新增排班跳过节假日配置`。
- 常用 type：
  - `feat`: 新功能
  - `fix`: 修复 bug
  - `docs`: 仅文档
  - `style`: 格式、空格等（不改变逻辑）
  - `refactor`: 重构
  - `test`: 测试相关
  - `chore`: 构建/脚本/依赖等
- 可选 scope：`feat(sch): 排班策略支持跳过节假日`，不强制。

## 示例

| 场景 | 提交说明示例 |
|------|----------------|
| 新功能 | `feat: 排班策略支持跳过节假日配置` |
| 修复 | `fix: 修正策略列表查询条件错误` |
| 文档 | `docs: 更新接口说明` |
| 重构 | `refactor: 抽离排班工具方法` |
| 配置 | `chore: 调整 dev 环境接口地址` |

## 多项目工作区

工作区根目录示例：
- `sewage-treatment-plant-front` → 前端
- `sewage-treatment-plant-service`（或 `java/sewage-treatment-plant-service`）→ Java 服务
- `video-monitor`、`autoTest` 等

当用户说「在前端提交」「在 java 项目提交」「在 video-monitor 提交」时，先 `cd` 到对应再执行 `git status` / `git add` / `git commit`。

## PowerShell 脚本说明（前端仓库）

脚本路径：`scripts/git-commit-convention.ps1`

能力：
- 校验当前目录是 git 仓库
- 校验提交说明格式：`<type>(<scope>): <描述>` 或 `<type>: <描述>`
- 前端仓库中仅 `config.dev` 相关变更时自动阻止提交
- 支持默认 `git add -A`，也支持 `-Paths` 指定提交范围
- 仅在传入 `-Push` 时执行 `git push`
