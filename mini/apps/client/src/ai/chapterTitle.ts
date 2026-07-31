import { chatCompletion } from './client'
import type { Provider } from '@/types'

/**
 * 是否为占位章名（空、或仅「第N章」），保存时可自动 AI 生成标题。
 */
export function isPlaceholderChapterTitle(title: string, order?: number): boolean {
  const t = (title || '').trim()
  if (!t) return true
  if (/^第\s*\d+\s*章$/.test(t)) return true
  if (order != null && t === `第${order}章`) return true
  return false
}

/**
 * 根据章节正文生成简短章名（不含「第N章」前缀）。
 */
export async function generateChapterTitleFromContent(options: {
  content: string
  order?: number
  provider: Provider
  apiKey: string
  model: string
}): Promise<string> {
  const body = options.content.trim().slice(0, 4000)
  if (!body) throw new Error('正文为空，无法生成标题')

  const orderHint =
    options.order != null ? `这是第 ${options.order} 章。` : ''

  const raw = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: 'system',
        content:
          '你是网文章节标题助手。根据正文提炼一个简短章名。规则：只输出标题本身；不要带「第N章」前缀；不要引号、标点装饰或解释；10～20 字为宜，突出本章核心事件或冲突。',
      },
      {
        role: 'user',
        content: `${orderHint}\n【正文】\n${body}`,
      },
    ],
  })

  let title = raw
    .trim()
    .replace(/^["「『《]+|["」』》]+$/g, '')
    .replace(/^第\s*\d+\s*章[·\s:：\-—]*/u, '')
    .trim()
  if (!title) throw new Error('AI 未返回有效标题')
  if (title.length > 40) title = title.slice(0, 40)
  return title
}
