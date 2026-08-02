/** 对话模式 */
export type ChatMode = 'chapter' | 'outline' | 'advice'

/** AI 厂商 */
export type Provider = 'deepseek' | 'kimi'

/** 写作体量模式：轻量短篇 / 长篇规范 */
export type WritingMode = 'light' | 'long'

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
  /**
   * 写作模式。缺省视为 light（旧书兼容）。
   * long：写正文前强制全书大纲 + 本章大纲。
   */
  writingMode?: WritingMode
  /** 全书剧情大纲（自由文本；长篇门禁要求非空） */
  bookOutline?: string
  /** 预计体量（字），UI 提示用 */
  targetWords?: number
  /** 完成「升级为长篇规范」迁移的时间戳 */
  migratedAt?: string
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
  /** 发送时按关键词自动注入命中的资料库条目 */
  injectLibraryByKeyword: boolean
  /**
   * DeepSeek 原生联网搜索（Anthropic web_search）。
   * 仅 defaultProvider/会话使用 DeepSeek 时生效；默认关闭。
   */
  enableDeepseekWebSearch: boolean
  apiBaseUrl: string
}

/** 小说资料库条目（同人/原作参考资料，按小说隔离） */
export interface LibraryEntry {
  id: string
  novelId: string
  title: string
  /** 资料正文 */
  content: string
  /** 可选来源链接 */
  sourceUrl?: string
  /** 触发注入的关键词 */
  keywords: string[]
  updatedAt: string
}

/** 人物卡 / 道具卡 */
export type LoreCardKind = 'character' | 'item'

/** 设定卡时间线阶段（自某章起生效） */
export interface LoreStateEntry {
  id: string
  /** 自该章序起生效 */
  fromOrder: number
  /** 阶段标签，如「开眼后」 */
  label?: string
  content: string
  updatedAt: string
}

export interface LoreCard {
  id: string
  novelId: string
  kind: LoreCardKind
  name: string
  /** 触发注入的关键词（多个） */
  keywords: string[]
  /**
   * 兼容旧字段：与 core 同步读写。
   * 旧快照仅有 content 时，归一写入 core。
   */
  content: string
  /** 稳定本体（身份/外貌/固有能力等） */
  core: string
  /** 按章成长时间线；轻量模式可空 */
  states: LoreStateEntry[]
  updatedAt: string
}

/** AI 抽取设定卡的单条操作（确认前暂存） */
export interface LoreCardOp {
  action: 'create' | 'update'
  id?: string
  kind: LoreCardKind
  name: string
  keywords: string[]
  /** 完整 content 兼容字段；长篇优先用 core/state */
  content: string
  /** 可选：仅更新本体 */
  core?: string
  /** 可选：写入/合并到该章序的时间线阶段 */
  stateFromOrder?: number
  stateLabel?: string
  stateContent?: string
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
  /** 资料库条目；旧快照可能缺失 */
  libraryEntries?: LibraryEntry[]
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

/** 旧书缺省为轻量模式 */
export function getWritingMode(meta?: NovelMeta | null): WritingMode {
  return meta?.writingMode === 'long' ? 'long' : 'light'
}

/** 归一小说 meta（不强制写入 writingMode，读时用 getWritingMode） */
export function normalizeNovelMeta(raw?: Partial<NovelMeta> | null): NovelMeta {
  const m = raw || {}
  const out: NovelMeta = {}
  if (m.intro != null) out.intro = String(m.intro)
  if (m.genre != null) out.genre = String(m.genre)
  if (m.bible != null) out.bible = String(m.bible)
  if (m.writingMode === 'long' || m.writingMode === 'light') out.writingMode = m.writingMode
  if (m.bookOutline != null) out.bookOutline = String(m.bookOutline)
  if (m.targetWords != null && Number.isFinite(Number(m.targetWords))) {
    out.targetWords = Math.floor(Number(m.targetWords))
  }
  if (m.migratedAt != null) out.migratedAt = String(m.migratedAt)
  return out
}

function normalizeLoreState(raw: unknown): LoreStateEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  const fromOrder = Number(s.fromOrder)
  const content = typeof s.content === 'string' ? s.content : ''
  if (!Number.isFinite(fromOrder) || fromOrder < 1) return null
  return {
    id: typeof s.id === 'string' && s.id ? s.id : createId('lst_'),
    fromOrder: Math.floor(fromOrder),
    label: typeof s.label === 'string' ? s.label : undefined,
    content,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date().toISOString(),
  }
}

/**
 * 兼容旧设定卡：仅有 content → core；同步 content↔core。
 */
export function normalizeLoreCard(
  raw: Partial<LoreCard> & Pick<LoreCard, 'id' | 'novelId' | 'kind' | 'name'>,
): LoreCard {
  const legacyContent = typeof raw.content === 'string' ? raw.content : ''
  const coreRaw = typeof raw.core === 'string' ? raw.core : ''
  const core = (coreRaw || legacyContent).trim() ? coreRaw || legacyContent : ''
  const states = Array.isArray(raw.states)
    ? (raw.states.map(normalizeLoreState).filter(Boolean) as LoreStateEntry[]).sort(
        (a, b) => a.fromOrder - b.fromOrder || a.id.localeCompare(b.id),
      )
    : []
  return {
    id: raw.id,
    novelId: raw.novelId,
    kind: raw.kind === 'item' ? 'item' : 'character',
    name: String(raw.name || '').trim(),
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean)
      : [],
    content: core,
    core,
    states,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

/** 兼容旧快照缺失字段 */
export function normalizeLibraryEntry(
  raw: Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'novelId' | 'title'>,
): LibraryEntry {
  const sourceUrl =
    typeof raw.sourceUrl === 'string' && raw.sourceUrl.trim()
      ? raw.sourceUrl.trim()
      : undefined
  return {
    id: raw.id,
    novelId: raw.novelId,
    title: String(raw.title || '').trim(),
    content: typeof raw.content === 'string' ? raw.content : '',
    sourceUrl,
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords
          .filter((k): k is string => typeof k === 'string')
          .map((k) => k.trim())
          .filter(Boolean)
      : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

/**
 * 按章序组装「当前视角」设定正文：core + 最近生效的 state。
 */
export function assembleLoreView(
  card: LoreCard,
  asOfOrder?: number | null,
): { core: string; state: LoreStateEntry | null; text: string } {
  const normalized = normalizeLoreCard(card)
  const core = normalized.core || ''
  let state: LoreStateEntry | null = null
  if (asOfOrder != null && Number.isFinite(asOfOrder)) {
    const order = Math.floor(Number(asOfOrder))
    const eligible = normalized.states.filter((s) => s.fromOrder <= order)
    state = eligible.length ? eligible[eligible.length - 1] : null
  }
  const parts = [core.trim() ? `【本体】\n${core.trim()}` : '']
  if (state?.content?.trim()) {
    const label = state.label ? `（${state.label}）` : ''
    parts.push(`【阶段·自第${state.fromOrder}章起${label}】\n${state.content.trim()}`)
  }
  return {
    core,
    state,
    text: parts.filter(Boolean).join('\n\n') || core,
  }
}

export function createId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}
