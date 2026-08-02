import type { StorageBackend } from './types'

const PREFIX = 'novel_ai_'

/**
 * 默认后端：uni.setStorageSync（容量有限，其它端回退用）。
 */
export function createUniBackend(): StorageBackend {
  return {
    async loadAll() {
      const out: Record<string, string> = {}
      try {
        const info = uni.getStorageInfoSync()
        for (const full of info.keys || []) {
          if (!full.startsWith(PREFIX)) continue
          const logical = full.slice(PREFIX.length)
          if (!logical) continue
          try {
            const raw = uni.getStorageSync(full)
            if (raw === '' || raw === undefined || raw === null) continue
            out[logical] = typeof raw === 'string' ? raw : JSON.stringify(raw)
          } catch {
            /* skip broken key */
          }
        }
      } catch {
        /* empty */
      }
      return out
    },
    async set(key, json) {
      uni.setStorageSync(PREFIX + key, json)
    },
    async remove(key) {
      uni.removeStorageSync(PREFIX + key)
    },
  }
}

/**
 * 从 uni.storage 读取全部 novel_ai_*（用于迁移到 H5 IDB / 微信 FS）。
 */
export function readAllUniPrefixed(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const info = uni.getStorageInfoSync()
    for (const full of info.keys || []) {
      if (!full.startsWith(PREFIX)) continue
      const logical = full.slice(PREFIX.length)
      if (!logical) continue
      try {
        const raw = uni.getStorageSync(full)
        if (raw === '' || raw === undefined || raw === null) continue
        out[logical] = typeof raw === 'string' ? raw : JSON.stringify(raw)
      } catch {
        /* skip */
      }
    }
  } catch {
    /* empty */
  }
  return out
}

/**
 * 删除已迁移的 uni.storage 前缀 key（保留未迁移成功时的备份）。
 */
export function removeUniPrefixedKeys(logicalKeys: string[]): void {
  for (const key of logicalKeys) {
    try {
      uni.removeStorageSync(PREFIX + key)
    } catch {
      /* ignore */
    }
  }
}
