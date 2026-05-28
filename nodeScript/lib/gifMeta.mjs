/**
 * 解析 GIF 元信息（帧数、尺寸、原始帧率）
 */

import { parseGIF, decompressFrames } from 'gifuct-js';

/**
 * @param {Buffer|ArrayBuffer} input
 */
export function getGifMeta(input) {
  const buffer = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input);

  const gif = parseGIF(buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ));
  const frames = decompressFrames(gif, false);

  const delays = frames.map((f) => f.delay || 10).filter((d) => d > 0);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / (delays.length || 1);
  const sourceFps = Math.min(60, Math.max(1, Math.round(1000 / avgDelay) || 1));

  return {
    width: gif.lsd.width,
    height: gif.lsd.height,
    frameCount: frames.length,
    /** GIF 内嵌 delay（ms/帧）推算的原始帧率 */
    sourceFps
  };
}
