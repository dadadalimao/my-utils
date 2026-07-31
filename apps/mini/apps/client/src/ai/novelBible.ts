import { chatCompletion } from './client'
import type { Provider } from '@/types'

/** 快速插入用的分节标签（保存时 AI 会按【标签】整理排版） */
export const BIBLE_TAGS = [
  '世界观',
  '文风',
  '道具品质',
  '力量体系',
  '高潮惯例',
  '称呼习惯',
  '禁忌',
  '其他',
] as const

/**
 * 在现有正文末尾插入【标签】分节头（已有同标签则不再重复插入头）。
 */
export function insertBibleTag(text: string, tag: string): string {
  const marker = `【${tag}】`
  const base = text.replace(/\s+$/, '')
  if (base.includes(marker)) {
    return `${base}\n\n${marker}\n`
  }
  if (!base.trim()) return `${marker}\n`
  return `${base}\n\n${marker}\n`
}

/**
 * 保存前：请 AI 按【标签】分节格式化，不改变原意。
 */
export async function formatNovelBible(options: {
  text: string
  provider: Provider
  apiKey: string
  model: string
}): Promise<string> {
  const raw = options.text.trim()
  if (!raw) return ''

  const out = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    messages: [
      {
        role: 'system',
        content: [
          '你是小说设定整理助手。将用户提供的「本书通用设定」整理为清晰分节文本。',
          '格式要求：',
          '1. 每一节以【标签】独占一行开头，例如【世界观】【文风】【道具品质】【高潮惯例】等；',
          '2. 标签下行写该节正文；节与节之间空一行；',
          '3. 可用列表（- ）罗列品质、规则、符号惯例等；',
          '4. 保留用户原意与具体例子（如 ♡、品质色名），勿删关键设定；',
          '5. 不要输出解释、前言或代码围栏，只输出整理后的设定全文。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `请整理以下设定：\n\n${raw.slice(0, 12000)}`,
      },
    ],
  })
  const formatted = out.trim()
  if (!formatted) throw new Error('AI 格式化结果为空')
  return formatted
}

/**
 * AI 辅助撰写/补充本书设定（单轮，返回完整文本）。
 */
export async function assistNovelBible(options: {
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
          '你是小说世界观与文风设定助手，协助完善「本书通用设定」。',
          '输出完整设定正文（可含多节），每节以【标签】独占一行，例如【世界观】【文风】【道具品质】【高潮惯例】。',
          '在用户要求下补充、改写或扩写；保留仍有效的旧设定，勿无故删改。',
          '只输出设定正文，不要解释。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【当前设定】',
          options.current.trim() || '（空）',
          '',
          '【用户要求】',
          prompt,
        ].join('\n'),
      },
    ],
  })
  const text = out.trim()
  if (!text) throw new Error('AI 未返回设定内容')
  return text
}

/** 组装注入写作上下文的 system 消息正文 */
export function buildBibleInjectContent(bible: string): string | null {
  const t = bible.trim()
  if (!t) return null
  return [
    '【本书通用设定】以下为本书世界观、文风、规则与写作惯例，请严格遵守，勿擅自改设。',
    t.slice(0, 8000),
  ].join('\n\n')
}
