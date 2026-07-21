import { defineStore } from 'pinia'
import { ref } from 'vue'
import { chatCompletion } from '@/ai/client'
import { buildOutlineContextMessage } from '@/ai/outlineInject'
import { maintainOutlineFromContent } from '@/ai/outlineMaintain'
import { builtinByMode, BUILTIN_TEMPLATES } from '@/constants/templates'
import { apiFetchTemplates } from '@/api/http'
import { createId, type ChatMessage, type ChatMode, type OutlineRange, type PromptTemplate } from '@/types'
import { useNovelStore } from './novel'
import { useSettingsStore } from './settings'

export const useChatStore = defineStore('chat', () => {
  const mode = ref<ChatMode>('chapter')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const injectOutline = ref(true)
  const outlineRange = ref<OutlineRange>({ type: 'all' })
  const templates = ref<PromptTemplate[]>([...BUILTIN_TEMPLATES])
  const selectedTemplateId = ref(builtinByMode('chapter').id)
  const lastReply = ref('')

  function setMode(m: ChatMode) {
    mode.value = m
    const t = templates.value.find((x) => x.mode === m) || builtinByMode(m)
    selectedTemplateId.value = t.id
  }

  async function loadTemplates() {
    try {
      const list = await apiFetchTemplates()
      if (list?.length) {
        templates.value = list.map((t) => ({
          id: t.id,
          mode: t.mode as ChatMode,
          name: t.name,
          content: t.content,
          updatedAt: t.updatedAt,
        }))
      }
    } catch {
      templates.value = [...BUILTIN_TEMPLATES]
    }
    setMode(mode.value)
  }

  function clearMessages() {
    messages.value = []
    lastReply.value = ''
  }

  async function send(userText: string) {
    const settings = useSettingsStore()
    const novel = useNovelStore()
    if (!novel.currentNovelId) throw new Error('请先选择小说')

    const provider = settings.settings.defaultProvider
    const apiKey = settings.apiKeyFor(provider)
    const model = settings.settings.defaultModel
    const tpl =
      templates.value.find((t) => t.id === selectedTemplateId.value) ||
      builtinByMode(mode.value)

    const systemParts: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      { role: 'system', content: tpl.content },
    ]

    const shouldInject =
      injectOutline.value && settings.settings.injectOutlineByDefault !== false
    if (shouldInject) {
      const range: OutlineRange = { ...outlineRange.value }
      if (range.type === 'current') {
        range.currentChapterId = novel.currentChapterId || undefined
      }
      const ctx = buildOutlineContextMessage(novel.currentNovelId, range)
      if (ctx) systemParts.push(ctx)
    }

    messages.value.push({
      id: createId('m_'),
      role: 'user',
      content: userText,
      createdAt: new Date().toISOString(),
    })

    const history = messages.value.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }))

    loading.value = true
    try {
      const reply = await chatCompletion({
        provider,
        apiKey,
        model,
        messages: [...systemParts, ...history],
      })
      lastReply.value = reply
      messages.value.push({
        id: createId('m_'),
        role: 'assistant',
        content: reply,
        createdAt: new Date().toISOString(),
      })
      return reply
    } finally {
      loading.value = false
    }
  }

  /**
   * 保存为章节正文，并按设置自动维护大纲。
   */
  async function saveReplyAsContent(chapterId?: string, title?: string) {
    const novel = useNovelStore()
    const settings = useSettingsStore()
    if (!lastReply.value) throw new Error('没有可保存的内容')

    let cid = chapterId
    if (!cid) {
      const c = novel.createChapter(title || `第${novel.chapters.length + 1}章`)
      cid = c.id
    }
    novel.saveChapterContent(cid, lastReply.value)

    if (settings.settings.autoMaintainOutline) {
      const provider = settings.settings.defaultProvider
      try {
        await maintainOutlineFromContent({
          chapterId: cid,
          provider,
          apiKey: settings.apiKeyFor(provider),
          model: settings.settings.defaultModel,
        })
        novel.refresh()
      } catch (e) {
        uni.showToast({
          title: `正文已保存，大纲更新失败`,
          icon: 'none',
        })
        console.warn(e)
      }
    }
    return cid
  }

  /** 保存为章节大纲（写入 outline，可新建章） */
  function saveReplyAsOutline(chapterId?: string, title?: string) {
    const novel = useNovelStore()
    if (!lastReply.value) throw new Error('没有可保存的内容')

    let cid = chapterId
    if (!cid) {
      const c = novel.createChapter(title || `第${novel.chapters.length + 1}章`)
      cid = c.id
    }
    const summary = lastReply.value.slice(0, 500)
    const beats = lastReply.value
      .split(/\n+/)
      .map((s) => s.replace(/^[\d\.\-\*\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 12)
    novel.saveChapterOutline(cid, {
      summary,
      beats,
      notes: '',
      source: 'from_chat',
      updatedAt: new Date().toISOString(),
    })
    return cid
  }

  return {
    mode,
    messages,
    loading,
    injectOutline,
    outlineRange,
    templates,
    selectedTemplateId,
    lastReply,
    setMode,
    loadTemplates,
    clearMessages,
    send,
    saveReplyAsContent,
    saveReplyAsOutline,
  }
})
