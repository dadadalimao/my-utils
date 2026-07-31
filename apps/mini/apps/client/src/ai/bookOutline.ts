import { chatCompletion } from './client'
import { localRepository } from '@/repository/localRepository'
import type { Provider } from '@/types'

/** 全书大纲注入上限 */
export const BOOK_OUTLINE_INJECT_MAX = 6000

/**
 * 组装注入写作上下文的全书大纲 system 正文。
 */
export function buildBookOutlineInjectContent(outline: string): string | null {
  const t = outline.trim()
  if (!t) return null
  return [
    '【全书剧情大纲】以下为本书总纲（幕/卷/主线），请保持方向一致，勿无故偏离或提前剧透未规划高潮；章内细节可在大纲框架内发挥。',
    t.slice(0, BOOK_OUTLINE_INJECT_MAX),
  ].join('\n\n')
}

/**
 * AI 辅助撰写/补充全书大纲（单轮）。
 */
export async function assistBookOutline(options: {
  current: string
  userPrompt: string
  provider: Provider
  apiKey: string
  model: string
}): Promise<string> {
  const prompt = options.userPrompt.trim()
  if (!prompt) throw new Error('请填写辅助要求')

  const out = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: 'system',
        content: [
          '你是小说全书大纲策划助手，协助完善「全书剧情大纲」。',
          '输出完整大纲正文，可用分幕/分卷/阶段表格或条目列出核心事件与主题。',
          '在用户要求下补充、改写或扩写；保留仍有效的旧规划，勿无故删改。',
          '只输出大纲正文，不要解释。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【当前全书大纲】',
          options.current.trim() || '（空）',
          '',
          '【用户要求】',
          prompt,
        ].join('\n'),
      },
    ],
  })
  const text = out.trim()
  if (!text) throw new Error('AI 未返回大纲内容')
  return text
}

/**
 * 根据已有章节摘要生成全书大纲初稿（迁移用）。
 */
export async function draftBookOutlineFromChapters(options: {
  novelId: string
  provider: Provider
  apiKey: string
  model: string
}): Promise<string> {
  const chapters = localRepository.listChapters(options.novelId)
  const lines = chapters.map((c) => {
    const sum = c.outline?.summary?.trim() || (c.content ? `（有正文 ${c.content.length} 字，无摘要）` : '（空）')
    return `第${c.order}章 ${c.title}：${sum}`
  })
  const catalog = lines.length ? lines.join('\n') : '（尚无章节）'

  const out = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: 'system',
        content: [
          '你是小说全书大纲策划助手。根据已有章节摘要，整理一份可继续扩写的全书剧情大纲。',
          '结构建议：核心设定总览、分幕/阶段主线、关键角色定位、未决问题。',
          '可合理推断后续走向并标注为「规划」，勿编造与已有摘要明显冲突的已发生情节。',
          '只输出大纲正文，不要解释。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `【已有章节摘要】\n${catalog.slice(0, 10000)}`,
      },
    ],
  })
  const text = out.trim()
  if (!text) throw new Error('AI 未返回大纲初稿')
  return text
}
