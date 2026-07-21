import type { ChatMode, PromptTemplate } from '@/types'

/** 未登录 / 离线时的内置提示词模板 */
export const BUILTIN_TEMPLATES: PromptTemplate[] = [
  {
    id: 'builtin-chapter',
    mode: 'chapter',
    name: '默认章节生成',
    content:
      '你是一位小说作者助手。根据用户需求和提供的章节大纲上下文，撰写连贯、可读的正文章节。只输出正文，不要解释。',
  },
  {
    id: 'builtin-outline',
    mode: 'outline',
    name: '默认大纲生成',
    content:
      '你是一位小说策划助手。根据用户需求生成或细化章节大纲。优先输出结构化要点（摘要 + 情节点），便于后续写作。',
  },
  {
    id: 'builtin-advice',
    mode: 'advice',
    name: '默认写作建议',
    content:
      '你是一位小说编辑。基于用户描述与大纲上下文，给出剧情、节奏、文风方面的具体建议，条理清晰。',
  },
]

export function builtinByMode(mode: ChatMode): PromptTemplate {
  return BUILTIN_TEMPLATES.find((t) => t.mode === mode) || BUILTIN_TEMPLATES[0]
}
