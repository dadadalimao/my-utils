import { localRepository } from '@/repository/localRepository'
import type { ChapterOutline, Provider } from '@/types'
import { normalizeOutline } from '@/types'
import { chatCompletion } from './client'

const OUTLINE_JSON_HINT = `只输出 JSON，格式：
{"summary":"2～4句剧情摘要（含起因—经过—结果）","beats":["本章关键事件1","事件2"],"characterStates":["角色A：章末状态/变化"],"hangingThreads":["未收束伏笔或悬念"],"notes":"备注（可选）"}
要求：beats 写具体事件勿空泛；characterStates 写清关键人物章末处境；hangingThreads 写后文必须接上的线。`

/**
 * 保存正文后，用 AI 更新该章大纲（保留 notes）。
 */
export async function maintainOutlineFromContent(options: {
  chapterId: string
  provider: Provider
  apiKey: string
  model: string
}): Promise<ChapterOutline | null> {
  const chapter = localRepository.getChapter(options.chapterId)
  if (!chapter || !chapter.content.trim()) return null

  const content = chapter.content.slice(0, 6000)
  const notesHint = chapter.outline.notes
    ? `\n用户备注（请保留，不要改写）：${chapter.outline.notes}`
    : ''

  const raw = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: 'system',
        content: `根据小说章节正文提炼结构化大纲，便于下一章衔接。${OUTLINE_JSON_HINT}`,
      },
      {
        role: 'user',
        content: `章节标题：${chapter.title}\n\n正文：\n${content}${notesHint}`,
      },
    ],
  })

  const parsed = parseOutlineJson(raw)
  const prev = normalizeOutline(chapter.outline)
  const outline: ChapterOutline = {
    summary: parsed.summary || prev.summary,
    beats: parsed.beats.length ? parsed.beats : prev.beats,
    characterStates: parsed.characterStates.length
      ? parsed.characterStates
      : prev.characterStates,
    hangingThreads: parsed.hangingThreads.length
      ? parsed.hangingThreads
      : prev.hangingThreads,
    notes: prev.notes,
    source: 'from_content',
    updatedAt: new Date().toISOString(),
  }
  localRepository.updateChapter(options.chapterId, { outline })
  return outline
}

/** 大纲修订结果（未落库） */
export interface OutlineReviseResult {
  summary: string
  beats: string[]
  characterStates: string[]
  hangingThreads: string[]
  /** 若 AI 未给出 notes 字段则为 undefined，调用方应保留原备注 */
  notes?: string
  raw: string
}

/**
 * 按用户提示词单轮修订大纲，返回结构化结果（不落库）。
 */
export async function reviseOutlineByPrompt(options: {
  title: string
  summary: string
  beats: string[]
  characterStates: string[]
  hangingThreads: string[]
  notes: string
  userPrompt: string
  provider: Provider
  apiKey: string
  model: string
}): Promise<OutlineReviseResult> {
  const prompt = options.userPrompt.trim()
  if (!prompt) throw new Error('请填写用户提示词')

  const listBlock = (items: string[]) =>
    items.length ? items.map((b, i) => `${i + 1}. ${b}`).join('\n') : '（无）'

  const raw = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: 'system',
        content: `你是小说策划助手。按用户要求修订本章大纲。${OUTLINE_JSON_HINT} notes 无改动时可原样回传或省略该字段。不要解释。`,
      },
      {
        role: 'user',
        content: [
          `章节标题：${options.title || '（无）'}`,
          '',
          '【当前大纲】',
          `摘要：${options.summary.trim() || '（空）'}`,
          `本章事件：\n${listBlock(options.beats)}`,
          `人物状态：\n${listBlock(options.characterStates)}`,
          `未收束线：\n${listBlock(options.hangingThreads)}`,
          `备注：${options.notes.trim() || '（空）'}`,
          '',
          '【用户要求】',
          prompt,
        ].join('\n'),
      },
    ],
  })

  const parsed = parseOutlineJson(raw)
  if (
    !parsed.summary.trim() &&
    !parsed.beats.length &&
    !parsed.characterStates.length &&
    !parsed.hangingThreads.length
  ) {
    throw new Error('AI 返回无法解析为大纲 JSON')
  }
  return {
    summary: parsed.summary,
    beats: parsed.beats,
    characterStates: parsed.characterStates,
    hangingThreads: parsed.hangingThreads,
    notes: parsed.notes,
    raw,
  }
}

function parseOutlineJson(raw: string): {
  summary: string
  beats: string[]
  characterStates: string[]
  hangingThreads: string[]
  notes?: string
} {
  const empty = {
    summary: '',
    beats: [] as string[],
    characterStates: [] as string[],
    hangingThreads: [] as string[],
  }
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { ...empty, summary: raw.slice(0, 200) }
    const obj = JSON.parse(match[0]) as {
      summary?: string
      beats?: string[]
      characterStates?: string[]
      hangingThreads?: string[]
      notes?: string
    }
    const asList = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])
    return {
      summary: String(obj.summary || ''),
      beats: asList(obj.beats),
      characterStates: asList(obj.characterStates),
      hangingThreads: asList(obj.hangingThreads),
      notes: Object.prototype.hasOwnProperty.call(obj, 'notes')
        ? String(obj.notes ?? '')
        : undefined,
    }
  } catch {
    return { ...empty, summary: raw.slice(0, 200) }
  }
}
