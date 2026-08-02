import {
  anthropicContentHasWebSearch,
  chatAnthropicStream,
  chatAnthropicWithTools,
  openaiMessagesToAnthropic,
  type AnthropicMessage,
  type AnthropicTool,
} from '@/ai/anthropicDeepseek'
import { chatCompletion, chatCompletionWithTools, type ChatCompletionMessage } from '@/ai/client'
import { localRepository } from '@/repository/localRepository'
import { assembleLoreView } from '@/types'
import type { Provider } from '@/types'

/** 辅助页 / 工作台共用的最大工具轮数 */
export const MAX_NOVEL_TOOL_ROUNDS = 10

/** OpenAI 兼容 tool 定义 */
export const NOVEL_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_novel_bible',
      description:
        '获取「本书设定」（世界观、文风、力量体系、道具品质、高潮惯例等通用设定，对应 meta.bible）；不是人物/道具设定卡',
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
      name: 'get_chapter_outlines',
      description:
        '按章序范围批量获取章节大纲。不传 fromOrder/toOrder 时返回全部章节大纲',
      parameters: {
        type: 'object',
        properties: {
          fromOrder: { type: 'number', description: '起始章序（含），默认 1' },
          toOrder: { type: 'number', description: '结束章序（含），默认最后一章' },
        },
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
  {
    type: 'function' as const,
    function: {
      name: 'list_library_entries',
      description:
        '列出本书「资料库」名录（同人/原作参考资料：标题、关键词、摘要）；不是本书设定，也不是人物/道具设定卡',
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
      name: 'get_library_entry',
      description:
        '按 id 或标题/关键词获取资料库条目全文（含可选来源链接）。用于查阅收集的原作/同人参考资料',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string', description: '标题或关键词' },
        },
        additionalProperties: false,
      },
    },
  },
]

/**
 * 工具使用约束；传入写作目标标签时强调最终输出必须对准该章。
 * @param options.webSearch 已挂载 DeepSeek 联网工具时补充说明
 */
export function toolsSystemHint(
  writingTargetLabel?: string,
  options?: { webSearch?: boolean },
): string {
  const target = writingTargetLabel?.trim()
  const lines = [
    '需要查阅本书设定、资料库、全书大纲、章节大纲/正文，或人物/道具设定卡时，请调用提供的工具，勿臆造已有内容。',
    '「本书设定」用 get_novel_bible（世界观/文风等通用设定）；「资料库」用 list_library_entries / get_library_entry（原作/同人参考资料）；人物/道具卡用 list_lore_cards / get_lore_card。三者不是同一概念。',
    '长篇成长信息在设定卡阶段字段，勿把过时状态当成当前。',
  ]
  if (options?.webSearch) {
    lines.push(
      '已提供 web_search 联网工具：可检索公开网页核对原作设定/资料；检索结果仅作参考，勿与本书设定、设定卡混淆，勿编造未检索到的事实。',
    )
  }
  if (target) {
    lines.push(
      `当前写作目标是「${target}」。查阅上一章等仅用于核对衔接；最终输出必须是该目标章正文，不得以上一章正文为主体交差。`,
    )
  }
  return lines.join('')
}

/** DeepSeek 服务端联网搜索工具（Anthropic 格式） */
export function buildDeepseekWebSearchTool(): AnthropicTool {
  return {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  }
}

/** OpenAI NOVEL_TOOLS → Anthropic 客户端工具 */
export function toAnthropicClientTools(
  tools: typeof NOVEL_TOOLS = NOVEL_TOOLS,
): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters || {
      type: 'object',
      properties: {},
    }) as Record<string, unknown>,
  }))
}

/** DeepSeek 联网轮完整 tools 列表 */
export function buildDeepseekAnthropicTools(): AnthropicTool[] {
  return [buildDeepseekWebSearchTool(), ...toAnthropicClientTools()]
}

