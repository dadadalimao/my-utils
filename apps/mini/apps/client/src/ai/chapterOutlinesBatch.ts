import { chatWithNovelTools, toolsSystemHint } from './tools'
import { parseOutlineJson } from './outlineMaintain'
import { localRepository } from '@/repository/localRepository'
import { isPlaceholderChapterTitle } from './chapterTitle'
import type { ChapterOutline, Provider } from '@/types'

/** 单次最多生成章数，避免上下文与超时撑爆 */
export const MAX_BATCH_CHAPTER_OUTLINES = 12

/** 推荐语言标记（提示词与解析共用） */
export const CHAPTER_OUTLINES_FENCE_LANG = 'outlines'

export interface ChapterOutlineDraft {
  order: number
  title: string
  summary: string
  beats: string[]
  characterStates: string[]
  hangingThreads: string[]
  notes: string
}

/**
 * 写入 system / nudge：要求最终多章大纲包在 outlines JSON 代码块内。
 */
export function chapterOutlinesFormatHint(fromOrder: number, toOrder: number): string {
  return [
    '【多章大纲输出格式】',
    `必须覆盖第 ${fromOrder}–${toOrder} 章（每章一条，order 连续、勿跳号）。`,
    '检索分析可写在代码块外。最终结果必须包在 Markdown 代码块中，语言标记为 outlines，内容为 JSON 数组：',
    '```outlines',
    '[',
    '  {"order":1,"title":"章标题（不含第N章前缀亦可）","summary":"2～4句摘要（起因—经过—结果）","beats":["关键事件1","事件2"],"characterStates":["角色A：章末状态"],"hangingThreads":["未收束伏笔"],"notes":""}',
    ']',
    '```',
    '不要输出正文；不要元评论。落库只取该数组。',
  ].join('\n')
}

/**
 * 从模型完整输出中解析多章大纲草稿。
 */
export function parseChapterOutlineDrafts(raw: string): ChapterOutlineDraft[] {
  const text = raw || ''
  const fenced = extractOutlinesFence(text)
  const body = fenced || text
  const items = extractJsonItems(body)
  const drafts: ChapterOutlineDraft[] = []
  for (const item of items) {
    const draft = normalizeDraftItem(item)
    if (draft) drafts.push(draft)
  }
  drafts.sort((a, b) => a.order - b.order)
  return drafts
}

/**
 * 预览用纯文本（采用弹层 / toast 对照）。
 */
