import type {
  Chapter,
  ChapterOutline,
  LoreCard,
  LoreCardKind,
  Novel,
  NovelMeta,
  OutlineRange,
  PromptTemplate,
  SyncPayload,
  UserSettings,
  WritingMode,
} from '@/types'
import {
  createId,
  emptyOutline,
  normalizeLoreCard,
  normalizeNovelMeta,
  normalizeOutline,
} from '@/types'
import { storageGet, storageSet } from './storage'

const KEYS = {
  novels: 'novels',
  chapters: 'chapters',
  loreCards: 'loreCards',
  settings: 'settings',
  currentNovelId: 'currentNovelId',
  /** 登录后从后端拉取的提示词缓存（登出后仍可读） */
  promptTemplates: 'promptTemplates',
  selectedTemplateId: 'selectedTemplateId',
} as const

const DEFAULT_SETTINGS: UserSettings = {
  deepseekApiKey: '',
  kimiApiKey: '',
  defaultProvider: 'deepseek',
  defaultModel: 'deepseek-v4-flash',
  autoMaintainOutline: true,
  injectOutlineByDefault: true,
  injectLoreByKeyword: true,
  apiBaseUrl: 'http://localhost:3000',
}

/** DeepSeek 旧模型名 → V4（2026-07-24 起旧名不可用） */
const LEGACY_DEEPSEEK_MODELS: Record<string, string> = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
}

function now() {
  return new Date().toISOString()
}

/**
 * 本地小说/章节仓储（uni.setStorage）。
 * getOutlines 仅序列化 outline，不扫描 content。
 */
