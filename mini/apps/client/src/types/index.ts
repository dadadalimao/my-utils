/** 对话模式 */
export type ChatMode = 'chapter' | 'outline' | 'advice'

/** AI 厂商 */
export type Provider = 'deepseek' | 'kimi'

/** 大纲来源 */
export type OutlineSource = 'manual' | 'from_content' | 'from_chat'

/** 章节大纲（与正文分字段，便于单独提取） */
export interface ChapterOutline {
  /** 2～4 句剧情摘要（起因—经过—结果） */
  summary: string
  /** 本章关键事件（情节点） */
  beats: string[]
  /** 人物状态变化（每条一人/一事） */
  characterStates: string[]
  /** 章末伏笔 / 未收束线（供后文衔接） */
  hangingThreads: string[]
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

export interface NovelMeta {
  intro?: string
  genre?: string
  /**
   * 本书通用设定（世界观/文风/道具品质/高潮惯例等）。
   * 建议用【标签】分节；写作时注入 system。
   */
  bible?: string
}

export interface Novel {
  id: string
  title: string
  meta?: NovelMeta
  updatedAt: string
  chapterIds: string[]
}

export interface OutlineRange {
  /**
   * continuity：前文摘要 + 上一章完整大纲 + 上一章结尾正文（推荐，利于衔接）
   * all / current / range：仅注入大纲，不带正文
   */
  type: 'continuity' | 'current' | 'range' | 'all'
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
  /** 发送时按关键词自动注入命中的设定卡 */
  injectLoreByKeyword: boolean
  apiBaseUrl: string
}

/** 人物卡 / 道具卡 */
export type LoreCardKind = 'character' | 'item'

export interface LoreCard {
  id: string
  novelId: string
  kind: LoreCardKind
  name: string
  /** 触发注入的关键词（多个） */
  keywords: string[]
  content: string
  updatedAt: string
}

/** AI 抽取设定卡的单条操作（确认前暂存） */
export interface LoreCardOp {
  action: 'create' | 'update'
  id?: string
  kind: LoreCardKind
  name: string
  keywords: string[]
  content: string
  reason: string
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
  /** 人物/道具设定卡；旧快照可能缺失 */
  loreCards?: LoreCard[]
  settings: UserSettings
  currentNovelId: string | null
  exportedAt: string
}

export function emptyOutline(): ChapterOutline {
  return {
    summary: '',
    beats: [],
    characterStates: [],
    hangingThreads: [],
    notes: '',
  }
}

/** 兼容旧快照缺失字段 */
export function normalizeOutline(raw?: Partial<ChapterOutline> | null): ChapterOutline {
  const o = raw || {}
  return {
    summary: String(o.summary || ''),
    beats: Array.isArray(o.beats) ? o.beats.map(String) : [],
    characterStates: Array.isArray(o.characterStates) ? o.characterStates.map(String) : [],
    hangingThreads: Array.isArray(o.hangingThreads) ? o.hangingThreads.map(String) : [],
    notes: String(o.notes || ''),
    source: o.source,
    updatedAt: o.updatedAt,
  }
}

export function createId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}
