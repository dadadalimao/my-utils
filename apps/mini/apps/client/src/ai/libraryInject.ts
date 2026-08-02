import { localRepository } from '@/repository/localRepository'
import type { LibraryEntry } from '@/types'
import type { ChatCompletionMessage } from './client'

/**
 * 按用户文本关键词匹配资料库条目（忽略大小写；同条多关键词只计一次）。
 */
export function matchLibraryEntries(novelId: string, text: string): LibraryEntry[] {
  const raw = text || ''
  if (!raw.trim()) return []
  const hay = raw.toLowerCase()
  const hits: LibraryEntry[] = []
  for (const entry of localRepository.listLibraryEntries(novelId)) {
    const keys = [entry.title, ...(entry.keywords || [])]
      .map((k) => k.trim())
      .filter(Boolean)
    const matched = keys.some((k) => hay.includes(k.toLowerCase()))
    if (matched) hits.push(entry)
  }
  return hits
}

/**
 * 将命中的资料库条目组装为 system 消息。
 */
export function buildLibraryInjectMessage(
  novelId: string,
  userText: string,
): ChatCompletionMessage | null {
  const entries = matchLibraryEntries(novelId, userText)
  if (!entries.length) return null

  const body = entries
    .map((e) => {
      const kw = e.keywords?.length ? `关键词：${e.keywords.join('、')}` : ''
      const src = e.sourceUrl ? `\n来源：${e.sourceUrl}` : ''
      return `【资料】${e.title}${kw ? `（${kw}）` : ''}${src}\n${e.content || ''}`
    })
    .join('\n\n')

  return {
    role: 'system',
    content: `以下是与用户消息关键词相关的「资料库」参考资料（原作/同人收集），写作时可引用核对，勿与本书设定、设定卡混淆：\n\n${body}`,
  }
}
