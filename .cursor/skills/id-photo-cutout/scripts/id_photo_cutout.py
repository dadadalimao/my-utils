#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
人像抠图 + 证件照构图裁切。

用 rembg 抠出主体，可选透明底或纯色底；默认按头肩证件照比例裁切，
尺寸无硬性规范时保证最短边不低于 --min-side。

示例:
  python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "photo.png"
  python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "photo.png" --bg transparent
  python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "photo.png" --bg white -o out.png
  python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py a.png b.png --bg "#RRGGBB"
  # 绿幕溢色：半透明边缘去绿
  python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "photo.png" --degreen
  # 已有透明 PNG 只去绿（不重跑抠图）
  python .cursor/skills/id-photo-cutout/scripts/id_photo_cutout.py "cutout.png" --degreen-only
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# 证件照常用宽高比（宽:高），接近一寸/二寸竖版
DEFAULT_ASPECT = 5 / 7
# 无特殊尺寸要求时，最短边下限（像素）
DEFAULT_MIN_SIDE = 600

# 背景别名 -> RGB
BG_PRESETS: dict[str, tuple[int, int, int] | None] = {
    "transparent": None,
    "white": (255, 255, 255),
    "blue": (67, 142, 219),
    "red": (255, 0, 0),
    "gray": (200, 200, 200),
}


def parse_bg(value: str) -> tuple[int, int, int] | None:
    """解析背景色：transparent / white / blue / red / gray / #RRGGBB / R,G,B。"""
    key = value.strip().lower()
    if key in BG_PRESETS:
        return BG_PRESETS[key]
    if key.startswith("#") and len(key) == 7:
        return (int(key[1:3], 16), int(key[3:5], 16), int(key[5:7], 16))
    if "," in key:
        parts = [int(p.strip()) for p in key.split(",")]
        if len(parts) == 3 and all(0 <= p <= 255 for p in parts):
            return (parts[0], parts[1], parts[2])
    raise argparse.ArgumentTypeError(
        f"无法解析背景色: {value!r}（可用 transparent/white/blue/red/gray/#RRGGBB）"
    )


def remove_background(img: Image.Image) -> Image.Image:
    """rembg 抠图，返回 RGBA。"""
    from rembg import remove

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    out = remove(buf.getvalue())
    return Image.open(io.BytesIO(out)).convert("RGBA")


def alpha_bbox(rgba: Image.Image, thresh: int = 16) -> tuple[int, int, int, int] | None:
    """根据 alpha 通道得到主体外接矩形 (left, top, right, bottom)。"""
    arr = np.asarray(rgba)
    mask = arr[:, :, 3] > thresh
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _yunet_model_path() -> Path:
    """YuNet 人脸模型本地缓存路径（OpenCV 5 无 Haar Cascade）。"""
    return Path.home() / ".cache" / "id-photo-cutout" / "face_detection_yunet_2023mar.onnx"


def _ensure_yunet_model() -> Path | None:
    """若本地无模型则下载（约 230KB）；失败返回 None。"""
    path = _yunet_model_path()
    if path.is_file() and path.stat().st_size > 10_000:
        return path
    url = (
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx"
    )
    try:
        import urllib.request

        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".onnx.part")
        urllib.request.urlretrieve(url, tmp)
        tmp.replace(path)
        return path
    except Exception as exc:  # noqa: BLE001
        print(f"警告: YuNet 模型下载失败，将用 alpha 构图: {exc}", file=sys.stderr)
        return None


