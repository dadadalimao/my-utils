/**
 * GIF 裁剪并重编码。
 */

import { parseGIF, decompressFrames } from 'gifuct-js';
import gifencPkg from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifencPkg;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} CropRect
 */

/**
 * 统一校验并规范化裁剪区域。
 * @param {Partial<CropRect>} rect
 * @param {number} srcW
 * @param {number} srcH
 * @returns {CropRect}
 */
export function validateCropRect(rect, srcW, srcH) {
  const x = Number.parseInt(rect.x, 10);
  const y = Number.parseInt(rect.y, 10);
  const width = Number.parseInt(rect.width, 10);
  const height = Number.parseInt(rect.height, 10);

  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('裁剪参数必须是整数');
  }
  if (x < 0 || y < 0) {
    throw new Error('裁剪起点 x/y 不能小于 0');
  }
  if (width <= 0 || height <= 0) {
    throw new Error('裁剪宽高必须大于 0');
  }
  if (x >= srcW || y >= srcH) {
    throw new Error(`裁剪起点超出范围，原图尺寸为 ${srcW}x${srcH}`);
  }
  if (x + width > srcW || y + height > srcH) {
    throw new Error(`裁剪范围超出边界，合法范围为 x:[0,${srcW - 1}] y:[0,${srcH - 1}]`);
  }

  return { x, y, width, height };
}

/**
 * @param {Buffer} gifBuffer GIF 文件二进制
 * @param {Partial<CropRect>} cropRect 裁剪范围
 * @param {{ maxColors?: number, repeat?: number, onProgress?: (current: number, total: number) => void }} [options]
 */
export async function gifBufferCrop(gifBuffer, cropRect, options = {}) {
  const gif = parseGIF(gifBuffer.buffer.slice(
    gifBuffer.byteOffset,
    gifBuffer.byteOffset + gifBuffer.byteLength
  ));
  const frames = decompressFrames(gif, true);

  if (!frames.length) {
    throw new Error('GIF 中未解析到有效帧');
  }

  const srcW = gif.lsd.width;
  const srcH = gif.lsd.height;
  const rect = validateCropRect(cropRect, srcW, srcH);
  const total = frames.length;
  const maxColors = Number.isInteger(options.maxColors) && options.maxColors > 0
    ? Math.min(options.maxColors, 256)
    : 256;

  const encoder = GIFEncoder();
  for (let i = 0; i < total; i++) {
    const frame = frames[i];
    const rgba = cropRgbaRegion(frame.patch, srcW, rect);
    const palette = quantize(rgba, maxColors);
    const index = applyPalette(rgba, palette);
    const delayMs = normalizeFrameDelayMs(frame.delay);
    const transparentIndex = findTransparentIndex(rgba, index);
    const hasTransparency = transparentIndex >= 0;

    encoder.writeFrame(index, rect.width, rect.height, {
      palette,
      delay: delayMs,
      repeat: i === 0 ? (options.repeat ?? 0) : undefined,
      transparent: hasTransparency,
      transparentIndex: hasTransparency ? transparentIndex : 0,
      dispose: Number.isInteger(frame.disposalType) ? frame.disposalType : -1
    });

    if (options.onProgress) {
      options.onProgress(i + 1, total);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  encoder.finish();
  return {
    buffer: Buffer.from(encoder.bytes()),
    meta: {
      srcW,
      srcH,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      frameCount: total
    }
  };
}

/**
 * 从完整 RGBA 图像中裁剪子区域。
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @param {number} srcW
 * @param {CropRect} rect
 */
function cropRgbaRegion(rgba, srcW, rect) {
  const out = new Uint8Array(rect.width * rect.height * 4);
  const srcStride = srcW * 4;
  const dstStride = rect.width * 4;
  const startX = rect.x * 4;
  const endX = startX + dstStride;

  for (let row = 0; row < rect.height; row++) {
    const srcOffset = (rect.y + row) * srcStride;
    const dstOffset = row * dstStride;
    out.set(rgba.subarray(srcOffset + startX, srcOffset + endX), dstOffset);
  }

  return out;
}

/**
 * 检测透明像素对应的调色板索引（1-bit 透明）。
 * @param {Uint8Array} rgba
 * @param {Uint8Array} index
 */
function findTransparentIndex(rgba, index) {
  for (let i = 0, px = 0; i < rgba.length; i += 4, px++) {
    if (rgba[i + 3] === 0) {
      return index[px];
    }
  }
  return -1;
}

/**
 * gifuct-js 的 frame.delay 单位就是毫秒（ms），这里不再放大。
 * 为避免部分播放器把 0ms 解释为过长停顿，最小回落到 10ms。
 * @param {number} delay
 */
function normalizeFrameDelayMs(delay) {
  const n = Number(delay);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.max(10, Math.round(n));
}