export const localRepository = {
  getSettings(): UserSettings {
    const settings = { ...DEFAULT_SETTINGS, ...storageGet<Partial<UserSettings>>(KEYS.settings, {}) }
    const migrated = LEGACY_DEEPSEEK_MODELS[settings.defaultModel]
    if (migrated) {
      settings.defaultModel = migrated
      storageSet(KEYS.settings, settings)
    }
    return settings
  },

  saveSettings(settings: UserSettings) {
    storageSet(KEYS.settings, settings)
  },

  /** 读取已缓存的云端提示词；从未拉取过则返回 null */
  getCachedPromptTemplates(): PromptTemplate[] | null {
    const list = storageGet<PromptTemplate[] | null>(KEYS.promptTemplates, null)
    return list?.length ? list : null
  },

  saveCachedPromptTemplates(list: PromptTemplate[]) {
    storageSet(KEYS.promptTemplates, list)
  },

  getSelectedTemplateId(): string {
    return storageGet<string>(KEYS.selectedTemplateId, '')
  },

  saveSelectedTemplateId(id: string) {
    storageSet(KEYS.selectedTemplateId, id)
  },

  listNovels(): Novel[] {
    return storageGet<Novel[]>(KEYS.novels, [])
      .map((n) => ({
        ...n,
        meta: n.meta ? normalizeNovelMeta(n.meta) : undefined,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  getNovel(id: string): Novel | undefined {
    return this.listNovels().find((n) => n.id === id)
  },

  getCurrentNovelId(): string | null {
    return storageGet<string | null>(KEYS.currentNovelId, null)
  },

  setCurrentNovelId(id: string | null) {
    storageSet(KEYS.currentNovelId, id)
  },

  /**
   * @param options.writingMode 默认 light
   * @param options.targetWords 长篇预计字数
   */
  createNovel(
    title: string,
    options?: { writingMode?: WritingMode; targetWords?: number },
  ): Novel {
    const writingMode = options?.writingMode === 'long' ? 'long' : 'light'
    const meta: NovelMeta = normalizeNovelMeta({
      writingMode,
      ...(options?.targetWords != null ? { targetWords: options.targetWords } : {}),
    })
    const novel: Novel = {
      id: createId('n_'),
      title,
      meta,
      updatedAt: now(),
      chapterIds: [],
    }
    const list = storageGet<Novel[]>(KEYS.novels, [])
    list.unshift(novel)
    storageSet(KEYS.novels, list)
    this.setCurrentNovelId(novel.id)
    return novel
  },

  updateNovel(id: string, patch: Partial<Pick<Novel, 'title' | 'meta'>>) {
    const list = storageGet<Novel[]>(KEYS.novels, [])
    const idx = list.findIndex((n) => n.id === id)
    if (idx < 0) return
    const prev = list[idx]
    const nextMeta =
      patch.meta !== undefined
        ? normalizeNovelMeta({ ...(prev.meta || {}), ...patch.meta })
        : prev.meta
    list[idx] = {
      ...prev,
      ...patch,
      meta: nextMeta,
      updatedAt: now(),
    }
    storageSet(KEYS.novels, list)
  },

  deleteNovel(id: string) {
    const list = this.listNovels().filter((n) => n.id !== id)
    storageSet(KEYS.novels, list)
    const chapters = this.listAllChapters().filter((c) => c.novelId !== id)
    storageSet(KEYS.chapters, chapters)
    storageSet(
      KEYS.loreCards,
      this.listAllLoreCards().filter((c) => c.novelId !== id),
    )
    if (this.getCurrentNovelId() === id) {
      this.setCurrentNovelId(list[0]?.id ?? null)
    }
  },

  listAllChapters(): Chapter[] {
    return storageGet<Chapter[]>(KEYS.chapters, []).map((c) => ({
      ...c,
      outline: normalizeOutline(c.outline),
    }))
  },

  listChapters(novelId: string): Chapter[] {
    return this.listAllChapters()
      .filter((c) => c.novelId === novelId)
      .sort((a, b) => a.order - b.order)
  },

  getChapter(id: string): Chapter | undefined {
    return this.listAllChapters().find((c) => c.id === id)
  },

  createChapter(novelId: string, title: string): Chapter {
    const existing = this.listChapters(novelId)
    const chapter: Chapter = {
      id: createId('c_'),
      novelId,
      title,
      order: existing.length ? existing[existing.length - 1].order + 1 : 1,
      content: '',
      outline: emptyOutline(),
      updatedAt: now(),
    }
    const all = this.listAllChapters()
    all.push(chapter)
    storageSet(KEYS.chapters, all)
    const novel = this.getNovel(novelId)
    if (novel) {
      this.updateNovel(novelId, {})
      const list = this.listNovels()
      const n = list.find((x) => x.id === novelId)!
      n.chapterIds = [...n.chapterIds, chapter.id]
      n.updatedAt = now()
      storageSet(KEYS.novels, list)
    }
    return chapter
  },

  updateChapter(
    id: string,
    patch: Partial<Pick<Chapter, 'title' | 'content' | 'outline' | 'order'>>,
  ) {
    const all = this.listAllChapters()
    const idx = all.findIndex((c) => c.id === id)
    if (idx < 0) return
    const next = { ...all[idx], ...patch, updatedAt: now() }
    if (patch.outline) next.outline = normalizeOutline(patch.outline)
    all[idx] = next
    storageSet(KEYS.chapters, all)
    this.updateNovel(all[idx].novelId, {})
  },

  deleteChapter(id: string) {
    const ch = this.getChapter(id)
    if (!ch) return
    storageSet(
      KEYS.chapters,
      this.listAllChapters().filter((c) => c.id !== id),
    )
    const list = this.listNovels()
    const n = list.find((x) => x.id === ch.novelId)
    if (n) {
      n.chapterIds = n.chapterIds.filter((cid) => cid !== id)
      n.updatedAt = now()
      storageSet(KEYS.novels, list)
    }
  },

  /**
   * 按范围提取大纲（仅 outline 字段）。
   * continuity 类型请走 outlineInject.buildContinuityContextMessage，此处不处理。
   */
  getOutlines(
    novelId: string,
    range: OutlineRange,
  ): { order: number; title: string; outline: ChapterOutline }[] {
    let chapters = this.listChapters(novelId)
    if (range.type === 'continuity') {
      // 衔接模式由注入层组装，这里退化为「当前章之前全部」大纲
      const cur = range.currentChapterId
        ? chapters.find((c) => c.id === range.currentChapterId)
        : undefined
      const anchor = cur?.order ?? Number.MAX_SAFE_INTEGER
      chapters = chapters.filter((c) => c.order < anchor)
    } else if (range.type === 'current' && range.currentChapterId) {
      chapters = chapters.filter((c) => c.id === range.currentChapterId)
    } else if (range.type === 'range') {
      const from = range.fromOrder ?? 1
      const to = range.toOrder ?? Number.MAX_SAFE_INTEGER
      chapters = chapters.filter((c) => c.order >= from && c.order <= to)
    }
    return chapters.map((c) => ({
      order: c.order,
      title: c.title,
      outline: c.outline,
    }))
  },

  /** 序列化为投喂 AI 的纯文本 */
  serializeOutlines(
    items: { order: number; title: string; outline: ChapterOutline }[],
    preferSummaryOnly = false,
  ): string {
    if (!items.length) return '（暂无大纲）'
    return items
      .map((item) => {
        const o = normalizeOutline(item.outline)
        const lines = [`【第${item.order}章 ${item.title}】`]
        if (o.summary) lines.push(`摘要：${o.summary}`)
        if (!preferSummaryOnly && o.beats?.length) {
          lines.push('本章事件：')
          o.beats.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`))
        }
        if (!preferSummaryOnly && o.characterStates?.length) {
          lines.push('人物状态：')
          o.characterStates.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
        }
        // 未收束线对衔接很重要：摘要模式下也带上
        if (o.hangingThreads?.length) {
          lines.push('未收束线：')
          o.hangingThreads.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
        }
        if (!preferSummaryOnly && o.notes) {
          lines.push(`备注：${o.notes}`)
        }
        return lines.join('\n')
      })
      .join('\n\n')
  },

  // —— 人物 / 道具设定卡 ——

  listAllLoreCards(): LoreCard[] {
    return storageGet<Partial<LoreCard>[]>(KEYS.loreCards, [])
      .filter((c) => c && c.id && c.novelId && c.name)
      .map((c) =>
        normalizeLoreCard(
          c as Partial<LoreCard> & Pick<LoreCard, 'id' | 'novelId' | 'kind' | 'name'>,
        ),
      )
  },

  listLoreCards(novelId: string, kind?: LoreCardKind): LoreCard[] {
    return this.listAllLoreCards()
      .filter((c) => c.novelId === novelId && (!kind || c.kind === kind))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  },

  getLoreCard(id: string): LoreCard | undefined {
    return this.listAllLoreCards().find((c) => c.id === id)
  },

  /**
   * 按 id 或名称/关键词查找设定卡（同小说内）。
   */
  findLoreCard(
    novelId: string,
    query: { id?: string; name?: string },
  ): LoreCard | undefined {
    const all = this.listLoreCards(novelId)
    if (query.id) {
      const byId = all.find((c) => c.id === query.id)
      if (byId) return byId
    }
    const name = query.name?.trim()
    if (!name) return undefined
    const lower = name.toLowerCase()
    return (
      all.find((c) => c.name.toLowerCase() === lower) ||
      all.find((c) => c.keywords.some((k) => k.trim().toLowerCase() === lower)) ||
      all.find((c) => c.name.toLowerCase().includes(lower))
    )
  },

  saveLoreCard(
    card: Omit<LoreCard, 'id' | 'updatedAt' | 'content' | 'core' | 'states'> & {
      id?: string
      content?: string
      core?: string
      states?: LoreCard['states']
    },
  ): LoreCard {
    const all = this.listAllLoreCards()
    const id = card.id || createId('lore_')
    const existing = all.find((c) => c.id === id)
    const coreInput =
      card.core !== undefined
        ? card.core
        : card.content !== undefined
          ? card.content
          : existing?.core || existing?.content || ''
    const next = normalizeLoreCard({
      id,
      novelId: card.novelId,
      kind: card.kind,
      name: card.name.trim(),
      keywords: (card.keywords || []).map((k) => k.trim()).filter(Boolean),
      content: coreInput,
      core: coreInput,
      states: card.states !== undefined ? card.states : existing?.states || [],
      updatedAt: now(),
    })
    const idx = all.findIndex((c) => c.id === id)
    if (idx >= 0) all[idx] = next
    else all.push(next)
    storageSet(KEYS.loreCards, all)
    return next
  },

  deleteLoreCard(id: string) {
    storageSet(
      KEYS.loreCards,
      this.listAllLoreCards().filter((c) => c.id !== id),
    )
  },

  exportSnapshot(): SyncPayload {
    return {
      version: 1,
      novels: this.listNovels(),
      chapters: this.listAllChapters(),
      loreCards: this.listAllLoreCards(),
      settings: this.getSettings(),
      currentNovelId: this.getCurrentNovelId(),
      exportedAt: now(),
    }
  },

  importSnapshot(payload: SyncPayload) {
    storageSet(
      KEYS.novels,
      (payload.novels || []).map((n) => ({
        ...n,
        meta: n.meta ? normalizeNovelMeta(n.meta) : undefined,
      })),
    )
    storageSet(
      KEYS.chapters,
      (payload.chapters || []).map((c) => ({
        ...c,
        outline: normalizeOutline(c.outline),
      })),
    )
    storageSet(
      KEYS.loreCards,
      (payload.loreCards || [])
        .filter((c) => c && c.id && c.novelId && c.name)
        .map((c) =>
          normalizeLoreCard(
            c as Partial<LoreCard> & Pick<LoreCard, 'id' | 'novelId' | 'kind' | 'name'>,
          ),
        ),
    )
    if (payload.settings) {
      storageSet(KEYS.settings, { ...DEFAULT_SETTINGS, ...payload.settings })
    }
    storageSet(KEYS.currentNovelId, payload.currentNovelId ?? null)
  },
}
