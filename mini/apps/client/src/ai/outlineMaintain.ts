import { localRepository } from '@/repository/localRepository'
import type { ChapterOutline, Provider } from '@/types'
import { chatCompletion } from './client'

/**
 * 保存正文后，用 AI 轻量更新该章大纲的 summary/beats，保留 notes。
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
        content:
          '根据小说章节正文提炼大纲。只输出 JSON，格式：{"summary":"一句话摘要","beats":["情节点1","情节点2"]}',
      },
      {
        role: 'user',
        content: `章节标题：${chapter.title}\n\n正文：\n${content}${notesHint}`,
      },
    ],
  })

  const parsed = parseOutlineJson(raw)
  const outline: ChapterOutline = {
    summary: parsed.summary || chapter.outline.summary,
    beats: parsed.beats.length ? parsed.beats : chapter.outline.beats,
    notes: chapter.outline.notes,
    source: 'from_content',
    updatedAt: new Date().toISOString(),
  }
  localRepository.updateChapter(options.chapterId, { outline })
  return outline
}

function parseOutlineJson(raw: string): { summary: string; beats: string[] } {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return { summary: raw.slice(0, 200), beats: [] }
    const obj = JSON.parse(match[0]) as { summary?: string; beats?: string[] }
    return {
      summary: String(obj.summary || ''),
      beats: Array.isArray(obj.beats) ? obj.beats.map(String) : [],
    }
  } catch {
    return { summary: raw.slice(0, 200), beats: [] }
  }
}
