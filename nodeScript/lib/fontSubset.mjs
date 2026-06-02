/**
 * 字体子集化：按指定字符集提取字形，减小字体体积
 */

import fs from 'fs';
import path from 'path';
import subsetFont from 'subset-font';

/** 预置字符集 */
export const FONT_SUBSET_PRESETS = {
  /** 纯数字 0-9 */
  digits: '0123456789',
  /** 数字及常用数值符号 */
  numbers: '0123456789.,-+:% ',
  /** 数字 + 常见货币符号 */
  currency: '0123456789.,-+:% ¥$€£₩¢₹₽'
};

const FONT_EXT_RE = /\.(ttf|otf|woff2?)$/i;
const FONT_MIME_RE = /^(font\/(ttf|otf|woff2?)|application\/(font-sfnt|x-font-ttf|vnd\.ms-fontobject))$/i;

/**
 * 判断是否为支持的字体文件
 * @param {{ originalname?: string, mimetype?: string }} file
 */
export function isFontFile(file) {
  const name = file?.originalname || '';
  const mime = String(file?.mimetype || '').toLowerCase();
  return FONT_EXT_RE.test(name) || FONT_MIME_RE.test(mime);
}

/**
 * 根据扩展名推断 subset-font 输出格式
 * @param {string} ext 含点，如 .ttf
 */
export function targetFormatFromExt(ext) {
  const normalized = String(ext || '').toLowerCase();
  if (normalized === '.woff2') return 'woff2';
  if (normalized === '.woff') return 'woff';
  return 'sfnt';
}

/**
 * 合并预置与自定义字符，去重并保持顺序
 * @param {string} presetKey numbers | currency | custom
 * @param {string} [customChars]
 */
export function resolveSubsetText(presetKey, customChars = '') {
  const preset = FONT_SUBSET_PRESETS[presetKey];
  const base = preset ?? '';
  const extra = String(customChars || '');
  const seen = new Set();
  let text = '';

  for (const ch of base + extra) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    text += ch;
  }

  if (!text) {
    throw new Error('字符集为空，请选择预置或输入自定义字符');
  }
  return text;
}

/**
 * 对字体 Buffer 做子集化
 * @param {Buffer} fontBuffer
 * @param {{ preset?: string, customChars?: string, targetFormat?: string }} options
 */
export async function fontBufferSubset(fontBuffer, options = {}) {
  const preset = options.preset || 'numbers';
  const text = resolveSubsetText(preset, options.customChars);
  const targetFormat = options.targetFormat || 'sfnt';

  const originalSize = fontBuffer.length;
  const subsetBuffer = await subsetFont(fontBuffer, text, { targetFormat });
  const outputSize = subsetBuffer.length;

  return {
    buffer: Buffer.from(subsetBuffer),
    meta: {
      preset,
      charCount: [...text].length,
      chars: text,
      originalSize,
      outputSize,
      savedBytes: Math.max(0, originalSize - outputSize),
      savedPercent: originalSize > 0
        ? Math.round((1 - outputSize / originalSize) * 1000) / 10
        : 0,
      targetFormat
    }
  };
}

/**
 * 从文件名解析输出扩展名（保持与原文件一致）
 * @param {string} filename
 */
export function outputExtFromFilename(filename) {
  const match = String(filename || '').match(FONT_EXT_RE);
  return match ? `.${match[1].toLowerCase()}` : '.ttf';
}

/** assets/fonts 相对 nodeScript 根目录 */
export const FONT_ASSETS_REL = path.join('assets', 'fonts');

/**
 * 列出 assets/fonts 下的字体文件
 * @param {string} assetsDir 绝对路径
 */
export function listAssetFonts(assetsDir) {
  if (!fs.existsSync(assetsDir)) return [];

  return fs.readdirSync(assetsDir)
    .filter((name) => FONT_EXT_RE.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(assetsDir, name));
      return { name, size: stat.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * 解析 assets/fonts 内字体路径（防目录穿越）
 * @param {string} assetsDir 绝对路径
 * @param {string} filename 文件名
 */
export function resolveAssetFontPath(assetsDir, filename) {
  const name = String(filename || '').trim();
  if (!name || /[/\\]/.test(name) || name.includes('..')) {
    throw new Error('无效的字体文件名');
  }
  if (!FONT_EXT_RE.test(name)) {
    throw new Error('不支持的字体格式');
  }

  const resolvedDir = path.resolve(assetsDir);
  const fullPath = path.resolve(resolvedDir, name);
  const relative = path.relative(resolvedDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('无效的字体路径');
  }
  return fullPath;
}

/**
 * 读取 assets/fonts 中的字体
 * @param {string} assetsDir 绝对路径
 * @param {string} filename 文件名
 */
export function readAssetFont(assetsDir, filename) {
  const fullPath = resolveAssetFontPath(assetsDir, filename);
  if (!fs.existsSync(fullPath)) {
    throw new Error('assets/fonts 中未找到该字体');
  }
  return {
    buffer: fs.readFileSync(fullPath),
    filename: path.basename(fullPath)
  };
}
