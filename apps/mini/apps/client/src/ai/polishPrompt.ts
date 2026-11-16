import { chatCompletion } from './client'
import type { Provider } from '@/types'

/** 用户提示词所在场景，用来约束润色方向 */
export type PromptPolishScene =
  | 'chapter'
  | 'outline'
  | 'revise'
  | 'advice'
  | 'outlineRevise'
  | 'bookAssist'
  | 'bookBatch'
  | 'bibleAssist'
  | 'loreUpdate'

const SCENE_HINT: Record<PromptPolishScene, string> = {
  chapter:
    '这是生成章节正文的需求。按新写一章整理指令；当前没有可修订的底稿，用「写什么、写到哪」的口吻，不用「请修改原文/对照底稿」。',
  outline: '这是生成或细化章节大纲的需求。',
  revise:
    '这是按底稿修订正文的修改要求。整理成改哪里、怎么改；底稿已在系统里，提示词里不必复述全文。',
  advice: '这是向小说编辑提问的咨询。',
  outlineRevise: '这是修订某一章大纲的要求。',
  bookAssist: '这是辅助撰写全书大纲的要求。',
  bookBatch: '这是一次性生成多章细纲的额外要求。',
  bibleAssist: '这是辅助撰写本书设定的要求。',
  loreUpdate: '这是按章节范围更新设定卡的额外要求。',
}

/**
 * 把作者随手写的用户提示词整理成更清楚、可执行的指令。
 * 只改提示词，不代写小说正文。
 */
export async function polishUserPrompt(options: {
  text: string
  scene: PromptPolishScene
  provider: Provider
  apiKey: string
  model: string
}): Promise<string> {
  const raw = options.text.trim()
  if (!raw) throw new Error('请先填写提示词')

  const out = await chatCompletion({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    thinkingEffort: 'off',
    timeoutMs: 60000,
    messages: [
      {
        role: 'system',
        content: [
          '你是提示词润色助手。用户会给出一段发给小说 AI 的指令。',
          SCENE_HINT[options.scene],
          '把这段指令改写成更清楚、可执行的用户提示词。',
          '保留原意、人名、玩法、尺度、禁忌与已写明的字数。',
          '含糊处补成短条目：要写什么、写到什么程度、输出什么。',
          '整理后仍是作者在下指令，不是小说正文，也不是大纲正文。',
          '只输出润色后的提示词全文。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: raw.slice(0, 8000),
      },
    ],
  })

  const polished = out
    .trim()
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
  if (!polished) throw new Error('润色结果为空')
  return polished
}
