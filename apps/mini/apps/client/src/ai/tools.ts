import { localRepository } from '@/repository/localRepository'
import { assembleLoreView } from '@/types'

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
      name: 'get_book_outline',
      description: '获取本书全书剧情大纲（总纲/分幕主线）；若未填写则返回空提示',
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
        '按 id 或名称/关键词获取设定卡。返回本体 core，以及 asOfOrder 时点下的生效阶段；不传 asOfOrder 时返回本体+阶段摘要列表',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: '名称或关键词' },
          asOfOrder: {
            type: 'number',
            description: '按该章序组装「当前视角」（本体+该章前最近阶段）',
          },
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
    '需要查阅全书大纲、其他章节大纲/正文，或补查未在提示中出现的人物/道具设定时，请调用提供的工具，勿臆造已有内容。',
    '人物/道具卡请用 get_lore_card；长篇成长信息在阶段字段，勿把过时状态当成当前。',
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
    if (name === 'get_book_outline') return '查阅全书大纲…'
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
 * @param options.defaultAsOfOrder 未传 asOfOrder 时，get_lore_card 默认按该章组装
 */
export function executeNovelTool(
  novelId: string,
  name: string,
  argsJson: string,
  options?: { defaultAsOfOrder?: number },
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

    if (name === 'get_book_outline') {
      const novel = localRepository.getNovel(novelId)
      const outline = novel?.meta?.bookOutline?.trim() || ''
      return JSON.stringify({
        hasOutline: !!outline,
        bookOutline: outline || '（尚未填写全书大纲）',
      })
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
        summary: (c.core || c.content || '').slice(0, 120),
        stateCount: c.states?.length || 0,
      }))
      return JSON.stringify({ cards })
    }

    if (name === 'get_lore_card') {
      const card = localRepository.findLoreCard(novelId, {
        id: typeof args.id === 'string' ? args.id : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
      })
      if (!card) return JSON.stringify({ error: 'lore card not found' })
      const asOf =
        args.asOfOrder != null && Number.isFinite(Number(args.asOfOrder))
          ? Math.floor(Number(args.asOfOrder))
          : options?.defaultAsOfOrder != null && Number.isFinite(options.defaultAsOfOrder)
            ? Math.floor(options.defaultAsOfOrder)
            : undefined
      if (asOf != null) {
        const view = assembleLoreView(card, asOf)
        return JSON.stringify({
          id: card.id,
          kind: card.kind,
          name: card.name,
          keywords: card.keywords,
          asOfOrder: asOf,
          core: view.core,
          activeState: view.state,
          assembled: view.text,
        })
      }
      return JSON.stringify({
        id: card.id,
        kind: card.kind,
        name: card.name,
        keywords: card.keywords,
        core: card.core || card.content,
        states: (card.states || []).map((s) => ({
          id: s.id,
          fromOrder: s.fromOrder,
          label: s.label,
          summary: (s.content || '').slice(0, 160),
        })),
      })
    }

    return JSON.stringify({ error: `unknown tool: ${name}` })
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message || 'tool failed' })
  }
}
