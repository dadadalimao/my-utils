import { localRepository } from '@/repository/localRepository'
import type { SyncPayload } from '@/types'

function apiBase() {
  return localRepository.getSettings().apiBaseUrl.replace(/\/$/, '')
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export async function apiRegister(username: string, password: string) {
  return request<{ accessToken: string; userId: string; username: string }>(
    'POST',
    '/auth/register',
    { username, password },
  )
}

export async function apiLogin(username: string, password: string) {
  return request<{ accessToken: string; userId: string; username: string }>(
    'POST',
    '/auth/login',
    { username, password },
  )
}

export async function apiUploadSnapshot(token: string, payload: SyncPayload) {
  return request<{ updatedAt: string }>('PUT', '/sync', { payload }, token)
}

export async function apiDownloadSnapshot(token: string) {
  return request<{ payload: SyncPayload; updatedAt: string }>('GET', '/sync', undefined, token)
}

export async function apiFetchTemplates(token: string, mode?: string) {
  const q = mode ? `?mode=${mode}` : ''
  return request<
    { id: string; mode: string; name: string; content: string; updatedAt: string }[]
  >('GET', `/prompt-templates${q}`, undefined, token)
}

/** 从 Nest / 网络错误体中抽出可读文案，避免 toast 直接塞整段 JSON */
function extractErrorMessage(data: unknown, statusCode: number): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const msg = (data as { message: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg
    if (Array.isArray(msg) && msg.length) return msg.map(String).join('; ')
  }
  if (typeof data === 'string' && data.trim()) return data
  return `请求失败 (${statusCode})`
}

function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: unknown,
  token?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: apiBase() + path,
      method,
      data,
      header: token ? authHeader(token) : { 'Content-Type': 'application/json' },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T)
        } else {
          reject(new Error(extractErrorMessage(res.data, res.statusCode)))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || '网络错误')),
    })
  })
}
