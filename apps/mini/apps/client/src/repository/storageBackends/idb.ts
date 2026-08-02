import type { StorageBackend } from './types'

const DB_NAME = 'novel_ai_kv'
const STORE = 'kv'
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'))
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

/**
 * H5：IndexedDB 大容量 KV。
 */
export function createIdbBackend(): StorageBackend {
  let dbPromise: Promise<IDBDatabase> | null = null
  const db = () => {
    if (!dbPromise) dbPromise = openDb()
    return dbPromise
  }

  return {
    async loadAll() {
      const database = await db()
      const tx = database.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const [keys, values] = await Promise.all([
        idbReq(store.getAllKeys()),
        idbReq(store.getAll()),
      ])
      const out: Record<string, string> = {}
      const keyList = keys as IDBValidKey[]
      const valList = values as unknown[]
      for (let i = 0; i < keyList.length; i++) {
        const k = keyList[i]
        const val = valList[i]
        if (typeof k === 'string' && typeof val === 'string') out[k] = val
      }
      return out
    },
    async set(key, json) {
      const database = await db()
      const tx = database.transaction(STORE, 'readwrite')
      await idbReq(tx.objectStore(STORE).put(json, key))
    },
    async remove(key) {
      const database = await db()
      const tx = database.transaction(STORE, 'readwrite')
      await idbReq(tx.objectStore(STORE).delete(key))
    },
  }
}
