import type { Provider } from '@/types'

export interface ProviderConfig {
  id: Provider
  name: string
  baseUrl: string
  models: string[]
  defaultModel: string
}

/** 预设厂商与模型（首期前端写死） */
export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-v4-flash',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-8k',
  },
]

export function getProvider(id: Provider): ProviderConfig {
  const p = PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown provider: ${id}`)
  return p
}