export function toolStatusLabel(name: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson || '{}') as Record<string, unknown>
    if (name === 'get_novel_bible') return '查阅本书设定…'
    if (name === 'list_chapters') return '查阅章节目录…'
    if (name === 'get_book_outline') return '查阅全书大纲…'
    if (name === 'get_chapter_outline') return `查阅第 ${args.order} 章大纲…`
    if (name === 'get_chapter_outlines') {
      const from = args.fromOrder != null ? args.fromOrder : '?'
      const to = args.toOrder != null ? args.toOrder : '?'
      if (args.fromOrder == null && args.toOrder == null) return '批量查阅章节大纲…'
      return `批量查阅第 ${from}–${to} 章大纲…`
    }
    if (name === 'get_chapter_content') {
      const n = args.maxChars != null ? `（最多 ${args.maxChars} 字）` : ''
      const side = args.from === 'head' ? '章首' : args.maxChars != null ? '章末' : ''
      return `查阅第 ${args.order} 章正文${side ? side : ''}${n}…`
    }
    if (name === 'list_lore_cards') return '查阅设定卡列表…'
    if (name === 'get_lore_card') return `查阅设定卡 ${args.name || args.id || ''}…`
    if (name === 'list_library_entries') return '查阅资料库列表…'
    if (name === 'get_library_entry') return `查阅资料 ${args.name || args.id || ''}…`
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
    if (name === 'get_novel_bible') {
      const novel = localRepository.getNovel(novelId)
      const bible = novel?.meta?.bible?.trim() || ''
      const capped = bible.slice(0, 8000)
      return JSON.stringify({
        hasBible: !!bible,
        truncated: bible.length > capped.length,
        totalChars: bible.length,
        bible: capped || '（尚未填写本书设定）',
      })
    }

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

    if (name === 'get_chapter_outlines') {
      const chapters = localRepository.listChapters(novelId)
      const minOrder = chapters.length ? chapters[0].order : 1
      const maxOrder = chapters.length ? chapters[chapters.length - 1].order : 1
      const fromOrder =
        args.fromOrder != null && Number.isFinite(Number(args.fromOrder))
          ? Math.floor(Number(args.fromOrder))
          : minOrder
      const toOrder =
        args.toOrder != null && Number.isFinite(Number(args.toOrder))
          ? Math.floor(Number(args.toOrder))
          : maxOrder
      const list = chapters
        .filter((c) => c.order >= fromOrder && c.order <= toOrder)
        .map((c) => ({
          order: c.order,
          title: c.title,
          outline: c.outline,
        }))
      return JSON.stringify({
        fromOrder,
        toOrder,
        count: list.length,
        chapters: list,
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

    if (name === 'list_library_entries') {
      const entries = localRepository.listLibraryEntries(novelId).map((e) => ({
        id: e.id,
        title: e.title,
        keywords: e.keywords,
        sourceUrl: e.sourceUrl || '',
        summary: (e.content || '').slice(0, 120),
      }))
      return JSON.stringify({ entries })
    }

    if (name === 'get_library_entry') {
      const entry = localRepository.findLibraryEntry(novelId, {
        id: typeof args.id === 'string' ? args.id : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
      })
      if (!entry) return JSON.stringify({ error: 'library entry not found' })
      const content = entry.content || ''
      const capped = content.slice(0, 8000)
      return JSON.stringify({
        id: entry.id,
        title: entry.title,
        keywords: entry.keywords,
        sourceUrl: entry.sourceUrl || '',
        truncated: content.length > capped.length,
        totalChars: content.length,
        content: capped || '（空）',
      })
    }

    return JSON.stringify({ error: `unknown tool: ${name}` })
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message || 'tool failed' })
  }
}

/**
 * DeepSeek Anthropic 工具轮（含 web_search）；失败抛错由调用方降级。
 */
export async function runDeepseekAnthropicToolRounds(options: {
  novelId: string
  apiKey: string
  model: string
  /** OpenAI 风格 messages（含 system） */
  messages: ChatCompletionMessage[]
  maxRounds?: number
  defaultAsOfOrder?: number
  onActivity?: (text: string) => void
  onThinking?: (text: string) => void
  onAbortHandle?: (handle: { abort: () => void }) => void
}): Promise<{
  system: string
  messages: AnthropicMessage[]
  lastText: string
}> {
  const {
    novelId,
    apiKey,
    model,
    maxRounds = MAX_NOVEL_TOOL_ROUNDS,
    defaultAsOfOrder,
    onActivity,
    onThinking,
    onAbortHandle,
  } = options

  const converted = openaiMessagesToAnthropic(options.messages)
  let system = converted.system
  // 确保 hint 含联网说明
  if (!/web_search/.test(system)) {
    system = [system, toolsSystemHint(undefined, { webSearch: true })].filter(Boolean).join('\n\n')
  }
  const anthMessages: AnthropicMessage[] = [...converted.messages]
  const tools = buildDeepseekAnthropicTools()
  let lastText = ''

  for (let round = 0; round < maxRounds; round++) {
    onActivity?.(`联网工具轮询 ${round + 1}/${maxRounds}…`)
    const result = await chatAnthropicWithTools({
      apiKey,
      model,
      system,
      messages: anthMessages,
      tools,
      onAbortHandle,
    })

    if (result.thinking) onThinking?.(result.thinking)
    if (anthropicContentHasWebSearch(result.content)) {
      onActivity?.('联网搜索…')
    }

    anthMessages.push({ role: 'assistant', content: result.content })
    lastText = result.text || lastText

    if (!result.clientToolUses.length) {
      onActivity?.(lastText.trim() ? '资料已齐（含联网）' : '未调用客户端工具')
      break
    }

    const toolResults: import('./anthropicDeepseek').AnthropicContentBlock[] = []
    for (const call of result.clientToolUses) {
      const status = toolStatusLabel(call.name, JSON.stringify(call.input || {}))
      onActivity?.(status)
      const out = executeNovelTool(novelId, call.name, JSON.stringify(call.input || {}), {
        defaultAsOfOrder,
      })
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: out,
      })
      onActivity?.(`${status.replace(/…$/, '')} · 完成`)
    }
    anthMessages.push({ role: 'user', content: toolResults })
  }

  return { system, messages: anthMessages, lastText }
}

