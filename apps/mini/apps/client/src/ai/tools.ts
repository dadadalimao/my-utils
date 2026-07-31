import { localRepository } from '@/repository/localRepository'

/** OpenAI 兼容 tool 定义 */
export const NOVEL_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_chapters',
      description: '列出当前小说全部章节（章序、标题、是否有正文、大纲摘要）',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_chapter_outline',
      description: '按章序获取章节大纲（摘要、情节点、备注）',
      parameters: {
        type: 'object',
        properties: {
          order: { type: 'number', description: '章节序号（从 1 开始）' },
        },
        required: ['order'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_chapter_content',
      description:
        '按章序获取章节正文。可选按字数截取；默认不限制长度。若截取，默认取尾部（章末），也可取开头。',
      parameters: {
        type: 'object',
        properties: {
          order: { type: 'number', description: '章节序号' },
          maxChars: {
            type: 'number',
            description: '最大字符数；不传或 ≤0 表示不截断，返回全文',
          },
          from: {
            type: 'string',
            enum: ['head', 'tail'],
            description: '截取方向：head=章首，tail=章末。仅在指定 maxChars 时生效，默认 tail',
          },
        },
        required: ['order'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_lore_cards',
      description: '列出人物卡/道具卡名录（含关键词与设定摘要）',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['character', 'item'],
            description: '可选：只列人物或道具',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_lore_card',
      description:
        '按 id 或名称/关键词获取完整设定卡。道具卡含功能数值、使用条件、持有与状态等具体数据',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: '名称或关键词' },
        },
        additionalProperties: false,
      },
    },
  },
]

/**
 * 工具使用约束；传入写作目标标签时强调最终输出必须对准该章。
 */
export function toolsSystemHint(writingTargetLabel?: string): string {
  const target = writingTargetLabel?.trim()
  const lines = [
    '需要查阅其他章节大纲/正文，或补查未在提示中出现的人物/道具设定时，请调用提供的工具，勿臆造已有内容。',
  ]
  if (target) {
    lines.push(
      `当前写作目标是「${target}」。查阅上一章等仅用于核对衔接；最终输出必须是该目标章正文，不得以上一章正文为主体交差。`,
    )
  }
  return lines.join('')
}

export function toolStatusLabel(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson || '{}') as Record<string, unknown>
    if (name === 'list_chapters') return '查阅章节目录…'
    if (name === 'get_chapter_outline') return `查阅第 ${args.order} 章大纲…`
    if (name === 'get_chapter_content') {
      const n = args.maxChars != null ? `（最多 ${args.maxChars} 字）` : ''
      const side = args.from === 'head' ? '章首' : args.maxChars != null ? '章末' : ''
      return `查阅第 ${args.order} 章正文${side ? side : ''}${n}…`
    }
    if (name === 'list_lore_cards') return '查阅设定卡列表…'
    if (name === 'get_lore_card') return `查阅设定卡 ${args.name || args.id || ''}…`
  } catch {
    /* ignore */
  }
  return `调用工具 ${name}…`
}

/**
 * 在本地执行工具，返回给模型的 JSON 字符串。
 */
export function executeNovelTool(
  novelId: string,
  name: string,
  argsJson: string,
): string {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return JSON.stringify({ error: 'invalid arguments json' })
  }

  try {
    if (name === 'list_chapters') {
      const list = localRepository.listChapters(novelId).map((c) => ({
        order: c.order,
        title: c.title,
        hasContent: !!c.content?.trim(),
        outlineSummary: c.outline?.summary || '',
      }))
      return JSON.stringify({ chapters: list })
    }

    if (name === 'get_chapter_outline') {
      const order = Number(args.order)
      const ch = localRepository.listChapters(novelId).find((c) => c.order === order)
      if (!ch) return JSON.stringify({ error: `chapter order ${order} not found` })
      return JSON.stringify({
        order: ch.order,
        title: ch.title,
        outline: ch.outline,
      })
    }

    if (name === 'get_chapter_content') {
      const order = Number(args.order)
      const ch = localRepository.listChapters(novelId).find((c) => c.order === order)
      if (!ch) return JSON.stringify({ error: `chapter order ${order} not found` })
      const full = ch.content || ''
      let maxChars = Number(args.maxChars)
      const from = args.from === 'head' ? 'head' : 'tail'
      // 未传或非法/≤0：不截断
      const limit =
        Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0
      const truncated = limit > 0 && full.length > limit
      let content = full
      if (truncated) {
        content =
          from === 'head'
            ? full.slice(0, limit)
            : full.slice(full.length - limit)
      }
      return JSON.stringify({
        order: ch.order,
        title: ch.title,
        truncated,
        from: truncated ? from : undefined,
        totalChars: full.length,
        content,
      })
    }

    if (name === 'list_lore_cards') {
      const kind = args.kind as 'character' | 'item' | undefined
      const cards = localRepository.listLoreCards(novelId, kind).map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        keywords: c.keywords,
        summary: (c.content || '').slice(0, 120),
      }))
      return JSON.stringify({ cards })
    }

    if (name === 'get_lore_card') {
      const card = localRepository.findLoreCard(novelId, {
        id: typeof args.id === 'string' ? args.id : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
      })
      if (!card) return JSON.stringify({ error: 'lore card not found' })
      return JSON.stringify(card)
    }

    return JSON.stringify({ error: `unknown tool: ${name}` })
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message || 'tool failed' })
  }
}
