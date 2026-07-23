#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
清理豆包（Doubao）视频水印。

针对「豆包AI生成」类角标：位置在左上 / 右下切换，带进出场动效、样式可变。
采用双角 ROI 残差检测 + 时序膨胀 + 干净帧中位数底板合成（适合棚景固定机位）。

示例:
  python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "video.mp4"
  python .cursor/skills/clean-doubao-watermark/scripts/clean_doubao_watermark.py "video.mp4" -o "video_clean.mp4"
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass(frozen=True)
class CornerRoi:
    """相对画幅比例的角落检测区（适配不同分辨率）。"""

    name: str
    # (x0, y0, x1, y1)，均为 0~1 相对坐标
    box: tuple[float, float, float, float]


# 豆包水印常见落点：左上 / 右下（合成时仅替换浅色背景像素，可略放大右下 ROI）
DOUBAO_CORNERS: tuple[CornerRoi, ...] = (
    CornerRoi("tl", (0.015, 0.01, 0.48, 0.14)),
    CornerRoi("br", (0.42, 0.875, 0.99, 0.995)),
)


@dataclass
class DetectConfig:
    """检测与时序参数。"""

    # 左上干净约 0.4、有水印约 2.0+
    tl_threshold: float = 1.0
    # 右下含地面纹理，干净约 1.2~1.4、有水印约 2.0+
    br_threshold: float = 1.75
    # 兼容旧参数：若设置 score_threshold，则两角共用（CLI 覆盖时用）
    score_threshold: float | None = None
    # 检测命中后向前/向后各扩展的帧数，包住进出场半透明帧
    temporal_pad: int = 12
    # 高通核尺寸（越大越忽略缓慢光照变化）
    blur_ksize: int = 21
    # 每个角区用于估计干净底板的最大采样帧数
    plate_samples: int = 48


def scores_to_active(scores: dict[str, float], cfg: DetectConfig) -> dict[str, bool]:
    """根据分角阈值判断当前帧各角是否疑似有水印。"""
    if cfg.score_threshold is not None:
        tl_th = br_th = cfg.score_threshold
    else:
        tl_th, br_th = cfg.tl_threshold, cfg.br_threshold
    return {
        "tl": scores.get("tl", 0.0) >= tl_th,
        "br": scores.get("br", 0.0) >= br_th,
    }


def _roi_abs(box: tuple[float, float, float, float], w: int, h: int) -> tuple[int, int, int, int]:
    x0 = max(0, int(box[0] * w))
    y0 = max(0, int(box[1] * h))
    x1 = min(w, int(box[2] * w))
    y1 = min(h, int(box[3] * h))
    return x0, y0, x1, y1


def corner_score(
    gray_roi: np.ndarray,
    blur_ksize: int,
    bg_mask: np.ndarray | None = None,
) -> tuple[float, float]:
    """
    用灰度相对局部模糊的残差评估角区是否有半透明水印笔画。
    可选 bg_mask：只在浅色背景像素上统计，避免脚部纹理干扰右下角。
    返回 (mean, p95)。
    """
    k = blur_ksize if blur_ksize % 2 == 1 else blur_ksize + 1
    g = gray_roi.astype(np.float32)
    blur = cv2.GaussianBlur(g, (k, k), 0)
    res = np.abs(g - blur)
    if bg_mask is not None:
        sel = bg_mask.astype(bool)
        if int(sel.sum()) < 50:
            return 0.0, 0.0
        vals = res[sel]
    else:
        vals = res.reshape(-1)
    return float(vals.mean()), float(np.percentile(vals, 95))


