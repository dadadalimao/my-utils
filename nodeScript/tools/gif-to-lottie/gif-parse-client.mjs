/**
 * 浏览器端 GIF 元信息解析（无需上传）
 */

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{ width: number, height: number, frameCount: number, sourceFps: number|null }}
 */
export function parseGifLocal(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const sig = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
  if (!sig.startsWith('GIF')) {
    throw new Error('不是有效的 GIF 文件');
  }

  const width = u8[6] | (u8[7] << 8);
  const height = u8[8] | (u8[9] << 8);

  let frameCount = 0;
  const delays = [];
  let i = 13; // 跳过 Logical Screen Descriptor + 全局调色板（若有）

  const packed = u8[10];
  if (packed & 0x80) {
    const gctSize = 2 << (packed & 0x07);
    i += gctSize * 3;
  }

  while (i < u8.length) {
    const block = u8[i];

    if (block === 0x21) {
      const label = u8[i + 1];
      if (label === 0xf9 && i + 6 < u8.length) {
        delays.push(u8[i + 4] | (u8[i + 5] << 8) || 10);
      }
      i += 2;
      while (i < u8.length && u8[i] !== 0) {
        i += 1 + u8[i];
      }
      if (i < u8.length && u8[i] === 0) i++;
      continue;
    }

    if (block === 0x2c) {
      frameCount++;
      i += 9;
      const localPacked = u8[i];
      if (localPacked & 0x80) {
        const lctSize = 2 << (localPacked & 0x07);
        i += lctSize * 3;
      }
      i++;
      if (i < u8.length) i += 1 + u8[i];
      while (i < u8.length && u8[i] !== 0) {
        i += 1 + u8[i];
      }
      if (i < u8.length && u8[i] === 0) i++;
      continue;
    }

    if (block === 0x3b) break;
    i++;
  }

  let sourceFps = null;
  if (delays.length) {
    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    sourceFps = Math.min(60, Math.max(1, Math.round(100 / avg) || 1));
  }

  return {
    width,
    height,
    frameCount: Math.max(frameCount, 1),
    sourceFps
  };
}
