/** 对话模式 */
export type ChatMode = 'chapter' | 'outline' | 'advice'

/** AI 厂商 */
export type Provider = 'deepseek' | 'kimi'

/** 大纲来源 */
export type OutlineSource = 'manual' | 'from_content' | 'from_chat'

/** 章节大纲（与正文分字段，便于单独提取） */
export interface ChapterOutline {
  summary: string
  beats: string[]
  notes: string
  source?: OutlineSource
  updatedAt?: string
}

export interface Chapter {
  id: string
  novelId: string
  title: string
  order: number
  content: string
  outline: ChapterOutline
  updatedAt: string
}

export interface Novel {
  id: string
  title: string
  meta?: { intro?: string; genre?: string }
  updatedAt: string
  chapterIds: string[]
}

export interface OutlineRange {
  type: 'current' | 'range' | 'all'
  /** range 时：起止 order（含） */
  fromOrder?: number
  toOrder?: number
  currentChapterId?: string
}

export interface UserSettings {
  deepseekApiKey: string
  kimiApiKey: string
  defaultProvider: Provider
  defaultModel: string
  /** 保存正文后自动维护大纲 */
  autoMaintainOutline: boolean
  /** 对话时默认注入大纲 */
  injectOutlineByDefault: boolean
  apiBaseUrl: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export interface PromptTemplate {
  id: string
  mode: ChatMode
  name: string
  content: string
  updatedAt?: string
}

/** 全量同步快照 */
export interface SyncPayload {
  version: 1
  novels: Novel[]
  chapters: Chapter[]
  settings: UserSettings
  currentNovelId: string | null
  exportedAt: string
}

export function emptyOutline(): ChapterOutline {
  return { summary: '', beats: [], notes: '' }
}

export function createId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}
