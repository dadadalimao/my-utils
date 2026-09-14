/**
 * 章节正文 Markdown fence 约定：```chapter … ```（兼容 ```正文）。
 * 标记外为分析/检索说明，标记内为可落库正文。
 */

/** 推荐语言标记（提示词与解析共用） */
export const CHAPTER_FENCE_LANG = 'chapter'

/** 解析时同时接受的语言标记 */
const CHAPTER_FENCE_LANGS = ['chapter', '正文'] as const

/**
 * 写入 system / nudge：要求最终正文包在 chapter 代码块内。
 */
export function chapterOutputFormatHint(): string {
  return [
    '【正文输出格式】',
    '检索分析、修订说明、人物考据等可写在代码块外。',
    '最终完整小说正文必须包在 Markdown 代码块中，语言标记为 chapter，且整段正文只放在这一个代码块内：',
    '```chapter',
    '（完整正文）',
    '```',
    '代码块外不要再附「改动说明」等元评论；落库只取代码块内正文。',
  ].join('\n')
}

export interface ParsedChapterFence {
  /** 可展示/落库的正文 */
  body: string
  /** 标记外内容（归入思考日志） */
  preface: string
  /** 是否匹配到 fence */
  hadFence: boolean
}

/**
 * 从模型完整输出中拆出 chapter 正文与外围说明。
 * 若有多段 fence，取最后一段（通常为定稿）。
 */
export function parseChapterFence(raw: string): ParsedChapterFence {
  const text = raw || ''
  const langAlt = CHAPTER_FENCE_LANGS.map(escapeRegExp).join('|')
  const re = new RegExp('```(?:' + langAlt + ')[^\\n]*\\r?\\n([\\s\\S]*?)```', 'gi')

  let match: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((match = re.exec(text)) !== null) {
    last = match
  }

  if (!last || last.index == null) {
    return { body: text.trim(), preface: '', hadFence: false }
  }

  const body = (last[1] || '').replace(/^\r?\n/, '').replace(/\r?\n$/, '').trim()
  const end = last.index + last[0].length
  const preface = (text.slice(0, last.index) + text.slice(end)).trim()
  return { body: body || text.trim(), preface, hadFence: true }
}

/** 仅取落库正文（无 fence 时回退整段） */
export function extractChapterBody(raw: string): string {
  return parseChapterFence(raw).body
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
