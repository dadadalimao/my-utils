/**
 * DeepSeek Anthropic 兼容端点（含服务端 web_search）。
 * Base: https://api.deepseek.com/anthropic → POST /v1/messages
 */

import type { ChatCompletionMessage } from './client'

/** Anthropic content block（客户端关心的子集） */
export type AnthropicContentBlock = {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
  [key: string]: unknown
}

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicTool =
  | {
      type: 'web_search_20250305'
      name: 'web_search'
      max_uses?: number
    }
  | {
      name: string
      description?: string
      input_schema: Record<string, unknown>
    }

export interface AnthropicToolsResult {
  content: AnthropicContentBlock[]
  stop_reason: string | null
  /** 拼接后的正文 */
  text: string
  /** thinking 块拼接 */
  thinking: string
  /** 仅客户端 tool_use（不含 server web_search） */
  clientToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>
}

function resolveAnthropicBase(): string {
  // #ifdef H5
  if (typeof window !== 'undefined') {
    return '/ai-proxy/deepseek/anthropic'
  }
  // #endif
  return 'https://api.deepseek.com/anthropic'
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
}

/**
 * 将 OpenAI 风格 messages 拆成 Anthropic system + messages。
 * tool 角色合并为上一条后的 user tool_result（仅用于降级前的简单历史；联网轮用专用结构）。
 */
export function openaiMessagesToAnthropic(messages: ChatCompletionMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content) systemParts.push(m.content)
      continue
    }
    if (m.role === 'tool') {
      const last = out[out.length - 1]
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
        content: m.content || '',
      }
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      if (m.reasoning_content) {
        blocks.push({ type: 'thinking', thinking: m.reasoning_content })
      }
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {}
          try {
            input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
          } catch {
            input = {}
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
      }
      if (m.content) {
        blocks.push({ type: 'text', text: m.content })
      }
      if (!blocks.length) blocks.push({ type: 'text', text: '' })
      out.push({ role: 'assistant', content: blocks })
      continue
    }
    // user
    out.push({
      role: 'user',
      content: m.content || '',
    })
  }

  return { system: systemParts.join('\n\n'), messages: out }
}

function extractFromContent(content: AnthropicContentBlock[]): {
  text: string
  thinking: string
  clientToolUses: AnthropicToolsResult['clientToolUses']
} {
  let text = ''
  let thinking = ''
  const clientToolUses: AnthropicToolsResult['clientToolUses'] = []
  for (const b of content) {
    if (b.type === 'text' && b.text) text += b.text
    if (b.type === 'thinking' && b.thinking) thinking += b.thinking
    if (b.type === 'tool_use' && b.id && b.name) {
      clientToolUses.push({
        id: b.id,
        name: b.name,
        input: (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>,
      })
    }
  }
  return { text, thinking, clientToolUses }
}

/**
 * 非流式 Messages + tools（含服务端 web_search）。
 */
export async function chatAnthropicWithTools(options: {
  apiKey: string
  model: string
  system?: string
  messages: AnthropicMessage[]
  tools: AnthropicTool[]
  max_tokens?: number
  onAbortHandle?: (handle: { abort: () => void }) => void
}): Promise<AnthropicToolsResult> {
  const { apiKey, model, system, messages, tools, max_tokens = 8192, onAbortHandle } = options
  if (!apiKey) throw new Error('请先配置 API Key')

  const url = `${resolveAnthropicBase()}/v1/messages`
  const body: Record<string, unknown> = {
    model,
    max_tokens,
    messages,
  }
  if (system?.trim()) body.system = system
  if (tools.length) {
    body.tools = tools
    body.tool_choice = { type: 'auto' }
  }

  const res = await new Promise<UniApp.RequestSuccessCallbackResult>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    const task = uni.request({
      url,
      method: 'POST',
      header: anthropicHeaders(apiKey),
      data: body,
      timeout: 180000,
      success: (r) => done(() => resolve(r)),
      fail: (err) => {
        const msg = err.errMsg || 'network error'
        done(() => reject(new Error(/abort/i.test(msg) ? '已停止' : msg)))
      },
    }) as UniApp.RequestTask & { abort?: () => void }

    onAbortHandle?.({
      abort: () => {
        try {
          task?.abort?.()
        } catch {
          /* ignore */
        }
        done(() => reject(new Error('已停止')))
      },
    })
  })

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    throw new Error(`Anthropic 请求失败 (${res.statusCode}): ${raw}`)
  }

  const data = res.data as {
    content?: AnthropicContentBlock[]
    stop_reason?: string | null
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(data.error.message)

  const content = Array.isArray(data.content) ? data.content : []
  const extracted = extractFromContent(content)
  return {
    content,
    stop_reason: data.stop_reason ?? null,
    text: extracted.text,
    thinking: extracted.thinking,
    clientToolUses: extracted.clientToolUses,
  }
}

function decodeChunk(data: ArrayBuffer | string): string {
  if (typeof data === 'string') return data
  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(new Uint8Array(data))
    }
  } catch {
    /* fall through */
  }
  const bytes = new Uint8Array(data)
  let raw = ''
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i])
  try {
    return decodeURIComponent(escape(raw))
  } catch {
    return raw
  }
}

/**
 * 解析 Anthropic SSE，提取 text_delta / thinking_delta。
 */
