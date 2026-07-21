import { localRepository } from '@/repository/localRepository'
import type { OutlineRange } from '@/types'
import type { ChatCompletionMessage } from './client'

/**
 * 将选定范围大纲注入为 system 上下文（类工具，不带正文）。
 */
export function buildOutlineContextMessage(
  novelId: string,
  range: OutlineRange,
  preferSummaryOnly = false,
): ChatCompletionMessage | null {
  const items = localRepository.getOutlines(novelId, range)
  if (!items.length) return null
  const text = localRepository.serializeOutlines(items, preferSummaryOnly)
  return {
    role: 'system',
    content: `以下是当前小说的相关章节大纲（仅大纲，无正文），请结合其保持连贯：\n\n${text}`,
  }
}
