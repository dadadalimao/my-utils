import { localRepository } from '@/repository/localRepository'
import type { LoreCard } from '@/types'
import type { ChatCompletionMessage } from './client'

/**
 * 按用户文本关键词匹配设定卡（忽略大小写；同卡多关键词只计一次）。
 */
export function matchLoreCards(novelId: string, text: string): LoreCard[] {
  const raw = text || ''
  if (!raw.trim()) return []
  const hay = raw.toLowerCase()
  const hits: LoreCard[] = []
  for (const card of localRepository.listLoreCards(novelId)) {
    const keys = [
      card.name,
      ...(card.keywords || []),
    ]
      .map((k) => k.trim())
      .filter(Boolean)
    const matched = keys.some((k) => hay.includes(k.toLowerCase()))
    if (matched) hits.push(card)
  }
  return hits
}

/**
 * 将命中的人物/道具卡组装为 system 消息。
 */
export function buildLoreInjectMessage(
  novelId: string,
  userText: string,
): ChatCompletionMessage | null {
  const cards = matchLoreCards(novelId, userText)
  if (!cards.length) return null
  const body = cards
    .map((c) => {
      const kindLabel = c.kind === 'character' ? '人物' : '道具'
      const kw = c.keywords?.length ? `关键词：${c.keywords.join('、')}` : ''
      return `【${kindLabel}】${c.name}${kw ? `（${kw}）` : ''}\n${c.content}`
    })
    .join('\n\n')
  return {
    role: 'system',
    content: `以下是与用户消息关键词相关的设定卡，请保持一致，勿擅自改设：\n\n${body}`,
  }
}