function consumeAnthropicSse(
  buffer: string,
  onText: (piece: string) => void,
  onThinking?: (piece: string) => void,
): string {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  for (const line of parts) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const json = JSON.parse(payload) as {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
        error?: { message?: string }
      }
      if (json.error?.message) throw new Error(json.error.message)
      if (json.type === 'content_block_delta' && json.delta) {
        if (json.delta.type === 'text_delta' && json.delta.text) onText(json.delta.text)
        if (json.delta.type === 'thinking_delta' && json.delta.thinking) {
          onThinking?.(json.delta.thinking)
        }
        // 部分实现直接给 text
        if (!json.delta.type && json.delta.text) onText(json.delta.text)
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue
      throw e
    }
  }
  return rest
}

/**
 * Anthropic 流式正文（最终输出用；不带 tools 或 tool_choice none）。
 */
export async function chatAnthropicStream(options: {
  apiKey: string
  model: string
  system?: string
  messages: AnthropicMessage[]
  max_tokens?: number
  onDelta?: (delta: string, fullText: string) => void
  onThinking?: (delta: string, full: string) => void
  onAbortHandle?: (handle: { abort: () => void }) => void
}): Promise<string> {
  const { apiKey, model, system, messages, max_tokens = 8192 } = options
  if (!apiKey) throw new Error('请先配置 API Key')

  const url = `${resolveAnthropicBase()}/v1/messages`
  const body: Record<string, unknown> = {
    model,
    max_tokens,
    messages,
    stream: true,
  }
  if (system?.trim()) body.system = system

  // #ifdef H5
  if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
    return streamAnthropicViaFetch(url, apiKey, body, options)
  }
  // #endif

  return streamAnthropicViaChunked(url, apiKey, body, options)
}

async function streamAnthropicViaFetch(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  options: {
    onDelta?: (delta: string, fullText: string) => void
    onThinking?: (delta: string, full: string) => void
    onAbortHandle?: (handle: { abort: () => void }) => void
  },
): Promise<string> {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  if (ac) options.onAbortHandle?.({ abort: () => ac.abort() })

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...anthropicHeaders(apiKey), Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal: ac?.signal,
  })
  if (!res.ok) {
    throw new Error(`Anthropic 请求失败 (${res.status}): ${await res.text()}`)
  }

  let lineBuffer = ''
  let fullText = ''
  let fullThinking = ''
  const feed = (chunk: string) => {
    lineBuffer = consumeAnthropicSse(
      lineBuffer + chunk,
      (piece) => {
        fullText += piece
        options.onDelta?.(piece, fullText)
      },
      (piece) => {
        fullThinking += piece
        options.onThinking?.(piece, fullThinking)
      },
    )
  }

  if (!res.body) {
    feed((await res.text()) + '\n')
    if (!fullText) throw new Error('AI 返回为空')
    return fullText
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      feed(decoder.decode(value, { stream: true }))
    }
  } catch (e) {
    if (ac?.signal.aborted || (e instanceof Error && /abort/i.test(e.message))) {
      throw new Error('已停止')
    }
    throw e
  }
  if (lineBuffer.trim()) feed('\n')
  if (!fullText) throw new Error('AI 返回为空')
  return fullText
}

function streamAnthropicViaChunked(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  options: {
    onDelta?: (delta: string, fullText: string) => void
    onThinking?: (delta: string, full: string) => void
    onAbortHandle?: (handle: { abort: () => void }) => void
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let fullText = ''
    let fullThinking = ''
    let lineBuffer = ''
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else if (!fullText) reject(new Error('AI 返回为空'))
      else resolve(fullText)
    }

    const applySse = (chunk: string) => {
      lineBuffer = consumeAnthropicSse(
        lineBuffer + chunk,
        (piece) => {
          fullText += piece
          options.onDelta?.(piece, fullText)
        },
        (piece) => {
          fullThinking += piece
          options.onThinking?.(piece, fullThinking)
        },
      )
    }

    const task = uni.request({
      url,
      method: 'POST',
      header: { ...anthropicHeaders(apiKey), Accept: 'text/event-stream' },
      data: body,
      enableChunked: true,
      timeout: 300000,
      success: (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
          finish(new Error(`Anthropic 请求失败 (${res.statusCode}): ${raw}`))
          return
        }
        if (!fullText && res.data) {
          const text = typeof res.data === 'string' ? res.data : decodeChunk(res.data as ArrayBuffer)
          applySse(text)
        }
        finish()
      },
      fail: (err) => {
        const msg = err.errMsg || 'network error'
        if (/abort/i.test(msg)) finish(new Error('已停止'))
        else finish(new Error(msg))
      },
    }) as UniApp.RequestTask & {
      onChunkReceived?: (cb: (res: { data: ArrayBuffer }) => void) => void
      abort?: () => void
    }

    options.onAbortHandle?.({
      abort: () => {
        try {
          task?.abort?.()
        } catch {
          /* ignore */
        }
        finish(new Error('已停止'))
      },
    })

    if (typeof task?.onChunkReceived === 'function') {
      task.onChunkReceived((res) => {
        try {
          applySse(decodeChunk(res.data))
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)))
        }
      })
    }
  })
}

/** 是否含联网/服务端搜索痕迹（用于 activity） */
export function anthropicContentHasWebSearch(content: AnthropicContentBlock[]): boolean {
  return content.some(
    (b) =>
      b.type === 'server_tool_use' ||
      b.type === 'web_search_tool_result' ||
      (b.type === 'tool_use' && b.name === 'web_search'),
  )
}
