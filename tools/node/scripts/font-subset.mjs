#!/usr/bin/env node
/**
 * CLI：字体子集压缩
 * 用法：node scripts/font-subset.mjs <input.ttf> [output.ttf] --preset=numbers
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  fontBufferSubset,
  FONT_ASSETS_REL,
  FONT_SUBSET_PRESETS,
  outputExtFromFilename,
  readAssetFont,
  targetFormatFromExt
} from '../lib/fontSubset.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_ASSETS_DIR = path.join(__dirname, '..', FONT_ASSETS_REL);

function printUsage() {
  const presetKeys = Object.keys(FONT_SUBSET_PRESETS).join(' | ');
  console.log(`用法:
  node scripts/font-subset.mjs <input.font> [output.font] --preset=${presetKeys} [--chars=额外字符]
  node scripts/font-subset.mjs --asset=<fonts目录内文件名> [output.font] --preset=numbers

预置字符:
  numbers  → ${FONT_SUBSET_PRESETS.numbers}
  currency → ${FONT_SUBSET_PRESETS.currency}

示例:
  node scripts/font-subset.mjs ./font.ttf ./font_subset.ttf --preset=numbers
  node scripts/font-subset.mjs --asset=PangMenZhengDaoBiaoTiTiMianFeiBan-2.ttf --preset=currency`);
}
function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (const arg of argv) {
    if (arg.startsWith('--preset=')) {
      flags.preset = arg.slice('--preset='.length);
    } else if (arg.startsWith('--chars=')) {
      flags.chars = arg.slice('--chars='.length);
    } else if (arg.startsWith('--asset=')) {
      flags.asset = arg.slice('--asset='.length);
    } else if (arg === '--help' || arg === '-h') {      flags.help = true;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || (positional.length < 1 && !flags.asset)) {
    printUsage();
    process.exit(flags.help ? 0 : 1);
  }

  let inputPath;
  let inputName;

  if (flags.asset) {
    const asset = readAssetFont(FONT_ASSETS_DIR, flags.asset);
    inputName = asset.filename;
    inputPath = path.join(FONT_ASSETS_DIR, asset.filename);
  } else {
    inputPath = path.resolve(positional[0]);
    inputName = path.basename(inputPath);
    if (!fs.existsSync(inputPath)) {
      console.error(`文件不存在: ${inputPath}`);
      process.exit(1);
    }
  }

  const ext = outputExtFromFilename(inputName);
  const outputPath = positional[flags.asset ? 0 : 1]
    ? path.resolve(positional[flags.asset ? 0 : 1])
    : inputPath.replace(/\.(ttf|otf|woff2?)$/i, '') + '_subset' + ext;
  const preset = flags.preset || 'numbers';
  if (preset !== 'custom' && !FONT_SUBSET_PRESETS[preset]) {
    console.error(`未知预置: ${preset}`);
    printUsage();
    process.exit(1);
  }

  const fontBuffer = flags.asset
    ? readAssetFont(FONT_ASSETS_DIR, flags.asset).buffer
    : fs.readFileSync(inputPath);  const { buffer, meta } = await fontBufferSubset(fontBuffer, {
    preset,
    customChars: flags.chars || '',
    targetFormat: targetFormatFromExt(ext)
  });

  fs.writeFileSync(outputPath, buffer);

  console.log(`已生成: ${outputPath}`);
  console.log(`字符 ${meta.charCount} 个，${meta.originalSize} → ${meta.outputSize} 字节（约减 ${meta.savedPercent}%）`);
  console.log(`保留: ${meta.chars}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
