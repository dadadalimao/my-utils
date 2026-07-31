import { localRepository } from '@/repository/localRepository'
import { getWritingMode, type ChatMode, type Novel, type WritingMode } from '@/types'
import { resolveWritingTarget } from './outlineInject'

export type WritingGateCode =
  | 'ok'
  | 'need_book_outline'
  | 'need_chapter'
  | 'need_chapter_outline'

export interface WritingGateResult {
  ok: boolean
  code: WritingGateCode
  message: string
  /** 引导跳转路径（相对 pages） */
  navigateTo?: string
}

export interface WritingProgressItem {
  key: 'bookOutline' | 'chapterOutline' | 'ready'
  label: string
  done: boolean
  navigateTo?: string
}

/**
 * 长篇写正文门禁：全书大纲 + 本章大纲 summary。
 * 轻量 / 非 chapter 模式一律放行。
 */
export function checkWritingGate(options: {
  novel: Novel | null | undefined
  currentChapterId?: string | null
  chatMode: ChatMode
  /** 修订模式同样需要满足长篇门禁 */
  revise?: boolean
}): WritingGateResult {
  const mode = getWritingMode(options.novel?.meta)
  if (mode !== 'long') {
    return { ok: true, code: 'ok', message: '' }
  }
  // 仅生成章节正文时门禁；大纲/建议模式放行
  if (options.chatMode !== 'chapter' && !options.revise) {
    return { ok: true, code: 'ok', message: '' }
  }

  const bookOutline = options.novel?.meta?.bookOutline?.trim()
  if (!bookOutline) {
    return {
      ok: false,
      code: 'need_book_outline',
      message: '长篇模式需先填写全书大纲，再写正文。',
      navigateTo: '/pages/book-outline/index',
    }
  }

  const novelId = options.novel!.id
  const target = resolveWritingTarget(novelId, options.currentChapterId)
  if (target.kind === 'new') {
    return {
      ok: false,
      code: 'need_chapter',
      message: '长篇模式请先创建并选中章节，写好本章大纲后再生成正文。',
      navigateTo: '/pages/chapters/index',
    }
  }

  const ch = localRepository
    .listChapters(novelId)
    .find((c) => c.order === target.order)
  const summary = ch?.outline?.summary?.trim()
  if (!summary) {
    return {
      ok: false,
      code: 'need_chapter_outline',
      message: `请先为「${target.label}」填写章节大纲摘要，再生成正文。`,
      navigateTo: ch ? `/pages/chapter-detail/index?id=${ch.id}` : '/pages/chapters/index',
    }
  }

  return { ok: true, code: 'ok', message: '' }
}

/**
 * 工作台规范进度（仅长篇展示）。
 */
export function buildWritingProgress(options: {
  novel: Novel | null | undefined
  currentChapterId?: string | null
}): WritingProgressItem[] | null {
  if (getWritingMode(options.novel?.meta) !== 'long' || !options.novel) return null

  const bookDone = !!options.novel.meta?.bookOutline?.trim()
  const target = resolveWritingTarget(options.novel.id, options.currentChapterId)
  let chapterDone = false
  let chapterNav = '/pages/chapters/index'
  if (target.kind !== 'new') {
    const ch = localRepository
      .listChapters(options.novel.id)
      .find((c) => c.order === target.order)
    chapterDone = !!ch?.outline?.summary?.trim()
    if (ch) chapterNav = `/pages/chapter-detail/index?id=${ch.id}`
  }

  const ready = bookDone && chapterDone
  return [
    {
      key: 'bookOutline',
      label: '全书大纲',
      done: bookDone,
      navigateTo: '/pages/book-outline/index',
    },
    {
      key: 'chapterOutline',
      label: target.kind === 'new' ? '本章大纲（请先建章）' : `本章大纲（${target.label}）`,
      done: chapterDone,
      navigateTo: chapterNav,
    },
    {
      key: 'ready',
      label: '可写正文',
      done: ready,
    },
  ]
}

export function writingModeLabel(mode: WritingMode): string {
  return mode === 'long' ? '长篇规范' : '轻量短篇'
}
