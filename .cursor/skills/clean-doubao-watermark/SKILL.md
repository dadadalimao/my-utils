---
name: clean-doubao-watermark
description: >-
  清理豆包（Doubao）AI 视频角标水印（「豆包AI生成」等），处理左上/右下切换与进出场动效。
  Use when the user mentions 豆包水印、清理豆包视频水印、去豆包水印、Doubao watermark removal,
  or video-inpainting for Doubao-generated studio clips.
---

# 清理豆包视频水印

面向棚景固定机位、角标切换显示的豆包成片。不要用 YOLO 当主方案；用本 skill 脚本。

## 何时使用

- 水印文案/样式含「豆包AI生成」「AI生成」Logo，半透明，带进出场
- 位置在左上 / 右下切换（或同类角标）
- 背景为浅色棚景、机位基本固定

不适用：复杂运动背景、水印大面积盖住主体、非角标满屏水印 → 改用 ProPainter / DiffuEraser 等重模型。

## 依赖

- Python 3 + `opencv-python` / `opencv-python-headless` + `numpy`
- `ffmpeg`（合成音轨；没有则输出无声）

```powershell
python -m pip install opencv-python-headless numpy --user
```

## 执行

默认跑 skill 内脚本（PowerShell）：

```powershell
python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "输入.mp4"
# 指定输出
python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "输入.mp4" -o "输入_clean.mp4"
# 调参 / 调试
python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "输入.mp4" --temporal-pad 12 --debug-dir debug_wm
```

仓库快捷入口（转发到同一脚本）：`script/clean_doubao_watermark.py`

输出默认：`<原名>_clean.mp4`，与输入同目录。

## 流水线（脚本内部）

1. **双角残差检测**：左上 / 右下 ROI，灰度相对高斯模糊的残差；右下只在浅色背景像素上计分（避开脚）
2. **分角阈值**：默认左上 `1.0`、右下 `1.75`（地面纹理抬高基线）
3. **时序膨胀**：命中后前后各扩 `--temporal-pad` 帧，覆盖淡入淡出
4. **干净底板**：用 raw 未激活帧（不够则取分数最低帧）做 ROI 像素中位数
5. **合成**：激活帧用底板替换；左上可整块，右下仅浅色背景
6. **ffmpeg** 合并原音轨

## 调参

| 现象 | 处理 |
|------|------|
| 右下漏检 / 残影 | 略降 `--threshold`，或加大 `--temporal-pad` |
| 右下误检（全程激活） | 不要把共用阈值设太低；保持默认分角阈值或只调脚本内 `br_threshold` |
| 进出场仍有淡影 | `--temporal-pad` 提到 16~20，并用 `--debug-dir` 看 `scores.csv` |
| 鞋子被抹 | 检查右下 ROI / `studio_bg_mask`；右下必须走背景掩膜，勿整块 ROI |

`--debug-dir` 会写 `scores.csv`、`plate_tl.png`、`plate_br.png`。

## Agent 注意

- 仅处理用户有权处理的视频
- 先确认依赖，再跑脚本；跑完核对输出文件存在
- 不要另起 YOLO / 重型 inpainting，除非用户明确要求或本方案不适用
- 禁止为此任务主动新建说明文档或测试文件
