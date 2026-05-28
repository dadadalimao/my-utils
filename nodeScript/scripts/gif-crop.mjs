#!/usr/bin/env node
/**
 * CLI：GIF 裁剪
 * 用法：node scripts/gif-crop.mjs <input.gif> [output.gif] --x=0 --y=0 --width=100 --height=100
 */

import fs from 'fs';
import path from 'path';
import { gifBufferCrop } from '../lib/gifCrop.mjs';

function printUsage() {
  console.log(`用法:
  node scripts/gif-crop.mjs <input.gif> [output.gif] --x=0 --y=0 --width=100 --height=100

示例:
  node scripts/gif-crop.mjs ./demo.gif ./demo_crop.gif --x=10 --y=20 --width=300 --height=180`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (const arg of argv) {
    if (arg.startsWith('--x=')) {
      flags.x = parseInt(arg.slice('--x='.length), 10);
    } else if (arg.startsWith('--y=')) {
      flags.y = parseInt(arg.slice('--y='.length), 10);
    } else if (arg.startsWith('--width=')) {
      flags.width = parseInt(arg.slice('--width='.length), 10);
    } else if (arg.startsWith('--height=')) {
      flags.height = parseInt(arg.slice('--height='.length), 10);
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || positional.length < 1) {
    printUsage();
    process.exit(flags.help ? 0 : 1);
  }

  const inputPath = path.resolve(positional[0]);
  const outputPath = positional[1]
    ? path.resolve(positional[1])
    : inputPath.replace(/\.gif$/i, '') + '_crop.gif';

  if (!fs.existsSync(inputPath)) {
    console.error(`文件不存在: ${inputPath}`);
    process.exit(1);
  }

  const needed = ['x', 'y', 'width', 'height'];
  for (const key of needed) {
    if (!Number.isInteger(flags[key])) {
      console.error(`缺少参数 --${key}=整数`);
      printUsage();
      process.exit(1);
    }
  }

  const gifBuffer = fs.readFileSync(inputPath);
  const { buffer, meta } = await gifBufferCrop(gifBuffer, {
    x: flags.x,
    y: flags.y,
    width: flags.width,
    height: flags.height
  });
  fs.writeFileSync(outputPath, buffer);

  console.log(`已生成: ${outputPath}`);
  console.log(`原图 ${meta.srcW}x${meta.srcH} -> 裁剪 ${meta.width}x${meta.height}，共 ${meta.frameCount} 帧`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
