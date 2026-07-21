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

export async function apiFetchTemplates(mode?: string) {
  const q = mode ? `?mode=${mode}` : ''
  return request<
    { id: string; mode: string; name: string; content: string; updatedAt: string }[]
  >('GET', `/prompt-templates${q}`)
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
          const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
          reject(new Error(body || `HTTP ${res.statusCode}`))
        }
      },
      fail: (err) => reject(new Error(err.errMsg || 'network error')),
    })
  })
}
