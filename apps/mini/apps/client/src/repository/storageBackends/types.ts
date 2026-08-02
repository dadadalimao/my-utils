/**
 * 平台持久化后端：逻辑 key 不含 novel_ai_ 前缀，值为 JSON 字符串。
 */
export interface StorageBackend {
  /** 加载全部已存条目 */
  loadAll(): Promise<Record<string, string>>
  /** 写入单 key */
  set(key: string, json: string): Promise<void>
  /** 删除单 key */
  remove(key: string): Promise<void>
}