def detect_frame_scores(
    frame_bgr: np.ndarray,
    cfg: DetectConfig,
    corners: tuple[CornerRoi, ...] = DOUBAO_CORNERS,
) -> dict[str, float]:
    """返回各角区综合分数（取 mean 与归一化后的 p95 的较大者）。"""
    h, w = frame_bgr.shape[:2]
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
    L, a, b = cv2.split(lab)
    bg_like = (
        (L > 155)
        & (np.abs(a.astype(np.int16) - 128) < 18)
        & (np.abs(b.astype(np.int16) - 128) < 18)
    )
    scores: dict[str, float] = {}
    for corner in corners:
        x0, y0, x1, y1 = _roi_abs(corner.box, w, h)
        roi = gray[y0:y1, x0:x1]
        if roi.size == 0:
            scores[corner.name] = 0.0
            continue
        bg = bg_like[y0:y1, x0:x1]
        # 右下可能含脚部：仅在背景像素上计分；左上一般为空，同样更稳
        mean_v, p95_v = corner_score(roi, cfg.blur_ksize, bg)
        scores[corner.name] = max(mean_v, p95_v / 6.0)
    return scores


def temporal_expand(flags: list[bool], pad: int) -> list[bool]:
    """将 True 区间向两侧扩展 pad 帧，覆盖进出场。"""
    n = len(flags)
    out = [False] * n
    for i, on in enumerate(flags):
        if not on:
            continue
        lo = max(0, i - pad)
        hi = min(n, i + pad + 1)
        for j in range(lo, hi):
            out[j] = True
    return out


def studio_bg_mask(frame_bgr: np.ndarray) -> np.ndarray:
    """棚景浅灰背景掩膜：高亮 + 低色度，用于避开人物。"""
    lab = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2LAB)
    L, a, b = cv2.split(lab)
    return (
        (L > 155)
        & (np.abs(a.astype(np.int16) - 128) < 18)
        & (np.abs(b.astype(np.int16) - 128) < 18)
    )


def build_clean_plates(
    input_path: Path,
    timeline_raw: list[dict[str, bool]],
    scores_list: list[dict[str, float]],
    cfg: DetectConfig,
    corners: tuple[CornerRoi, ...] = DOUBAO_CORNERS,
) -> dict[str, np.ndarray]:
    """
    用「该角未激活」的帧估计干净底板（像素中位数）。
    若几乎无干净帧，则回退为该角分数最低的若干帧。
    """
    # 每个角优先用 raw 未激活帧；不够则按分数从低到高补齐
    prefer_idx: dict[str, list[int]] = {c.name: [] for c in corners}
    for i, act in enumerate(timeline_raw):
        for corner in corners:
            if not act.get(corner.name, False):
                prefer_idx[corner.name].append(i)

    for corner in corners:
        if len(prefer_idx[corner.name]) >= min(8, cfg.plate_samples):
            continue
        ranked = sorted(
            range(len(scores_list)),
            key=lambda i: scores_list[i].get(corner.name, 99.0),
        )
        for i in ranked:
            if i not in prefer_idx[corner.name]:
                prefer_idx[corner.name].append(i)
            if len(prefer_idx[corner.name]) >= cfg.plate_samples:
                break

    needed = {n: set(idxs[: cfg.plate_samples]) for n, idxs in prefer_idx.items()}
    buckets: dict[str, list[np.ndarray]] = {c.name: [] for c in corners}

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {input_path}")
    idx = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            for corner in corners:
                if idx in needed[corner.name]:
                    x0, y0, x1, y1 = _roi_abs(corner.box, w, h)
                    buckets[corner.name].append(frame[y0:y1, x0:x1].copy())
            idx += 1
    finally:
        cap.release()

    plates: dict[str, np.ndarray] = {}
    for corner in corners:
        samples = buckets[corner.name]
        if not samples:
            raise RuntimeError(f"角区 {corner.name} 无法采样底板帧")
        stacked = np.stack(samples, axis=0)
        plates[corner.name] = np.median(stacked, axis=0).astype(np.uint8)
    return plates