/**
 * 辅助页共用：带工具轮询的非流式补全；厂商不支持 tools 时降级为无工具单轮。
 * DeepSeek 且 enableWebSearch 时走 Anthropic web_search，失败再降级 OpenAI tools。
 */
export async function chatWithNovelTools(options: {
  novelId: string
  provider: Provider
  apiKey: string
  model: string
  messages: ChatCompletionMessage[]
  maxRounds?: number
  defaultAsOfOrder?: number
  /** 工具轮结束后仍无正文时，追加的催促文案 */
  finalNudge?: string
  /** DeepSeek 原生联网；默认读用户设置 enableDeepseekWebSearch */
  enableWebSearch?: boolean
}): Promise<string> {
  const {
    novelId,
    provider,
    apiKey,
    model,
    maxRounds = MAX_NOVEL_TOOL_ROUNDS,
    defaultAsOfOrder,
    finalNudge = '请基于已有信息直接输出最终结果，勿再调用工具。',
  } = options
  const enableWebSearch =
    options.enableWebSearch ??
    (provider === 'deepseek' &&
      localRepository.getSettings().enableDeepseekWebSearch === true)

  if (provider === 'deepseek' && enableWebSearch) {
    try {
      const { system, messages: anthMessages, lastText } = await runDeepseekAnthropicToolRounds({
        novelId,
        apiKey,
        model,
        messages: options.messages,
        maxRounds,
        defaultAsOfOrder,
      })
      if (lastText.trim()) {
        // 再要一轮无 tools 的最终整理
        try {
          const final = await chatAnthropicWithTools({
            apiKey,
            model,
            system,
            messages: [
              ...anthMessages,
              { role: 'user', content: finalNudge },
            ],
            tools: [],
          })
          if (final.text.trim()) return final.text.trim()
        } catch {
          /* 用上一轮正文 */
        }
        return lastText.trim()
      }
      const final = await chatAnthropicWithTools({
        apiKey,
        model,
        system,
        messages: [...anthMessages, { role: 'user', content: finalNudge }],
        tools: [],
      })
      if (final.text.trim()) return final.text.trim()
    } catch (e) {
      console.warn('DeepSeek 联网工具轮失败，降级 OpenAI tools', e)
    }
  }

  const apiMessages: ChatCompletionMessage[] = [...options.messages]

  let toolsOk = true
  for (let round = 0; round < maxRounds; round++) {
    let result
    try {
      result = await chatCompletionWithTools({
        provider,
        apiKey,
        model,
        messages: apiMessages,
        tools: NOVEL_TOOLS,
        tool_choice: 'auto',
      })
    } catch (e) {
      console.warn('tools 请求失败，降级无工具补全', e)
      toolsOk = false
      break
    }

    if (!result.tool_calls?.length) {
      const text = (result.content || '').trim()
      if (text) return text
      break
    }

    apiMessages.push({
      role: 'assistant',
      content: result.content || null,
      reasoning_content: result.reasoning_content || null,
      tool_calls: result.tool_calls,
    })

    for (const call of result.tool_calls) {
      const out = executeNovelTool(novelId, call.function.name, call.function.arguments, {
        defaultAsOfOrder,
      })
      apiMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: out,
      })
    }
  }

  const finalMessages: ChatCompletionMessage[] = toolsOk
    ? [...apiMessages, { role: 'user', content: finalNudge }]
    : options.messages

  const out = await chatCompletion({
    provider,
    apiKey,
    model,
    messages: finalMessages,
  })
  return out.trim()
}

export { chatAnthropicStream }
