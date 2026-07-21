const PREFIX = 'novel_ai_'

export function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = uni.getStorageSync(PREFIX + key)
    if (raw === '' || raw === undefined || raw === null) return fallback
    return typeof raw === 'string' ? (JSON.parse(raw) as T) : (raw as T)
  } catch {
    return fallback
  }
}

export function storageSet(key: string, value: unknown): void {
  uni.setStorageSync(PREFIX + key, JSON.stringify(value))
}

export function storageRemove(key: string): void {
  uni.removeStorageSync(PREFIX + key)
}