def apply_clean_plates(
    frame_bgr: np.ndarray,
    active: dict[str, bool],
    plates: dict[str, np.ndarray],
    corners: tuple[CornerRoi, ...] = DOUBAO_CORNERS,
) -> tuple[np.ndarray, bool]:
    """
    将激活角区的浅色背景像素替换为干净底板。
    左上可整块替换；右下仅替换背景，保留鞋子/小腿。
    """
    h, w = frame_bgr.shape[:2]
    out = frame_bgr
    changed = False
    bg = studio_bg_mask(frame_bgr)

    for corner in corners:
        if not active.get(corner.name, False):
            continue
        plate = plates.get(corner.name)
        if plate is None:
            continue
        x0, y0, x1, y1 = _roi_abs(corner.box, w, h)
        roi = out[y0:y1, x0:x1]
        if roi.shape[:2] != plate.shape[:2]:
            plate_r = cv2.resize(plate, (roi.shape[1], roi.shape[0]), interpolation=cv2.INTER_LINEAR)
        else:
            plate_r = plate

        if corner.name == "tl":
            sel = np.ones(roi.shape[:2], dtype=bool)
        else:
            sel = bg[y0:y1, x0:x1]
            # 略膨胀，盖住水印边缘半透明像素
            sel_u8 = sel.astype(np.uint8) * 255
            sel_u8 = cv2.dilate(sel_u8, np.ones((5, 5), np.uint8), iterations=1)
            sel = sel_u8.astype(bool)

        if not sel.any():
            continue
        if not changed:
            out = frame_bgr.copy()
            roi = out[y0:y1, x0:x1]
        roi[sel] = plate_r[sel]
        changed = True

    return out, changed


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def mux_audio(silent_video: Path, source_video: Path, output: Path) -> None:
    """把原视频音轨合并到无视频轨上。"""
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(silent_video),
        "-i",
        str(source_video),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-shortest",
        "-movflags",
        "+faststart",
        str(output),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def collect_scores(cap: cv2.VideoCapture, cfg: DetectConfig) -> tuple[list[dict[str, float]], int, int, float]:
    """第一遍：逐帧算角区分数。"""
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 24.0)
    scores_list: list[dict[str, float]] = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        scores_list.append(detect_frame_scores(frame, cfg))
    return scores_list, w, h, fps


def active_timeline(
    scores_list: list[dict[str, float]],
    cfg: DetectConfig,
) -> tuple[list[dict[str, bool]], list[dict[str, bool]]]:
    """
    分数 → 逐帧激活表。
    返回 (raw, expanded)：raw 用于采干净底板，expanded 用于实际修复（含进出场）。
    """
    names = [c.name for c in DOUBAO_CORNERS]
    raw_flags: dict[str, list[bool]] = {n: [] for n in names}
    for scores in scores_list:
        act = scores_to_active(scores, cfg)
        for n in names:
            raw_flags[n].append(act.get(n, False))
    expanded_flags = {n: temporal_expand(raw_flags[n], cfg.temporal_pad) for n in names}
    raw = [{n: raw_flags[n][i] for n in names} for i in range(len(scores_list))]
    expanded = [{n: expanded_flags[n][i] for n in names} for i in range(len(scores_list))]
    return raw, expanded