export function formatChapterOutlineDrafts(drafts: ChapterOutlineDraft[]): string {
  if (!drafts.length) return '（空）'
  return drafts
    .map((d) => {
      const lines = [
        `第${d.order}章 ${d.title || '（无标题）'}`,
        `摘要：${d.summary || '（空）'}`,
      ]
      if (d.beats.length) lines.push(`事件：\n${d.beats.map((b) => `- ${b}`).join('\n')}`)
      if (d.characterStates.length) {
        lines.push(`人物：\n${d.characterStates.map((b) => `- ${b}`).join('\n')}`)
      }
      if (d.hangingThreads.length) {
        lines.push(`伏笔：\n${d.hangingThreads.map((b) => `- ${b}`).join('\n')}`)
      }
      if (d.notes.trim()) lines.push(`备注：${d.notes.trim()}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

/**
 * 一次性生成多章结构化大纲（可调用工具查阅全书大纲、已有章纲、设定等）。
 */
export async function generateChapterOutlines(options: {
  novelId: string
  fromOrder: number
  toOrder: number
  userPrompt: string
  bookOutline: string
  provider: Provider
  apiKey: string
  model: string
  thinkingEffort?: import('@/types').ThinkingEffort
}): Promise<ChapterOutlineDraft[]> {
  const fromOrder = Math.floor(Number(options.fromOrder))
  const toOrder = Math.floor(Number(options.toOrder))
  validateBatchRange(fromOrder, toOrder)

  const chapters = localRepository.listChapters(options.novelId)
  const catalog = chapters.length
    ? chapters
        .map((c) => {
          const sum = c.outline?.summary?.trim() || '（无摘要）'
          return `第${c.order}章 ${c.title}：${sum}`
        })
        .join('\n')
    : '（尚无章节）'

  const prompt = options.userPrompt.trim() || '请根据全书大纲撰写指定章节的细纲，章间衔接清楚。'
  const formatHint = chapterOutlinesFormatHint(fromOrder, toOrder)

  const text = await chatWithNovelTools({
    novelId: options.novelId,
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    thinkingEffort: options.thinkingEffort,
    defaultAsOfOrder: fromOrder,
    acceptEarly: (text) => parseChapterOutlineDrafts(text).length > 0,
    finalNudge: `请基于已有信息直接输出第 ${fromOrder}–${toOrder} 章大纲 JSON，勿再调用工具。\n${formatHint}`,
    messages: [
      {
        role: 'system',
        content: [
          '你是小说策划助手，任务是一次性规划多章结构化大纲，便于后续写成正文。',
          '每一章须有清晰目标：本章解决什么、激化什么、留下什么；章与章之间情节衔接、人物状态连续。',
          '需要对照全书大纲、已有章纲、本书设定或设定卡时请调用工具，勿臆造已发生情节。',
          '已有章若已有摘要：可细化，但勿无故推翻；空章则按全书大纲新写。',
          toolsSystemHint(),
          formatHint,
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `【目标范围】第 ${fromOrder}–${toOrder} 章（共 ${toOrder - fromOrder + 1} 章）`,
          '',
          '【全书大纲】',
          options.bookOutline.trim() || '（空）',
          '',
          '【已有章节摘要】',
          catalog.slice(0, 8000),
          '',
          '【用户要求】',
          prompt,
        ].join('\n'),
      },
    ],
  })
  if (!text) throw new Error('AI 未返回章纲')

  const drafts = parseChapterOutlineDrafts(text).filter(
    (d) => d.order >= fromOrder && d.order <= toOrder,
  )
  if (!drafts.length) throw new Error('AI 返回无法解析为多章大纲')
  return drafts
}

/**
 * 草稿转可落库章纲；已有备注默认保留（AI notes 非空则采用）。
 */
export function draftToChapterOutline(
  draft: ChapterOutlineDraft,
  prevNotes?: string,
): ChapterOutline {
  return {
    summary: draft.summary,
    beats: draft.beats,
    characterStates: draft.characterStates,
    hangingThreads: draft.hangingThreads,
    notes: draft.notes.trim() ? draft.notes : prevNotes || '',
    source: 'from_chat',
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 已有章为占位名时采用 AI 标题，否则保留原标题。
 */
export function resolveAdoptTitle(
  order: number,
  currentTitle: string | undefined,
  draftTitle: string,
): string | undefined {
  const next = (draftTitle || '').trim()
  if (!next) return undefined
  if (!currentTitle || isPlaceholderChapterTitle(currentTitle, order)) return next
  return undefined
}

function validateBatchRange(fromOrder: number, toOrder: number) {
  if (!Number.isFinite(fromOrder) || !Number.isFinite(toOrder)) {
    throw new Error('请填写有效的起止章序')
  }
  if (fromOrder < 1 || toOrder < fromOrder) {
    throw new Error('章序范围无效')
  }
  if (toOrder - fromOrder + 1 > MAX_BATCH_CHAPTER_OUTLINES) {
    throw new Error(`单次最多生成 ${MAX_BATCH_CHAPTER_OUTLINES} 章大纲`)
  }
}

function extractOutlinesFence(text: string): string | null {
  const re = /```(?:outlines|json)[^\n]*\r?\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  let last: string | null = null
  while ((match = re.exec(text)) !== null) {
    last = (match[1] || '').trim()
  }
  return last
}

function extractJsonItems(body: string): unknown[] {
  const trimmed = body.trim()
  try {
    const parsed = JSON.parse(trimmed) as unknown
    const items = asItemArray(parsed)
    if (items) return items
  } catch {
    /* 再截取数组片段 */
  }
  const arrMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0]) as unknown
      const items = asItemArray(parsed)
      if (items) return items
    } catch {
      /* ignore */
    }
  }
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as unknown
      const items = asItemArray(parsed)
      if (items) return items
    } catch {
      /* ignore */
    }
  }
  return []
}

function asItemArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.chapters)) return obj.chapters
    if (Array.isArray(obj.outlines)) return obj.outlines
    if (typeof obj.order === 'number' || typeof obj.summary === 'string') return [obj]
  }
  return null
}

function normalizeDraftItem(item: unknown): ChapterOutlineDraft | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const order = Math.floor(Number(obj.order ?? obj.chapter ?? obj.index))
  if (!Number.isFinite(order) || order < 1) return null
  const parsed = parseOutlineJson(JSON.stringify(obj))
  const title = String(obj.title || obj.name || '').trim()
  if (!parsed.summary.trim() && !parsed.beats.length && !title) return null
  return {
    order,
    title,
    summary: parsed.summary,
    beats: parsed.beats,
    characterStates: parsed.characterStates,
    hangingThreads: parsed.hangingThreads,
    notes: parsed.notes ?? '',
  }
}
