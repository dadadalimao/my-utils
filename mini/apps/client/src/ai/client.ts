import { getProvider } from '@/constants/providers'
import type { Provider } from '@/types'

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function resolveBaseUrl(provider: Provider): string {
  const cfg = getProvider(provider)
  // H5：走开发/同源代理路径（vite.config.ts）
  if (typeof window !== 'undefined') {
    return `/ai-proxy/${provider}`
  }
  return cfg.baseUrl
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

/** 测通：发一条最小请求 */
export async function pingProvider(provider: Provider, apiKey: string, model: string) {
  return chatCompletion({
    provider,
    apiKey,
    model,
    messages: [{ role: 'user', content: 'ping，请只回复 ok' }],
  })
}
