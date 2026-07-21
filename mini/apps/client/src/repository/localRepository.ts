import type {
  Chapter,
  ChapterOutline,
  Novel,
  OutlineRange,
  SyncPayload,
  UserSettings,
} from '@/types'
import { createId, emptyOutline } from '@/types'
import { storageGet, storageSet } from './storage'

const KEYS = {
  novels: 'novels',
  chapters: 'chapters',
  settings: 'settings',
  currentNovelId: 'currentNovelId',
} as const

const DEFAULT_SETTINGS: UserSettings = {
  deepseekApiKey: '',
  kimiApiKey: '',
  defaultProvider: 'deepseek',
  defaultModel: 'deepseek-chat',
  autoMaintainOutline: true,
  injectOutlineByDefault: true,
  apiBaseUrl: 'http://localhost:3000',
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
    return { ...DEFAULT_SETTINGS, ...storageGet<Partial<UserSettings>>(KEYS.settings, {}) }
  },

  saveSettings(settings: UserSettings) {
    storageSet(KEYS.settings, settings)
  },

  listNovels(): Novel[] {
    return storageGet<Novel[]>(KEYS.novels, []).sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    )
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

  createNovel(title: string): Novel {
    const novel: Novel = {
      id: createId('n_'),
      title,
      updatedAt: now(),
      chapterIds: [],
    }
    const list = this.listNovels()
    list.unshift(novel)
    storageSet(KEYS.novels, list)
    this.setCurrentNovelId(novel.id)
    return novel
  },

  updateNovel(id: string, patch: Partial<Pick<Novel, 'title' | 'meta'>>) {
    const list = this.listNovels()
    const idx = list.findIndex((n) => n.id === id)
    if (idx < 0) return
    list[idx] = { ...list[idx], ...patch, updatedAt: now() }
    storageSet(KEYS.novels, list)
  },

  deleteNovel(id: string) {
    const list = this.listNovels().filter((n) => n.id !== id)
    storageSet(KEYS.novels, list)
    const chapters = this.listAllChapters().filter((c) => c.novelId !== id)
    storageSet(KEYS.chapters, chapters)
    if (this.getCurrentNovelId() === id) {
      this.setCurrentNovelId(list[0]?.id ?? null)
    }
  },

  listAllChapters(): Chapter[] {
    return storageGet<Chapter[]>(KEYS.chapters, [])
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
    all[idx] = { ...all[idx], ...patch, updatedAt: now() }
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
   */
  getOutlines(
    novelId: string,
    range: OutlineRange,
  ): { order: number; title: string; outline: ChapterOutline }[] {
    let chapters = this.listChapters(novelId)
    if (range.type === 'current' && range.currentChapterId) {
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
        const lines = [`【第${item.order}章 ${item.title}】`]
        if (item.outline.summary) lines.push(`摘要：${item.outline.summary}`)
        if (!preferSummaryOnly && item.outline.beats?.length) {
          lines.push('情节点：')
          item.outline.beats.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`))
        }
        if (!preferSummaryOnly && item.outline.notes) {
          lines.push(`备注：${item.outline.notes}`)
        }
        return lines.join('\n')
      })
      .join('\n\n')
  },

  exportSnapshot(): SyncPayload {
    return {
      version: 1,
      novels: this.listNovels(),
      chapters: this.listAllChapters(),
      settings: this.getSettings(),
      currentNovelId: this.getCurrentNovelId(),
      exportedAt: now(),
    }
  },

  importSnapshot(payload: SyncPayload) {
    storageSet(KEYS.novels, payload.novels || [])
    storageSet(KEYS.chapters, payload.chapters || [])
    if (payload.settings) {
      storageSet(KEYS.settings, { ...DEFAULT_SETTINGS, ...payload.settings })
    }
    storageSet(KEYS.currentNovelId, payload.currentNovelId ?? null)
  },
}