def process_video(
    input_path: Path,
    output_path: Path,
    cfg: DetectConfig,
    save_debug_dir: Path | None = None,
) -> None:
    """三遍处理：检测时序 → 估计干净底板 → 合成写出。"""
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"无法打开视频: {input_path}")

    print(f"[1/4] 扫描水印时序: {input_path.name}", flush=True)
    scores_list, w, h, fps = collect_scores(cap, cfg)
    cap.release()
    if not scores_list:
        raise RuntimeError("视频无有效帧")

    timeline_raw, timeline = active_timeline(scores_list, cfg)
    hit_tl = sum(1 for t in timeline if t.get("tl"))
    hit_br = sum(1 for t in timeline if t.get("br"))
    clean_br = sum(1 for t in timeline_raw if not t.get("br"))
    print(
        f"      帧数={len(timeline)}, 左上激活={hit_tl}, 右下激活={hit_br}, "
        f"右下干净帧(底板用)={clean_br}, fps={fps:.2f}",
        flush=True,
    )

    if save_debug_dir is not None:
        save_debug_dir.mkdir(parents=True, exist_ok=True)
        with (save_debug_dir / "scores.csv").open("w", encoding="utf-8") as f:
            f.write("frame,tl_score,br_score,tl_on,br_on\n")
            for i, (sc, act) in enumerate(zip(scores_list, timeline)):
                f.write(
                    f"{i},{sc.get('tl', 0):.3f},{sc.get('br', 0):.3f},"
                    f"{int(act.get('tl', False))},{int(act.get('br', False))}\n"
                )

    print("[2/4] 估计干净底板…", flush=True)
    plates = build_clean_plates(input_path, timeline_raw, scores_list, cfg)
    if save_debug_dir is not None:
        for name, plate in plates.items():
            cv2.imwrite(str(save_debug_dir / f"plate_{name}.png"), plate)

    cap = cv2.VideoCapture(str(input_path))
    tmp_dir = Path(tempfile.mkdtemp(prefix="doubao_wm_"))
    silent_path = tmp_dir / "silent.mp4"
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(silent_path), fourcc, fps, (w, h))
    if not writer.isOpened():
        raise RuntimeError("无法创建临时视频写入器")

    print("[3/4] 合成去除水印…", flush=True)
    idx = 0
    repaired = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            act = timeline[idx] if idx < len(timeline) else {"tl": False, "br": False}
            if act.get("tl") or act.get("br"):
                frame, changed = apply_clean_plates(frame, act, plates)
                if changed:
                    repaired += 1
            writer.write(frame)
            idx += 1
            if idx % 50 == 0:
                print(f"      进度 {idx}/{len(timeline)}", flush=True)
    finally:
        cap.release()
        writer.release()

    print(f"      已修复帧数={repaired}", flush=True)
    print(f"[4/4] 合成音轨 → {output_path}", flush=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if has_ffmpeg():
            mux_audio(silent_path, input_path, output_path)
        else:
            shutil.copy2(silent_path, output_path)
            print("      警告: 未找到 ffmpeg，输出无音轨", flush=True)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    print("完成。", flush=True)


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}_clean{input_path.suffix}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="清理豆包视频水印（双角残差检测 + 干净底板合成）"
    )
    parser.add_argument(
        "input",
        nargs="?",
        default="2号数字人.mp4",
        help="输入视频路径（默认: 2号数字人.mp4）",
    )
    parser.add_argument("-o", "--output", help="输出路径（默认: <原名>_clean.mp4）")
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="若指定则两角共用该阈值；默认左上 1.0 / 右下 1.75",
    )
    parser.add_argument(
        "--temporal-pad",
        type=int,
        default=12,
        help="时序扩展帧数，覆盖进出场（默认 12）",
    )
    parser.add_argument(
        "--debug-dir",
        help="可选：保存 scores.csv 与抽样 mask，便于调参",
    )
    return parser.parse_args(argv)


def resolve_input_path(path_str: str) -> Path | None:
    """解析输入路径：绝对路径 → cwd 相对 → 沿脚本目录向上查找。"""
    p = Path(path_str).expanduser()
    if p.is_file():
        return p.resolve()
    cwd_cand = Path.cwd() / path_str
    if cwd_cand.is_file():
        return cwd_cand.resolve()
    here = Path(__file__).resolve().parent
    for parent in [here, *here.parents]:
        cand = parent / path_str
        if cand.is_file():
            return cand.resolve()
    return None


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    input_path = resolve_input_path(args.input)
    if input_path is None:
        print(f"找不到输入视频: {args.input}", file=sys.stderr)
        return 1

    output_path = (
        Path(args.output).expanduser().resolve()
        if args.output
        else default_output_path(input_path)
    )
    cfg = DetectConfig(
        score_threshold=args.threshold,
        temporal_pad=args.temporal_pad,
    )
    debug_dir = Path(args.debug_dir).expanduser().resolve() if args.debug_dir else None

    try:
        process_video(input_path, output_path, cfg, debug_dir)
    except subprocess.CalledProcessError as exc:
        print(f"ffmpeg 合成失败: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 — CLI 顶层统一报错
        print(f"处理失败: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
