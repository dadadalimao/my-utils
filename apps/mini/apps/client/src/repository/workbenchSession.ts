import type { ChatMessage } from '@/types'
import { storageGet, storageRemove, storageSet } from './storage'

/** 与 chat store 过程日志同形，避免循环引用 */
export interface SessionLogItem {
  at: string
  text: string
  kind?: 'thinking' | 'info'
}

/** 工作台未落库前的现场，按小说+章节分份 */
export interface WorkbenchSession {
  novelId: string
  chapterId: string | null
  input: string
  adviceInput: string
  messages: ChatMessage[]
  adviceMessages: ChatMessage[]
  lastReply: string
  activityLog: SessionLogItem[]
  savedAt: string
}

const INDEX_KEY = 'workbenchSessionIndex'
const MAX_SESSIONS = 12
const MAX_MESSAGES = 12
const MAX_LOG = 80

function sessionKey(novelId: string, chapterId: string | null) {
  return `workbenchSession:${novelId}:${chapterId || 'none'}`
}

/**
 * 读取某章工作台暂存；没有则返回 null。
 */
export function loadWorkbenchSession(
  novelId: string,
  chapterId: string | null,
): WorkbenchSession | null {
  if (!novelId) return null
  return storageGet<WorkbenchSession | null>(sessionKey(novelId, chapterId), null)
}

/**
 * 写入暂存，只留最近若干条消息/日志，并淘汰过旧份数。
 */
export function saveWorkbenchSession(session: WorkbenchSession) {
  if (!session.novelId) return
  const key = sessionKey(session.novelId, session.chapterId)
  const trimmed: WorkbenchSession = {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES),
    adviceMessages: session.adviceMessages.slice(-MAX_MESSAGES),
    activityLog: session.activityLog.slice(-MAX_LOG),
    savedAt: new Date().toISOString(),
  }
  storageSet(key, trimmed)
  touchIndex(key)
}

/** 清空指定章节的工作台暂存 */
export function removeWorkbenchSession(novelId: string, chapterId: string | null) {
  if (!novelId) return
  const key = sessionKey(novelId, chapterId)
  storageRemove(key)
  storageSet(
    INDEX_KEY,
    storageGet<string[]>(INDEX_KEY, []).filter((k) => k !== key),
  )
}

function touchIndex(key: string) {
  const idx = storageGet<string[]>(INDEX_KEY, []).filter((k) => k !== key)
  idx.push(key)
  while (idx.length > MAX_SESSIONS) {
    const drop = idx.shift()
    if (drop) storageRemove(drop)
  }
  storageSet(INDEX_KEY, idx)
}
