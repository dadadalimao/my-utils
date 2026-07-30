#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
裁剪图片四周近黑色边（如手机预览截图保存的上下/左右黑边）。

按亮度阈值从四边向内扫描，把「几乎全黑」的行/列当作边框裁掉；
底部浅灰 UI 文字/图标也会被当成黑边（可调 --threshold）。

示例:
  python python/crop_black_border.py "assets/foo.jpg"
  python python/crop_black_border.py "assets/foo.jpg" -o "assets/foo_crop.jpg"
  python python/crop_black_border.py "assets/" --threshold 32
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

# 常见截图扩展名
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def find_content_bbox(
    bgr: np.ndarray,
    threshold: int = 32,
    min_content_ratio: float = 0.008,
    pad: int = 0,
) -> tuple[int, int, int, int] | None:
    """
    检测非黑内容包围盒（含 pad），返回 (x0, y0, x1, y1)，右下为开区间。

    使用三通道最大值作亮度，避免深色但有色的主体被误判为黑边；
    行/列需达到一定非黑像素比例才算「有内容」，避免噪声/单点干扰。
    """
    if bgr.ndim == 2:
        luma = bgr
    else:
        luma = bgr.max(axis=2)

    h, w = luma.shape[:2]
    content = luma > threshold

    min_row_px = max(1, int(w * min_content_ratio))
    min_col_px = max(1, int(h * min_content_ratio))
    row_flags = content.sum(axis=1) >= min_row_px
    col_flags = content.sum(axis=0) >= min_col_px

    if not row_flags.any() or not col_flags.any():
        return None

    y0 = int(np.argmax(row_flags))
    y1 = int(h - np.argmax(row_flags[::-1]))
    x0 = int(np.argmax(col_flags))
    x1 = int(w - np.argmax(col_flags[::-1]))

    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(w, x1 + pad)
    y1 = min(h, y1 + pad)

    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def crop_black_border(
    bgr: np.ndarray,
    threshold: int = 32,
    min_content_ratio: float = 0.008,
    pad: int = 0,
) -> tuple[np.ndarray, tuple[int, int, int, int] | None]:
    """裁剪黑边；若检测失败则原样返回，bbox 为 None。"""
    bbox = find_content_bbox(bgr, threshold, min_content_ratio, pad)
    if bbox is None:
        return bgr, None
    x0, y0, x1, y1 = bbox
    return bgr[y0:y1, x0:x1], bbox


def _imread(path: Path) -> np.ndarray | None:
    """支持含中文路径的读图。"""
    data = np.fromfile(str(path), dtype=np.uint8)
    if data.size == 0:
        return None
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def _imwrite(path: Path, bgr: np.ndarray) -> bool:
    """支持含中文路径的写图。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower() or ".jpg"
    ok, buf = cv2.imencode(ext, bgr)
    if not ok:
        return False
    buf.tofile(str(path))
    return True


def _default_out_path(src: Path) -> Path:
    return src.with_name(f"{src.stem}_crop{src.suffix}")


def _collect_inputs(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(
            p for p in path.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS
        )
    return []


def process_one(
    src: Path,
    out: Path | None,
    threshold: int,
    min_content_ratio: float,
    pad: int,
    dry_run: bool,
) -> int:
    """处理单张图；成功返回 0，失败返回非 0。"""
    img = _imread(src)
    if img is None:
        print(f"无法读取: {src}", file=sys.stderr)
        return 1

    h, w = img.shape[:2]
    cropped, bbox = crop_black_border(img, threshold, min_content_ratio, pad)
    if bbox is None:
        print(f"未检测到可裁内容，跳过: {src}")
        return 1

    x0, y0, x1, y1 = bbox
    ch, cw = cropped.shape[:2]
    print(f"{src.name}: {w}x{h} -> {cw}x{ch}  crop=({x0},{y0})-({x1},{y1})")

    if dry_run:
        return 0

    dest = out or _default_out_path(src)
    if not _imwrite(dest, cropped):
        print(f"写入失败: {dest}", file=sys.stderr)
        return 1
    print(f"已写入: {dest}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="裁剪图片四周近黑色边框")
    parser.add_argument("input", type=Path, help="输入图片或目录")
    parser.add_argument("-o", "--output", type=Path, default=None, help="输出路径（仅单文件）")
    parser.add_argument(
        "--threshold",
        type=int,
        default=32,
        help="亮度阈值 0~255，低于此视为黑边（默认 32，可覆盖浅灰 UI）",
    )
    parser.add_argument(
        "--min-content-ratio",
        type=float,
        default=0.008,
        help="行/列判定为有内容所需的非黑像素占比（默认 0.008）",
    )
    parser.add_argument(
        "--pad",
        type=int,
        default=0,
        help="裁切包围盒外扩像素（可为负表示再内缩）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印裁切框，不写文件",
    )
    args = parser.parse_args(argv)

    inputs = _collect_inputs(args.input)
    if not inputs:
        print(f"没有可处理的图片: {args.input}", file=sys.stderr)
        return 1
    if args.output is not None and len(inputs) > 1:
        print("目录批量处理时不能指定 -o", file=sys.stderr)
        return 1

    failed = 0
    for src in inputs:
        failed += process_one(
            src,
            args.output,
            args.threshold,
            args.min_content_ratio,
            args.pad,
            args.dry_run,
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
