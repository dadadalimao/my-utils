import type { StorageBackend } from './types'

/** 微信小程序全局（条件编译仅在 MP-WEIXIN 打包） */
declare const wx: {
  env: { USER_DATA_PATH: string }
  getFileSystemManager: () => UniApp.FileSystemManager
}

/**
 * 微信小程序：USER_DATA_PATH 下每 key 一文件。
 */
export function createFsBackend(): StorageBackend {
  const fsm = wx.getFileSystemManager()
  const root = `${wx.env.USER_DATA_PATH}/novel_ai_kv`

  function ensureDir() {
    try {
      fsm.accessSync(root)
    } catch {
      try {
        fsm.mkdirSync(root, true)
      } catch {
        /* race ok */
      }
    }
  }

  function filePath(key: string): string {
    return `${root}/${encodeURIComponent(key)}.json`
  }

  return {
    async loadAll() {
      ensureDir()
      const out: Record<string, string> = {}
      let names: string[] = []
      try {
        names = fsm.readdirSync(root) as string[]
      } catch {
        return out
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const encoded = name.slice(0, -'.json'.length)
        let key: string
        try {
          key = decodeURIComponent(encoded)
        } catch {
          continue
        }
        try {
          const raw = fsm.readFileSync(filePath(key), 'utf8') as string
          if (raw) out[key] = raw
        } catch {
          /* skip */
        }
      }
      return out
    },
    async set(key, json) {
      ensureDir()
      fsm.writeFileSync(filePath(key), json, 'utf8')
    },
    async remove(key) {
      try {
        fsm.unlinkSync(filePath(key))
      } catch {
        /* ignore missing */
      }
    },
  }
}
