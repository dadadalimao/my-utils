import type {
  Chapter,
  ChapterOutline,
  LibraryEntry,
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
  normalizeLibraryEntry,
  normalizeLoreCard,
  normalizeNovelMeta,
  normalizeOutline,
} from '@/types'
import { storageGet, storageRemove, storageSet } from './storage'

const KEYS = {
  novels: 'novels',
  chapterIndex: 'chapterIndex',
  loreIndex: 'loreIndex',
  libraryIndex: 'libraryIndex',
  /** @deprecated 仅迁移识别，运行时不再写入 */
  chaptersLegacy: 'chapters',
  loreLegacy: 'loreCards',
  libraryLegacy: 'libraryEntries',
  settings: 'settings',
  currentNovelId: 'currentNovelId',
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
  injectLibraryByKeyword: true,
  enableDeepseekWebSearch: false,
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

function chapterKey(id: string) {
  return `chapter:${id}`
}

function loreKey(id: string) {
  return `lore:${id}`
}

function libraryKey(id: string) {
  return `library:${id}`
}

function readIdIndex(indexKey: string): string[] {
  const ids = storageGet<string[]>(indexKey, [])
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : []
}

function writeIdIndex(indexKey: string, ids: string[]) {
  storageSet(indexKey, ids)
}

/**
 * 本地小说/章节仓储（内存 + 平台大容量后端）。
 * chapters / lore / library 按实体拆键，避免整包读写触顶。
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

    const chapterIds = readIdIndex(KEYS.chapterIndex)
    const keepChapterIds: string[] = []
    for (const cid of chapterIds) {
      const ch = storageGet<Chapter | null>(chapterKey(cid), null)
      if (ch?.novelId === id) {
        storageRemove(chapterKey(cid))
      } else if (ch) {
        keepChapterIds.push(cid)
      } else {
        storageRemove(chapterKey(cid))
      }
    }
    writeIdIndex(KEYS.chapterIndex, keepChapterIds)

    const loreIds = readIdIndex(KEYS.loreIndex)
    const keepLore: string[] = []
    for (const lid of loreIds) {
      const card = storageGet<LoreCard | null>(loreKey(lid), null)
      if (card?.novelId === id) {
        storageRemove(loreKey(lid))
      } else if (card) {
        keepLore.push(lid)
      } else {
        storageRemove(loreKey(lid))
      }
    }
    writeIdIndex(KEYS.loreIndex, keepLore)

    const libIds = readIdIndex(KEYS.libraryIndex)
    const keepLib: string[] = []
    for (const eid of libIds) {
      const entry = storageGet<LibraryEntry | null>(libraryKey(eid), null)
      if (entry?.novelId === id) {
        storageRemove(libraryKey(eid))
      } else if (entry) {
        keepLib.push(eid)
      } else {
        storageRemove(libraryKey(eid))
      }
    }
    writeIdIndex(KEYS.libraryIndex, keepLib)

    if (this.getCurrentNovelId() === id) {
      this.setCurrentNovelId(list[0]?.id ?? null)
    }
  },

  listAllChapters(): Chapter[] {
    const ids = readIdIndex(KEYS.chapterIndex)
    const list: Chapter[] = []
    for (const id of ids) {
      const c = storageGet<Chapter | null>(chapterKey(id), null)
      if (!c?.id) continue
      list.push({ ...c, outline: normalizeOutline(c.outline) })
    }
    return list
  },

  listChapters(novelId: string): Chapter[] {
    return this.listAllChapters()
      .filter((c) => c.novelId === novelId)
      .sort((a, b) => a.order - b.order)
  },

  getChapter(id: string): Chapter | undefined {
    const c = storageGet<Chapter | null>(chapterKey(id), null)
    if (!c?.id) return undefined
    return { ...c, outline: normalizeOutline(c.outline) }
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
    storageSet(chapterKey(chapter.id), chapter)
    const ids = readIdIndex(KEYS.chapterIndex)
    if (!ids.includes(chapter.id)) {
      ids.push(chapter.id)
      writeIdIndex(KEYS.chapterIndex, ids)
    }
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
    const prev = this.getChapter(id)
    if (!prev) return
    const next = { ...prev, ...patch, updatedAt: now() }
    if (patch.outline) next.outline = normalizeOutline(patch.outline)
    storageSet(chapterKey(id), next)
    this.updateNovel(next.novelId, {})
  },

  deleteChapter(id: string) {
    const ch = this.getChapter(id)
    if (!ch) return
    storageRemove(chapterKey(id))
    writeIdIndex(
      KEYS.chapterIndex,
      readIdIndex(KEYS.chapterIndex).filter((cid) => cid !== id),
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
    const ids = readIdIndex(KEYS.loreIndex)
    const list: LoreCard[] = []
    for (const id of ids) {
      const raw = storageGet<Partial<LoreCard> | null>(loreKey(id), null)
      if (!raw?.id || !raw.novelId || !raw.name) continue
      list.push(
        normalizeLoreCard(
          raw as Partial<LoreCard> & Pick<LoreCard, 'id' | 'novelId' | 'kind' | 'name'>,
        ),
      )
    }
    return list
  },

  listLoreCards(novelId: string, kind?: LoreCardKind): LoreCard[] {
    return this.listAllLoreCards()
      .filter((c) => c.novelId === novelId && (!kind || c.kind === kind))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  },

  getLoreCard(id: string): LoreCard | undefined {
    const raw = storageGet<Partial<LoreCard> | null>(loreKey(id), null)
    if (!raw?.id || !raw.novelId || !raw.name) return undefined
    return normalizeLoreCard(
      raw as Partial<LoreCard> & Pick<LoreCard, 'id' | 'novelId' | 'kind' | 'name'>,
    )
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
    const id = card.id || createId('lore_')
    const existing = this.getLoreCard(id)
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
    storageSet(loreKey(id), next)
    const ids = readIdIndex(KEYS.loreIndex)
    if (!ids.includes(id)) {
      ids.push(id)
      writeIdIndex(KEYS.loreIndex, ids)
    }
    return next
  },

  deleteLoreCard(id: string) {
    storageRemove(loreKey(id))
    writeIdIndex(
      KEYS.loreIndex,
      readIdIndex(KEYS.loreIndex).filter((x) => x !== id),
    )
  },

  // —— 资料库（同人/原作参考资料）——

  listAllLibraryEntries(): LibraryEntry[] {
    const ids = readIdIndex(KEYS.libraryIndex)
    const list: LibraryEntry[] = []
    for (const id of ids) {
      const raw = storageGet<Partial<LibraryEntry> | null>(libraryKey(id), null)
      if (!raw?.id || !raw.novelId || !raw.title) continue
      list.push(
        normalizeLibraryEntry(
          raw as Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'novelId' | 'title'>,
        ),
      )
    }
    return list
  },

  listLibraryEntries(novelId: string): LibraryEntry[] {
    return this.listAllLibraryEntries()
      .filter((e) => e.novelId === novelId)
      .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  },

  getLibraryEntry(id: string): LibraryEntry | undefined {
    const raw = storageGet<Partial<LibraryEntry> | null>(libraryKey(id), null)
    if (!raw?.id || !raw.novelId || !raw.title) return undefined
    return normalizeLibraryEntry(
      raw as Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'novelId' | 'title'>,
    )
  },

  /**
   * 按 id 或标题/关键词查找资料库条目（同小说内）。
   */
  findLibraryEntry(
    novelId: string,
    query: { id?: string; name?: string },
  ): LibraryEntry | undefined {
    const all = this.listLibraryEntries(novelId)
    if (query.id) {
      const byId = all.find((e) => e.id === query.id)
      if (byId) return byId
    }
    const name = query.name?.trim()
    if (!name) return undefined
    const lower = name.toLowerCase()
    return (
      all.find((e) => e.title.toLowerCase() === lower) ||
      all.find((e) => e.keywords.some((k) => k.trim().toLowerCase() === lower)) ||
      all.find((e) => e.title.toLowerCase().includes(lower))
    )
  },

  saveLibraryEntry(
    entry: Omit<LibraryEntry, 'id' | 'updatedAt'> & { id?: string },
  ): LibraryEntry {
    const id = entry.id || createId('lib_')
    const next = normalizeLibraryEntry({
      id,
      novelId: entry.novelId,
      title: entry.title.trim(),
      content: entry.content || '',
      sourceUrl: entry.sourceUrl,
      keywords: (entry.keywords || []).map((k) => k.trim()).filter(Boolean),
      updatedAt: now(),
    })
    storageSet(libraryKey(id), next)
    const ids = readIdIndex(KEYS.libraryIndex)
    if (!ids.includes(id)) {
      ids.push(id)
      writeIdIndex(KEYS.libraryIndex, ids)
    }
    return next
  },

  deleteLibraryEntry(id: string) {
    storageRemove(libraryKey(id))
    writeIdIndex(
      KEYS.libraryIndex,
      readIdIndex(KEYS.libraryIndex).filter((x) => x !== id),
    )
  },

  exportSnapshot(): SyncPayload {
    return {
      version: 1,
      novels: this.listNovels(),
      chapters: this.listAllChapters(),
      loreCards: this.listAllLoreCards(),
      libraryEntries: this.listAllLibraryEntries(),
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

    // 清空旧实体再写入，避免残留
    for (const id of readIdIndex(KEYS.chapterIndex)) storageRemove(chapterKey(id))
    for (const id of readIdIndex(KEYS.loreIndex)) storageRemove(loreKey(id))
    for (const id of readIdIndex(KEYS.libraryIndex)) storageRemove(libraryKey(id))

    const chapters = (payload.chapters || []).map((c) => ({
      ...c,
      outline: normalizeOutline(c.outline),
    }))
    const chapterIds: string[] = []
    for (const c of chapters) {
      if (!c?.id) continue
      storageSet(chapterKey(c.id), c)
      chapterIds.push(c.id)
    }
    writeIdIndex(KEYS.chapterIndex, chapterIds)
    storageRemove(KEYS.chaptersLegacy)

    const loreCards = (payload.loreCards || [])
      .filter((c) => c && c.id && c.novelId && c.name)
      .map((c) =>
        normalizeLoreCard(
          c as Partial<LoreCard> & Pick<LoreCard, 'id' | 'novelId' | 'kind' | 'name'>,
        ),
      )
    const loreIds: string[] = []
    for (const c of loreCards) {
      storageSet(loreKey(c.id), c)
      loreIds.push(c.id)
    }
    writeIdIndex(KEYS.loreIndex, loreIds)
    storageRemove(KEYS.loreLegacy)

    const libraryEntries = (payload.libraryEntries || [])
      .filter((e) => e && e.id && e.novelId && e.title)
      .map((e) =>
        normalizeLibraryEntry(
          e as Partial<LibraryEntry> & Pick<LibraryEntry, 'id' | 'novelId' | 'title'>,
        ),
      )
    const libIds: string[] = []
    for (const e of libraryEntries) {
      storageSet(libraryKey(e.id), e)
      libIds.push(e.id)
    }
    writeIdIndex(KEYS.libraryIndex, libIds)
    storageRemove(KEYS.libraryLegacy)

    if (payload.settings) {
      storageSet(KEYS.settings, { ...DEFAULT_SETTINGS, ...payload.settings })
    }
    storageSet(KEYS.currentNovelId, payload.currentNovelId ?? null)
  },
}