def detect_face_box(rgba: Image.Image) -> tuple[int, int, int, int] | None:
    """
    用人脸检测定位；OpenCV 5 用 FaceDetectorYN(YuNet)，失败返回 None。
    返回 (x, y, w, h)，坐标系相对整图。
    """
    # OpenCV 4.x 兼容：若仍有 CascadeClassifier 则优先用内置 Haar
    if hasattr(cv2, "CascadeClassifier"):
        cascade_dir = getattr(getattr(cv2, "data", None), "haarcascades", "") or ""
        cascade_path = Path(cascade_dir) / "haarcascade_frontalface_default.xml"
        if cascade_path.is_file():
            rgb = np.asarray(rgba.convert("RGB"))
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            cascade = cv2.CascadeClassifier(str(cascade_path))
            faces = cascade.detectMultiScale(
                gray, scaleFactor=1.08, minNeighbors=5, minSize=(48, 48)
            )
            if len(faces) > 0:
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                return int(x), int(y), int(w), int(h)

    if not hasattr(cv2, "FaceDetectorYN_create"):
        return None

    model = _ensure_yunet_model()
    if model is None:
        return None

    bgr = cv2.cvtColor(np.asarray(rgba.convert("RGB")), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]
    detector = cv2.FaceDetectorYN_create(str(model), "", (w, h), 0.7, 0.3, 5000)
    detector.setInputSize((w, h))
    _, faces = detector.detect(bgr)
    if faces is None or len(faces) == 0:
        return None
    # faces: x, y, w, h, ...
    best = max(faces, key=lambda f: float(f[2]) * float(f[3]))
    return int(best[0]), int(best[1]), int(best[2]), int(best[3])


