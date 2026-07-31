/**
 * GIF 转 Lottie（图像序列型 JSON）
 * 将 GIF 各帧解码为 PNG 资源，在预合成内按帧切换图层。
 */

import { parseGIF, decompressFrames } from 'gifuct-js';
import { PNG } from 'pngjs';

/**
 * @param {Buffer} gifBuffer GIF 文件二进制
 * @param {{ maxFrames?: number, fps?: number, onProgress?: (current: number, total: number) => void }} [options]
 */
export async function gifBufferToLottie(gifBuffer, options = {}) {
  const gif = parseGIF(gifBuffer.buffer.slice(
    gifBuffer.byteOffset,
    gifBuffer.byteOffset + gifBuffer.byteLength
  ));
  const frames = decompressFrames(gif, true);

  if (!frames.length) {
    throw new Error('GIF 中未解析到有效帧');
  }

  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const maxFrames = options.maxFrames ?? 0;
  const sliced = maxFrames > 0 ? frames.slice(0, maxFrames) : frames;
  const total = sliced.length;

  const imageAssets = [];
  const frameLayers = [];

  for (let i = 0; i < total; i++) {
    const frame = sliced[i];
    const assetId = `img_${i}`;
    const dataUrl = framePatchToPngDataUrl(frame.patch, width, height);

    // p 必须为完整 data URI，否则 lottie-web 会把 base64 当相对路径请求（导致 URL 超长 431）
    imageAssets.push({
      id: assetId,
      w: width,
      h: height,
      u: '',
      p: dataUrl,
      e: 1
    });

    // 锚点左上，每帧仅在其对应时间点可见（ip/op 为半开区间）
    frameLayers.push({
      ddd: 0,
      ind: i + 1,
      ty: 2,
      nm: `frame_${i}`,
      refId: assetId,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [0, 0, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] }
      },
      ao: 0,
      ip: i,
      op: i + 1,
      st: 0,
      bm: 0
    });

    if (options.onProgress) {
      options.onProgress(i + 1, total);
      // 让出事件循环，便于 SSE 刷新进度
      await new Promise((r) => setImmediate(r));
    }
  }

  const fps = options.fps > 0 ? options.fps : 30;
  const compId = 'comp_frames';

  const lottie = {
    v: '5.7.4',
    fr: fps,
    ip: 0,
    op: total,
    w: width,
    h: height,
    nm: 'gif-to-lottie',
    ddd: 0,
    assets: [
      ...imageAssets,
      {
        id: compId,
        w: width,
        h: height,
        layers: frameLayers
      }
    ],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 0,
        nm: 'gif_sequence',
        refId: compId,
        w: width,
        h: height,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [0, 0, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] }
        },
        ao: 0,
        ip: 0,
        op: total,
        st: 0,
        bm: 0
      }
    ]
  };

  return {
    lottie,
    meta: { width, height, frameCount: total, fps }
  };
}

/**
 * @param {Uint8ClampedArray} patch
 * @param {number} width
 * @param {number} height
 */
function framePatchToPngDataUrl(patch, width, height) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(patch);
  const packed = PNG.sync.write(png);
  return `data:image/png;base64,${packed.toString('base64')}`;
}
