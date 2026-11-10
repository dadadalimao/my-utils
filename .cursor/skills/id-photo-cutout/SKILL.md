---
name: id-photo-cutout
description: >-
  人像抠图并裁成证件照构图，背景可选透明或纯色（白/蓝/红等）。
  Use when the user mentions 证件照、抠图、去背景、透明背景人像、ID photo cutout,
  rembg 证件照, or converting full-body portraits to head-and-shoulders cutouts.
---

# 证件照抠图

全身/半身棚拍转**头肩证件照构图** + **抠图**。默认透明底；背景可选纯色。

## 何时使用

- 棚拍全身/半身转证件照头肩图
- 需要透明底 PNG，或白/蓝/红等证件照底色
- 绿幕或白底人像均可（内部用 rembg，不依赖绿幕键控）

不适用：多人大合影精细分人、极端逆光、头发与背景几乎同色且质量要求极高 → 提示用户换图或改用专业修图。

## 依赖

- Python 3 + `rembg` + `onnxruntime` + `Pillow` + `opencv-python` / `opencv-python-headless` + `numpy`

```powershell
python -m pip install rembg onnxruntime pillow opencv-python-headless numpy --user
```

首次运行 rembg 会下载 U2-Net 模型，需联网。

## 执行

```powershell
# 默认：透明底 + 证件照裁切，最短边 ≥ 600
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "输入.png"

# 纯色底
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "输入.png" --bg white
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "输入.png" --bg blue
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "输入.png" --bg "#438EDB"

# 批量；-o 为目录
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py a.png b.png --bg transparent -o ".temp"

# 只抠图不裁头肩
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "输入.png" --no-crop

# 绿幕溢色：发丝边缘去绿（抠图时）
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "输入.png" --degreen

# 已有透明 PNG 只去绿（不重跑 rembg）
python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "xxx_cutout.png" --degreen-only
```

仓库快捷入口：`tools/cli/id_photo_cutout.py`

默认输出（与输入同目录）：

- 透明底：`<原名>_cutout.png`
- 纯色底：`<原名>_idphoto.png`

## 流水线

1. `rembg` 抠主体 → RGBA
2. OpenCV 人脸定位（YuNet / Haar）；失败则用 alpha 主体上半身
3. 按宽高比（默认 5:7）裁头肩
4. 最短边不足 `--min-side`（默认 600）则放大
5. 合成背景：`transparent` 或预设/十六进制色

## 参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--bg` | `transparent` | `transparent` / `white` / `blue` / `red` / `gray` / `#RRGGBB` |
| `--min-side` | `600` | 最短边下限 |
| `--aspect` | `0.714`（5:7） | 宽/高 |
| `--no-crop` | off | 只抠图，不裁证件照构图 |
| `--degreen` | off | 抑制绿幕溢色（半透明边缘压绿） |
| `--degreen-strength` | `1.0` | 去绿强度 0~2 |
| `--degreen-only` | off | 对已有透明 PNG 只去绿 |
| `--headroom` | `0.08` | 头顶留白占画幅高度（防头顶被裁） |
| `--shift-x` | `0` | 水平微调：正值人物右移（纠偏左），如 `0.02` |
| `-o` | 同目录自动命名 | 单文件路径或多文件输出目录 |

绿幕/发丝发绿：加 `--degreen`；已抠好的图用 `--degreen-only`。强度不够可试 `--degreen-strength 1.4`。

## Agent 注意

- 先确认依赖，再跑脚本；首次需等模型下载
- 跑完核对输出 PNG 存在，并用 Read 查看结果图边缘/构图
- 人脸检测失败时脚本会退回 alpha 上半身裁切，仍应产出可用图
- 禁止为此任务主动新建说明文档或测试文件
- 仅处理用户有权处理的图片
