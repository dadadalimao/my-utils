import { getProvider } from '@/constants/providers'
import type { Provider } from '@/types'

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  name?: string
  tool_calls?: ToolCall[]
  /** DeepSeek V4 thinking：工具轮后续请求需带回 */
  reasoning_content?: string | null
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface StreamOptions {
  provider: Provider
  apiKey: string
  model: string
  messages: ChatCompletionMessage[]
  /** 每收到一段正文增量回调 */
  onDelta?: (delta: string, fullText: string) => void
  /** 每收到一段思考（reasoning_content）增量回调 */
  onReasoning?: (delta: string, fullReasoning: string) => void
  /** 注册可中止句柄（小程序 RequestTask.abort / fetch AbortController） */
  onAbortHandle?: (handle: { abort: () => void }) => void
}

function resolveBaseUrl(provider: Provider): string {
  const cfg = getProvider(provider)
  // H5：走开发/同源代理路径（vite.config.ts）
  // #ifdef H5
  if (typeof window !== 'undefined') {
    return `/ai-proxy/${provider}`
  }
  // #endif
  return cfg.baseUrl
}

/** ArrayBuffer → UTF-8 字符串（兼容小程序无 TextDecoder 的情况） */
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
 * 解析 OpenAI 兼容 SSE 文本块，累积未完整行到 buffer。
 * 同时识别 DeepSeek 的 reasoning_content（思考）与 content（正文）。
 */
function consumeSseBuffer(
  buffer: string,
  onContent: (piece: string) => void,
  onReasoning?: (piece: string) => void,
): string {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  for (const line of parts) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') continue
    try {
      const json = JSON.parse(payload) as {
        choices?: {
          delta?: { content?: string; reasoning_content?: string }
          message?: { content?: string; reasoning_content?: string }
        }[]
        error?: { message?: string }
      }
      if (json.error?.message) throw new Error(json.error.message)
      const delta = json.choices?.[0]?.delta
      const message = json.choices?.[0]?.message
      const reasoning =
        delta?.reasoning_content ?? message?.reasoning_content ?? ''
      if (reasoning) onReasoning?.(reasoning)
      const content = delta?.content ?? message?.content ?? ''
      if (content) onContent(content)
    } catch (e) {
      if (e instanceof SyntaxError) continue
      throw e
    }
  }
  return rest
}

/**
 * 微信小程序：enableChunked + onChunkReceived。
 */
function streamViaChunked(options: StreamOptions): Promise<string> {
  const { provider, apiKey, model, messages, onDelta, onReasoning, onAbortHandle } = options
  const url = `${resolveBaseUrl(provider)}/v1/chat/completions`

  return new Promise((resolve, reject) => {
    let fullText = ''
    let fullReasoning = ''
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
      lineBuffer = consumeSseBuffer(
        lineBuffer + chunk,
        (piece) => {
          fullText += piece
          onDelta?.(piece, fullText)
        },
        (piece) => {
          fullReasoning += piece
          onReasoning?.(piece, fullReasoning)
        },
      )
    }

    const task = uni.request({
      url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      data: {
        model,
        messages,
        stream: true,
      },
      enableChunked: true,
      timeout: 300000,
      success: (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
          finish(new Error(`AI 请求失败 (${res.statusCode}): ${body}`))
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

    onAbortHandle?.({
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

/**
 * H5：fetch + ReadableStream 读 SSE。
 */
async function streamViaFetch(options: StreamOptions): Promise<string> {
  const { provider, apiKey, model, messages, onDelta, onReasoning, onAbortHandle } = options
  const url = `${resolveBaseUrl(provider)}/v1/chat/completions`
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  if (ac) {
    onAbortHandle?.({ abort: () => ac.abort() })
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
    signal: ac?.signal,
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`AI 请求失败 (${res.status}): ${body}`)
  }

  let lineBuffer = ''
  let fullText = ''
  let fullReasoning = ''

  const feed = (chunk: string) => {
    lineBuffer = consumeSseBuffer(
      lineBuffer + chunk,
      (piece) => {
        fullText += piece
        onDelta?.(piece, fullText)
      },
      (piece) => {
        fullReasoning += piece
        onReasoning?.(piece, fullReasoning)
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

/**
 * 流式 chat/completions（OpenAI 兼容）。
 * 微信端用 enableChunked；H5 用 fetch；其余环境降级非流式。
 */
export async function chatCompletionStream(options: StreamOptions): Promise<string> {
  const { apiKey } = options
  if (!apiKey) throw new Error('请先配置 API Key')

  // #ifdef H5
  if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
    return streamViaFetch(options)
  }
  // #endif

  // #ifdef MP-WEIXIN
  return streamViaChunked(options)
  // #endif

  // 其它端：优先尝试 chunked，失败则非流式
  try {
    return await streamViaChunked(options)
  } catch {
    return chatCompletion({
      provider: options.provider,
      apiKey: options.apiKey,
      model: options.model,
      messages: options.messages,
    }).then((text) => {
      options.onDelta?.(text, text)
      return text
    })
  }
}

/**
 * 客户端直连厂商（OpenAI 兼容 chat/completions，非流式）。
 */
export async function chatCompletion(options: {
  provider: Provider
  apiKey: string
  model: string
  messages: ChatCompletionMessage[]
}): Promise<string> {
  const { provider, apiKey, model, messages } = options
  if (!apiKey) throw new Error('请先配置 API Key')

  const url = `${resolveBaseUrl(provider)}/v1/chat/completions`

  const res = await new Promise<UniApp.RequestSuccessCallbackResult>((resolve, reject) => {
    uni.request({
      url,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: {
        model,
        messages,
        stream: false,
      },
      timeout: 120000,
      success: resolve,
      fail: reject,
    })
  })

  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    throw new Error(`AI 请求失败 (${res.statusCode}): ${body}`)
  }

  const data = res.data as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 返回为空')
  return content
}

export interface ToolsCompletionResult {
  content: string
  tool_calls: ToolCall[]
  /** DeepSeek 思考链；带 tool_calls 回传时需一并带上 */
  reasoning_content?: string
}

/**
 * 非流式 + tools（用于 Function Calling 工具轮）。
 */
export async function chatCompletionWithTools(options: {
  provider: Provider
  apiKey: string
  model: string
  messages: ChatCompletionMessage[]
  tools: ToolDef[]
  tool_choice?: 'auto' | 'none'
  onAbortHandle?: (handle: { abort: () => void }) => void
}): Promise<ToolsCompletionResult> {
  const { provider, apiKey, model, messages, tools, onAbortHandle } = options
  if (!apiKey) throw new Error('请先配置 API Key')

  const url = `${resolveBaseUrl(provider)}/v1/chat/completions`

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
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: {
        model,
        messages,
        stream: false,
        tools,
        tool_choice: options.tool_choice ?? 'auto',
      },
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
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    throw new Error(`AI 请求失败 (${res.statusCode}): ${body}`)
  }

  const data = res.data as {
    choices?: {
      message?: {
        content?: string | null
        reasoning_content?: string | null
        tool_calls?: ToolCall[]
      }
      finish_reason?: string
    }[]
  }
  const msg = data.choices?.[0]?.message
  const reasoning = (msg?.reasoning_content || '').trim()
  return {
    content: msg?.content || '',
    tool_calls: msg?.tool_calls || [],
    reasoning_content: reasoning || undefined,
  }
}

/** 测通：发一条最小请求 */
export async function pingProvider(provider: Provider, apiKey: string, model: string) {
  return chatCompletion({
    provider,
    apiKey,
    model,
    messages: [{ role: 'user', content: 'ping，请只回复 ok' }],
  })
}
