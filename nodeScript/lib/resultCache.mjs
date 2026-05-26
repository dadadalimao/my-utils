/**
 * 转换结果临时缓存（磁盘 JSON，避免响应体过大）
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const TTL_MS = 2 * 60 * 60 * 1000; // 2 小时

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * @param {object} lottie
 * @param {object} meta
 * @returns {{ id: string, meta: object }}
 */
export function saveLottieResult(lottie, meta) {
  ensureCacheDir();
  cleanupExpired();

  const id = crypto.randomBytes(16).toString('hex');
  const filePath = path.join(CACHE_DIR, `${id}.json`);
  const lottieJson = JSON.stringify(lottie);
  const jsonSize = Buffer.byteLength(lottieJson, 'utf8');
  const fullMeta = { ...meta, jsonSize };

  const payload = {
    createdAt: Date.now(),
    meta: fullMeta,
    lottie
  };
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return { id, meta: fullMeta };
}

/**
 * @param {string} id
 */
export function loadLottieResult(id) {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;

  const filePath = path.join(CACHE_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Date.now() - payload.createdAt > TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function cleanupExpired() {
  if (!fs.existsSync(CACHE_DIR)) return;

  const now = Date.now();
  for (const name of fs.readdirSync(CACHE_DIR)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(CACHE_DIR, name);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > TTL_MS) {
        fs.unlinkSync(filePath);
      }
    } catch {
      /* ignore */
    }
  }
}
