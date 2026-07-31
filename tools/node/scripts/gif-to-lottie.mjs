#!/usr/bin/env node
/**
 * CLI：GIF → Lottie JSON
 * 用法：node scripts/gif-to-lottie.mjs <input.gif> [output.json] [--max-frames=N] [--fps=N]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gifBufferToLottie } from '../lib/gifToLottie.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printUsage() {
  console.log(`用法:
  node scripts/gif-to-lottie.mjs <input.gif> [output.json] [--max-frames=N] [--fps=N]

示例:
  node scripts/gif-to-lottie.mjs ./demo.gif ./demo.lottie.json
  node scripts/gif-to-lottie.mjs ./demo.gif --max-frames=60 --fps=24`);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (const arg of argv) {
    if (arg.startsWith('--max-frames=')) {
      flags.maxFrames = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--fps=')) {
      flags.fps = parseInt(arg.split('=')[1], 10);
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
    : inputPath.replace(/\.gif$/i, '') + '.lottie.json';

  if (!fs.existsSync(inputPath)) {
    console.error(`文件不存在: ${inputPath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(inputPath);
  const opts = { fps: flags.fps > 0 ? flags.fps : 30 };
  if (flags.maxFrames > 0) opts.maxFrames = flags.maxFrames;

  const { lottie, meta } = await gifBufferToLottie(buffer, opts);
  fs.writeFileSync(outputPath, JSON.stringify(lottie, null, 2), 'utf8');

  console.log(`已生成: ${outputPath}`);
  console.log(`尺寸: ${meta.width}x${meta.height}, 帧数: ${meta.frameCount}, 帧率: ${meta.fps}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
