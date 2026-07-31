---
name: clean-doubao-watermark
description: >-
  清理豆包（Doubao）AI 视频角标水印（「豆包AI生成」等），左上/右下固定区域全程整块覆盖。
  Use when the user mentions 豆包水印、清理豆包视频水印、去豆包水印、Doubao watermark removal,
  or video-inpainting for Doubao-generated studio clips.
---

# 清理豆包视频水印

面向棚景固定机位、角标在左上/右下切换且带进出场的豆包成片。不要用 YOLO；用本 skill 脚本。

## 核心约定（重要）

- **只按固定 ROI 处理**，不做颜色/背景像素检测
- **左上 + 右下全程覆盖**：每一帧都整块换成干净底板，不按「检测到才盖」开关（避免进出场漏帧）
- 残差检测**仅用于挑选干净底板帧**，不决定是否覆盖
- 靠 ROI 框避开头/脚；框太大切人物、太小漏角标

## 何时使用

- 水印含「豆包AI生成」「AI生成」Logo 等，半透明，带进出场
- 落点主要在左上 / 右下
- 浅色棚景、机位基本固定

不适用：复杂运动背景、水印大面积盖住主体、非角标满屏水印 → 改用 ProPainter / DiffuEraser 等。

## 依赖

- Python 3 + `opencv-python` / `opencv-python-headless` + `numpy`
- `ffmpeg`（合成音轨；没有则输出无声）

```powershell
python -m pip install opencv-python-headless numpy --user
```

## 执行

```powershell
python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "输入.mp4"
python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "输入.mp4" -o "输入_clean.mp4"
python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "输入.mp4" --debug-dir debug_wm
```

仓库快捷入口：`script/clean_doubao_watermark.py`  
输出默认：`<原名>_clean.mp4`（与输入同目录）

## 流水线

1. 扫描左上/右下 ROI 残差分数（只为选底板）
2. 用低分帧估计各角干净底板（像素中位数）
3. **全程**整块覆盖左上 + 右下
4. ffmpeg 合并原音轨

默认 ROI（相对画幅）：

- 左上 `(0.02, 0.01) - (0.38, 0.10)`
- 右下 `(0.58, 0.88) - (0.99, 0.995)`

改框：编辑脚本内 `DOUBAO_CORNERS`。

## 调参

| 现象 | 处理 |
|------|------|
| 左上切到头发 | 缩小 `tl` 的 x1 / y1 |
| 左上角标漏边 | 略增 `tl` 高度/宽度，仍勿盖到发顶 |
| 右下切到脚 | 增大 `br` 的 x0（更靠右） |
| 右下仍见角标/动效 | 略减 `br` 的 x0 或增高框；确认脚本为全程覆盖 |
| 底板发虚/有残影 | 调高 `tl_threshold` / `br_threshold`，或增大 `plate_samples` |

`--debug-dir` 输出 `scores.csv`、`plate_tl.png`、`plate_br.png`。

## Agent 注意

- 仅处理用户有权处理的视频；不要提交 mp4 样例
- 先确认依赖，再跑脚本；跑完核对输出存在
- 不要另起 YOLO / 重型 inpainting，除非用户明确要求或本方案不适用
- 禁止为此任务主动新建说明文档或测试文件
