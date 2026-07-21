import * as crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

/**
 * 使用 DATA_ENCRYPTION_KEY 对敏感字段做 AES-256-GCM 加解密。
 * Key 需为 32 字节；不足则 sha256 派生。
 */
function deriveKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY || 'default-dev-key-change-me!!';
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptText(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptText(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

/** 加密快照中的 API Key 字段后序列化入库 */
export function encryptSnapshotPayload(payload: Record<string, unknown>): string {
  const clone = structuredClone(payload) as Record<string, unknown>;
  const settings = clone.settings as Record<string, unknown> | undefined;
  if (settings) {
    if (typeof settings.deepseekApiKey === 'string' && settings.deepseekApiKey) {
      settings.deepseekApiKey = encryptText(settings.deepseekApiKey);
      settings.deepseekApiKeyEnc = true;
    }
    if (typeof settings.kimiApiKey === 'string' && settings.kimiApiKey) {
      settings.kimiApiKey = encryptText(settings.kimiApiKey);
      settings.kimiApiKeyEnc = true;
    }
  }
  return JSON.stringify(clone);
}

/** 从库中读出并解密 API Key，返回给客户端 */
export function decryptSnapshotPayload(json: string): Record<string, unknown> {
  const clone = JSON.parse(json) as Record<string, unknown>;
  const settings = clone.settings as Record<string, unknown> | undefined;
  if (settings) {
    if (settings.deepseekApiKeyEnc && typeof settings.deepseekApiKey === 'string') {
      settings.deepseekApiKey = decryptText(settings.deepseekApiKey);
      delete settings.deepseekApiKeyEnc;
    }
    if (settings.kimiApiKeyEnc && typeof settings.kimiApiKey === 'string') {
      settings.kimiApiKey = decryptText(settings.kimiApiKey);
      delete settings.kimiApiKeyEnc;
    }
  }
  return clone;
}
