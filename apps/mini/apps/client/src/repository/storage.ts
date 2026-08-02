import type { StorageBackend } from './storageBackends/types'
import { createIdbBackend } from './storageBackends/idb'
import { createFsBackend } from './storageBackends/fs'
import {
  createUniBackend,
  readAllUniPrefixed,
  removeUniPrefixedKeys,
} from './storageBackends/uni'

const META_BACKEND = '__storageBackend'
const BACKEND_V2 = 'v2'

/** 旧整包 key → 拆键后删除 */
const LEGACY_BLOB_KEYS = ['chapters', 'loreCards', 'libraryEntries'] as const

const memory = new Map<string, string>()
let backend: StorageBackend = createUniBackend()
let ready = false
let readyPromise: Promise<void> | null = null
/** 是否使用非 uni 大容量后端（迁移后可清理 uni 副本） */
let usesExternalBackend = false

function resolveBackend(): { backend: StorageBackend; external: boolean } {
  // #ifdef H5
  return { backend: createIdbBackend(), external: true }
  // #endif
  // #ifdef MP-WEIXIN
  return { backend: createFsBackend(), external: true }
  // #endif
  // 其它端：继续 uni.storage（条件编译后 H5/微信不会落到此处）
  return { backend: createUniBackend(), external: false }
}

async function persistKey(key: string, json: string | null): Promise<void> {
  try {
    if (json === null) await backend.remove(key)
    else await backend.set(key, json)
  } catch (e) {
    console.warn('[storage] persist failed', key, e)
  }
}

/**
 * 将旧整包 chapters / loreCards / libraryEntries 拆成索引 + 实体 key。
 */
function splitLegacyBlobsInMemory(): string[] {
  const removed: string[] = []

  const chaptersRaw = memory.get('chapters')
  if (chaptersRaw && !memory.has('chapterIndex')) {
    try {
      const list = JSON.parse(chaptersRaw) as { id?: string }[]
      const ids: string[] = []
      if (Array.isArray(list)) {
        for (const c of list) {
          if (!c?.id) continue
          ids.push(c.id)
          memory.set(`chapter:${c.id}`, JSON.stringify(c))
        }
      }
      memory.set('chapterIndex', JSON.stringify(ids))
      memory.delete('chapters')
      removed.push('chapters')
    } catch (e) {
      console.warn('[storage] split chapters failed', e)
    }
  }

  const loreRaw = memory.get('loreCards')
  if (loreRaw && !memory.has('loreIndex')) {
    try {
      const list = JSON.parse(loreRaw) as { id?: string }[]
      const ids: string[] = []
      if (Array.isArray(list)) {
        for (const c of list) {
          if (!c?.id) continue
          ids.push(c.id)
          memory.set(`lore:${c.id}`, JSON.stringify(c))
        }
      }
      memory.set('loreIndex', JSON.stringify(ids))
      memory.delete('loreCards')
      removed.push('loreCards')
    } catch (e) {
      console.warn('[storage] split loreCards failed', e)
    }
  }

  const libRaw = memory.get('libraryEntries')
  if (libRaw && !memory.has('libraryIndex')) {
    try {
      const list = JSON.parse(libRaw) as { id?: string }[]
      const ids: string[] = []
      if (Array.isArray(list)) {
        for (const e of list) {
          if (!e?.id) continue
          ids.push(e.id)
          memory.set(`library:${e.id}`, JSON.stringify(e))
        }
      }
      memory.set('libraryIndex', JSON.stringify(ids))
      memory.delete('libraryEntries')
      removed.push('libraryEntries')
    } catch (e) {
      console.warn('[storage] split libraryEntries failed', e)
    }
  }

  return removed
}

async function flushMemoryToBackend(): Promise<void> {
  for (const [key, json] of memory.entries()) {
    await backend.set(key, json)
  }
}

async function initStorage(): Promise<void> {
  const resolved = resolveBackend()
  backend = resolved.backend
  usesExternalBackend = resolved.external

  memory.clear()
  const loaded = await backend.loadAll()
  for (const [k, v] of Object.entries(loaded)) {
    memory.set(k, v)
  }

  const alreadyV2 = memory.get(META_BACKEND) === BACKEND_V2

  if (!alreadyV2) {
    const fromUni = readAllUniPrefixed()
    for (const [k, v] of Object.entries(fromUni)) {
      if (!memory.has(k)) memory.set(k, v)
    }
  }

  const removedBlobs = splitLegacyBlobsInMemory()
  memory.set(META_BACKEND, BACKEND_V2)

  await flushMemoryToBackend()

  for (const k of removedBlobs) {
    await backend.remove(k)
  }
  for (const k of LEGACY_BLOB_KEYS) {
    if (!memory.has(k)) {
      try {
        await backend.remove(k)
      } catch {
        /* ignore */
      }
    }
  }

  if (usesExternalBackend) {
    removeUniPrefixedKeys([...memory.keys(), ...LEGACY_BLOB_KEYS, META_BACKEND])
  }

  ready = true
}

/**
 * App 启动时 await：加载平台后端、迁移旧 uni 数据、拆分大集合。
 */
export function storageReady(): Promise<void> {
  if (ready) return Promise.resolve()
  if (!readyPromise) {
    readyPromise = initStorage().catch((e) => {
      console.error('[storage] init failed, fallback to uni memory', e)
      backend = createUniBackend()
      usesExternalBackend = false
      try {
        const fromUni = readAllUniPrefixed()
        memory.clear()
        for (const [k, v] of Object.entries(fromUni)) memory.set(k, v)
        splitLegacyBlobsInMemory()
        memory.set(META_BACKEND, BACKEND_V2)
      } catch {
        /* keep empty memory */
      }
      ready = true
    })
  }
  return readyPromise.then(() => undefined)
}

export function isStorageReady(): boolean {
  return ready
}

export function storageGet<T>(key: string, fallback: T): T {
  if (!ready) {
    try {
      const raw = uni.getStorageSync(`novel_ai_${key}`)
      if (raw === '' || raw === undefined || raw === null) return fallback
      return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T)
    } catch {
      return fallback
    }
  }
  const json = memory.get(key)
  if (json === undefined) return fallback
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export function storageSet(key: string, value: unknown): void {
  const json = JSON.stringify(value)
  memory.set(key, json)
  if (ready) {
    void persistKey(key, json)
  } else {
    try {
      uni.setStorageSync(`novel_ai_${key}`, json)
    } catch (e) {
      console.warn('[storage] early set failed', key, e)
    }
  }
}

export function storageRemove(key: string): void {
  memory.delete(key)
  if (ready) {
    void persistKey(key, null)
  } else {
    try {
      uni.removeStorageSync(`novel_ai_${key}`)
    } catch {
      /* ignore */
    }
  }
}