def crop_id_frame(
    rgba: Image.Image,
    aspect: float = DEFAULT_ASPECT,
    face_top_ratio: float = 0.18,
    face_height_ratio: float = 0.40,
    headroom_ratio: float = 0.08,
    shift_x: float = 0.0,
) -> Image.Image:
    """
    裁成竖版证件照构图：优先用人脸定位头肩；失败则用 alpha 主体上半身。

    face_top_ratio: 脸顶到画幅顶的空隙占比（偏大可防头顶被裁）
    face_height_ratio: 脸高约占画幅高度的比例
    headroom_ratio: 相对画幅高度，在 alpha 主体顶之上再留的空白
    shift_x: 水平微调，相对裁切宽度；正值让人物在画面中右移（纠偏左）
    """
    w, h = rgba.size
    face = detect_face_box(rgba)
    bbox = alpha_bbox(rgba)
    # 水平锚点：优先脸心；否则用主体上半部质心（避免长发/裙摆拉偏）
    anchor_cx: int | None = None

    if face is not None:
        fx, fy, fw, fh = face
        # 以脸为锚：画幅高度 ≈ 脸高 / face_height_ratio
        crop_h = max(int(fh / face_height_ratio), int(fh * 2.4))
        crop_w = max(int(crop_h * aspect), int(fw * 2.4))
        # 再按 aspect 统一
        if crop_w / crop_h > aspect:
            crop_h = int(crop_w / aspect)
        else:
            crop_w = int(crop_h * aspect)

        # 脸顶留白
        top = int(fy - crop_h * face_top_ratio)
        # 用 alpha 主体顶保证头发/头顶完整，并加一点留白
        face_cx = fx + fw // 2
        anchor_cx = face_cx
        if bbox is not None:
            top0 = bbox[1]
            top = min(top, top0 - int(crop_h * headroom_ratio))
            # 头顶发丝外接中心与脸心混合，避免长发一侧更长导致「头偏左/右」
            left0, _, right0, _ = bbox
            head_band = np.asarray(rgba)[
                top0 : min(h, top0 + max(fh * 2, crop_h // 2)),
                left0:right0,
                3,
            ] > 16
            hys, hxs = np.where(head_band)
            if len(hxs) > 0:
                hair_cx = left0 + int(hxs.mean())
                anchor_cx = int(0.55 * face_cx + 0.45 * hair_cx)
        left = anchor_cx - crop_w // 2
    elif bbox is not None:
        left0, top0, right0, bottom0 = bbox
        bw, bh = right0 - left0, bottom0 - top0
        # 全身/半身图：取主体上方约 55% 作为头肩区
        upper_h = max(int(bh * 0.55), int(bh * 0.4))
        crop_h = upper_h
        crop_w = int(crop_h * aspect)
        # 上半身水平质心，比全身外接框中心更稳
        arr = np.asarray(rgba)
        y1 = top0 + upper_h
        band = arr[top0:y1, left0:right0, 3] > 16
        ys, xs = np.where(band)
        if len(xs) > 0:
            anchor_cx = left0 + int(xs.mean())
        else:
            anchor_cx = (left0 + right0) // 2
        left = anchor_cx - crop_w // 2
        top = top0 - int(crop_h * headroom_ratio)
    else:
        # 无法定位：居中按比例裁
        if w / h > aspect:
            crop_h = h
            crop_w = int(h * aspect)
        else:
            crop_w = w
            crop_h = int(w / aspect)
        anchor_cx = w // 2
        left = anchor_cx - crop_w // 2
        top = 0

    # 纠偏：正 shift_x → 裁切窗左移 → 人物在画面中右移
    if shift_x:
        left -= int(crop_w * shift_x)

    # 边界夹紧；尽量保持锚点居中，不要单侧硬拉
    top = max(0, top)
    left = int(np.clip(left, 0, max(0, w - crop_w)))
    right = min(w, left + crop_w)
    bottom = min(h, top + crop_h)
    # 高度不够：先尽量下延，再必要时略上移（仍优先不裁头顶）
    need_h = crop_h - (bottom - top)
    if need_h > 0:
        bottom = min(h, bottom + need_h)
        need_h = crop_h - (bottom - top)
        if need_h > 0:
            top = max(0, top - need_h)
            bottom = min(h, top + crop_h)

    cropped = rgba.crop((left, top, right, bottom))

    # 最终强制 aspect：垂直顶对齐；水平按脸/锚点对齐（避免几何居中把头甩偏）
    cw, ch = cropped.size
    target_w = cw
    target_h = int(cw / aspect)
    if target_h > ch:
        target_h = ch
        target_w = int(ch * aspect)
    if target_w != cw or target_h != ch:
        if anchor_cx is not None:
            x0 = int((anchor_cx - left) - target_w / 2)
            # shift_x 已在 left 上体现，此处再跟一次锚点
            x0 = int(np.clip(x0, 0, max(0, cw - target_w)))
        else:
            x0 = (cw - target_w) // 2
        y0 = 0
        cropped = cropped.crop((x0, y0, x0 + target_w, y0 + target_h))

    return cropped


def ensure_min_side(img: Image.Image, min_side: int) -> Image.Image:
    """最短边低于 min_side 时等比放大（LANCZOS）。"""
    w, h = img.size
    short = min(w, h)
    if short >= min_side:
        return img
    scale = min_side / short
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    return img.resize((nw, nh), Image.Resampling.LANCZOS)


def suppress_green_spill(
    rgba: Image.Image,
    strength: float = 1.0,
    edge_alpha_hi: int = 245,
) -> Image.Image:
    """
    抑制绿幕溢色：边缘硬压绿 + HSV 降饱和 + 低 alpha 绿晕剔除。

    - 轮廓/半透明带：G 不超过 max(R,B)；偏绿通道拉向 (R+B)/2
    - HSV：绿色相降饱和，减轻「绿光」
    - 低透明度且明显偏绿的像素直接清掉（晕边）
    strength 越大边缘处理越狠（建议 1.0~1.5）。
    """
    arr = np.asarray(rgba.convert("RGBA"), dtype=np.float32)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    max_rb = np.maximum(r, b)
    mean_rb = (r + b) * 0.5
    s = float(np.clip(strength, 0.0, 2.5))

    a_u8 = a.astype(np.uint8)
    opaque = (a_u8 > 8).astype(np.uint8) * 255
    kernel = np.ones((7, 7), np.uint8)
    dil = cv2.dilate(opaque, kernel, iterations=1)
    ero = cv2.erode(opaque, kernel, iterations=1)
    morph_band = (dil > 0) & (ero < 255) & (a_u8 > 1)
    soft = (a > 1) & (a < edge_alpha_hi)
    edge = morph_band | soft

    g_fixed = g.copy()
    # 边缘硬钳制：消灭 G > max(R,B)
    hard_t = np.clip(0.55 + 0.35 * s, 0.0, 1.0)
    g_clamp = np.minimum(g, max_rb)
    g_fixed = np.where(edge, g * (1.0 - hard_t) + g_clamp * hard_t, g_fixed)

    # G 为最大通道时拉向中性灰绿消除
    g_is_max = edge & (g >= r) & (g >= b)
    pull = np.clip(0.4 + 0.35 * s, 0.0, 1.0)
    g_neutral = max_rb * 0.35 + mean_rb * 0.65
    g_fixed = np.where(g_is_max, g_fixed * (1.0 - pull) + g_neutral * pull, g_fixed)

    # 内部若仍有明显溢色，轻量压绿（保护白大褂蓝镶边）
    green_excess = np.maximum(g - max_rb, 0.0)
    inner = (~edge) & (green_excess > 8)
    g_fixed = np.where(inner, g - green_excess * 0.5 * s, g_fixed)

    lift = np.maximum(g - g_fixed, 0.0) * 0.2
    r_fixed = np.clip(r + lift, 0, 255)
    b_fixed = np.clip(b + lift * 0.3, 0, 255)
    g_fixed = np.clip(g_fixed, 0, 255)

    rgb_u8 = np.stack([r_fixed, g_fixed, b_fixed], axis=-1).astype(np.uint8)
    hsv = cv2.cvtColor(rgb_u8, cv2.COLOR_RGB2HSV).astype(np.float32)
    h, sat, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    green_hue = (h >= 28) & (h <= 95)
    hsv_w = edge.astype(np.float32) * green_hue.astype(np.float32)
    hsv_w *= np.clip(sat / 60.0, 0.0, 1.0) * np.clip(0.5 + 0.4 * s, 0.0, 1.0)
    sat = sat * (1.0 - 0.9 * hsv_w)
    h = np.where(hsv_w > 0.05, h * (1.0 - 0.4 * hsv_w) + 12.0 * hsv_w, h)
    rgb2 = cv2.cvtColor(
        np.stack([h, sat, v], axis=-1).astype(np.uint8), cv2.COLOR_HSV2RGB
    ).astype(np.float32)
    mix = (edge.astype(np.float32) * np.clip(0.5 + 0.25 * s, 0.0, 1.0))[..., None]
    rgb_blend = rgb_u8.astype(np.float32) * (1.0 - mix) + rgb2 * mix

    # HSV 回转可能重新抬绿：边缘再次硬钳制 G
    br, bg_, bb = rgb_blend[:, :, 0], rgb_blend[:, :, 1], rgb_blend[:, :, 2]
    max_rb2 = np.maximum(br, bb)
    mean_rb2 = (br + bb) * 0.5
    bg_ = np.where(edge, np.minimum(bg_, max_rb2), bg_)
    # 浅色晕边（发丝外沿发青）进一步去饱和
    light_fringe = edge & (mean_rb2 > 90) & (bg_ >= br - 1) & (bg_ >= bb - 1)
    desat = np.clip(0.55 * s, 0.0, 0.9)
    luma = 0.299 * br + 0.587 * bg_ + 0.114 * bb
    br = np.where(light_fringe, br * (1 - desat) + luma * desat, br)
    bg_ = np.where(light_fringe, bg_ * (1 - desat) + luma * desat, bg_)
    bb = np.where(light_fringe, bb * (1 - desat) + luma * desat, bb)
    bg_ = np.where(edge, np.minimum(bg_, np.maximum(br, bb)), bg_)
    rgb_blend = np.stack([br, bg_, bb], axis=-1)

    # 低透明绿晕：直接透明掉
    greenish = (bg_ > br + 2) & (bg_ > bb + 2)
    kill = (a > 0) & (a < 40 + 40 * s) & greenish & edge
    a_fixed = a.copy()
    a_fixed[kill] = 0

    out = np.concatenate(
        [np.clip(rgb_blend, 0, 255), a_fixed[..., None]], axis=-1
    ).astype(np.uint8)
    return Image.fromarray(out, mode="RGBA")


def apply_background(
    rgba: Image.Image, bg: tuple[int, int, int] | None
) -> Image.Image:
    """透明底直接返回 RGBA；有颜色则合成 RGB。"""
    if bg is None:
        return rgba.convert("RGBA")
    base = Image.new("RGBA", rgba.size, (*bg, 255))
    composed = Image.alpha_composite(base, rgba.convert("RGBA"))
    return composed.convert("RGB")


def default_output_path(src: Path, bg: tuple[int, int, int] | None) -> Path:
    """透明底用 _cutout.png；纯色底用 _idphoto.png。"""
    stem = src.stem
    # 已是 cutout 再处理时避免 _cutout_cutout
    if stem.endswith("_cutout") or stem.endswith("_idphoto"):
        return src.with_name(stem + src.suffix)
    suffix = "_cutout.png" if bg is None else "_idphoto.png"
    return src.with_name(stem + suffix)


def process_one(
    src: Path,
    dst: Path | None,
    bg: tuple[int, int, int] | None,
    min_side: int,
    aspect: float,
    no_crop: bool,
    degreen: bool,
    degreen_strength: float,
    degreen_only: bool,
    headroom: float = 0.08,
    shift_x: float = 0.0,
) -> Path:
    """处理单张图，返回输出路径。"""
    if not src.is_file():
        raise FileNotFoundError(f"找不到输入: {src}")

    img = Image.open(src)
    if degreen_only:
        cut = img.convert("RGBA")
        if not degreen:
            degreen = True
    else:
        cut = remove_background(img)
        if not no_crop:
            cut = crop_id_frame(
                cut, aspect=aspect, headroom_ratio=headroom, shift_x=shift_x
            )
        cut = ensure_min_side(cut, min_side)

    if degreen:
        cut = suppress_green_spill(cut, strength=degreen_strength)

    out_img = apply_background(cut, bg)

    out_path = dst or default_output_path(src, bg)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_img.save(out_path, format="PNG")
    return out_path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="人像抠图 + 证件照构图（可选透明/纯色背景）"
    )
    p.add_argument("inputs", nargs="+", type=Path, help="输入图片路径")
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="单文件输出路径；多文件时表示输出目录",
    )
    p.add_argument(
        "--bg",
        type=parse_bg,
        default=parse_bg("transparent"),
        help="背景: transparent/white/blue/red/gray/#RRGGBB（默认 transparent）",
    )
    p.add_argument(
        "--min-side",
        type=int,
        default=DEFAULT_MIN_SIDE,
        help=f"最短边下限像素（默认 {DEFAULT_MIN_SIDE}）",
    )
    p.add_argument(
        "--aspect",
        type=float,
        default=DEFAULT_ASPECT,
        help=f"宽高比 宽/高（默认 {DEFAULT_ASPECT:.4f} ≈ 5:7）",
    )
    p.add_argument(
        "--no-crop",
        action="store_true",
        help="只抠图不裁证件照构图（保留全身透明/底色）",
    )
    p.add_argument(
        "--degreen",
        action="store_true",
        help="抑制绿幕溢色（半透明发丝/边缘去绿）",
    )
    p.add_argument(
        "--degreen-strength",
        type=float,
        default=1.0,
        help="去绿强度 0~2（默认 1.0）",
    )
    p.add_argument(
        "--degreen-only",
        action="store_true",
        help="对已有透明 PNG 只做去绿，不重跑 rembg/裁切",
    )
    p.add_argument(
        "--headroom",
        type=float,
        default=0.08,
        help="头顶留白占画幅高度比例（默认 0.08，防头顶被裁）",
    )
    p.add_argument(
        "--shift-x",
        type=float,
        default=0.0,
        help="水平微调：正值人物右移、负值左移（相对裁切宽度，如 0.04）",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    inputs: list[Path] = [p.resolve() for p in args.inputs]
    out_arg: Path | None = args.output.resolve() if args.output else None

    if len(inputs) > 1 and out_arg is not None and out_arg.suffix:
        print("多文件输入时 -o 应为目录", file=sys.stderr)
        return 2

    multi = len(inputs) > 1
    # 多文件或 -o 无后缀：视为输出目录
    out_is_dir = out_arg is not None and (
        multi or not out_arg.suffix or (out_arg.exists() and out_arg.is_dir())
    )

    ok = 0
    for src in inputs:
        try:
            if out_arg is None:
                dst = None
            elif out_is_dir:
                out_arg.mkdir(parents=True, exist_ok=True)
                dst = out_arg / default_output_path(src, args.bg).name
            else:
                dst = out_arg
            path = process_one(
                src,
                dst,
                bg=args.bg,
                min_side=args.min_side,
                aspect=args.aspect,
                no_crop=args.no_crop,
                degreen=args.degreen,
                degreen_strength=args.degreen_strength,
                degreen_only=args.degreen_only,
                headroom=args.headroom,
                shift_x=args.shift_x,
            )
            print(f"OK  {src.name} -> {path}  ({path.stat().st_size} bytes)")
            ok += 1
        except Exception as exc:  # noqa: BLE001 - CLI 汇总错误
            print(f"FAIL {src}: {exc}", file=sys.stderr)

    if ok == 0:
        return 1
    if ok < len(inputs):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
