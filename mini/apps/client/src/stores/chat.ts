import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  chatCompletionStream,
  chatCompletionWithTools,
  type ChatCompletionMessage,
} from '@/ai/client'
import { buildBibleInjectContent } from '@/ai/novelBible'
import { buildLoreInjectMessage } from '@/ai/loreInject'
import {
  buildOutlineContextMessage,
  buildWritingTargetMessage,
  resolveWritingTarget,
} from '@/ai/outlineInject'
import { maintainOutlineFromContent } from '@/ai/outlineMaintain'
import {
  generateChapterTitleFromContent,
  isPlaceholderChapterTitle,
} from '@/ai/chapterTitle'
import { executeNovelTool, NOVEL_TOOLS, toolStatusLabel, toolsSystemHint } from '@/ai/tools'
import { REVISE_SYSTEM_PROMPT, wrapReviseUserPrompt } from '@/constants/revise'
import { builtinByMode, BUILTIN_TEMPLATES } from '@/constants/templates'
import { apiFetchTemplates } from '@/api/http'
import { localRepository } from '@/repository/localRepository'
import { storageGet, storageSet } from '@/repository/storage'
import { createId, type ChatMessage, type ChatMode, type OutlineRange, type PromptTemplate } from '@/types'
import { useAuthStore } from './auth'
import { useNovelStore } from './novel'
import { useSettingsStore } from './settings'

const MAX_TOOL_ROUNDS = 10

function resolveInitialTemplates(): PromptTemplate[] {
  return localRepository.getCachedPromptTemplates() || [...BUILTIN_TEMPLATES]
}

function resolveInitialSelectedId(list: PromptTemplate[]): string {
  const saved = localRepository.getSelectedTemplateId()
  if (saved && list.some((t) => t.id === saved)) return saved
  const chapter = list.find((t) => t.mode === 'chapter')
  return chapter?.id || builtinByMode('chapter').id
}

export type DraftSource = 'lastReply' | 'chapter' | 'none'

export interface ActivityLogItem {
  at: string
  text: string
  /** thinking：模型思考链；默认普通过程日志 */
  kind?: 'thinking' | 'info'
}

export const useChatStore = defineStore('chat', () => {
  const mode = ref<ChatMode>('chapter')
  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const toolStatus = ref('')
  /** 本轮生成过程日志（可再次打开查看） */
  const activityLog = ref<ActivityLogItem[]>([])
  /** 已开始向用户输出正文（用于自动收起日志弹框） */
  const outputStarted = ref(false)
  const injectOutline = ref(true)
  const injectLore = ref(storageGet<boolean>('injectLoreByKeyword', true))
  const outlineRange = ref<OutlineRange>({ type: 'continuity' })
  const templates = ref<PromptTemplate[]>(resolveInitialTemplates())
  const selectedTemplateId = ref(resolveInitialSelectedId(templates.value))
  const lastReply = ref('')
  const reviseMode = ref(storageGet<boolean>('reviseMode', false))
  const boundChapterId = ref<string | null>(null)

  let aborted = false
  let abortHandle: { abort: () => void } | null = null

  function pushActivity(text: string) {
    activityLog.value.push({ at: new Date().toISOString(), text, kind: 'info' })
    toolStatus.value = text
  }

  /**
   * 将思考增量写入日志：连续思考合并为最后一条 thinking 行，避免刷屏。
   */
  function appendThinking(delta: string) {
    if (!delta) return
    const list = activityLog.value
    const last = list[list.length - 1]
    if (last?.kind === 'thinking') {
      last.text += delta
      last.at = new Date().toISOString()
      toolStatus.value = '模型思考中…'
      return
    }
    list.push({
      at: new Date().toISOString(),
      text: delta,
      kind: 'thinking',
    })
    toolStatus.value = '模型思考中…'
  }

  function bindAbortHandle(handle: { abort: () => void }) {
    abortHandle = handle
  }

  function throwIfAborted() {
    if (aborted) throw new Error('已停止')
  }

  /**
   * 停止当前生成（中止网络请求并结束 loading）。
   */
  function stopGeneration() {
    if (!loading.value && !abortHandle) return
    aborted = true
    pushActivity('正在停止…')
    try {
      abortHandle?.abort()
    } catch {
      /* ignore */
    }
    abortHandle = null
  }

  const draftInfo = computed(() => {
    const novel = useNovelStore()
    if (lastReply.value.trim()) {
      return { source: 'lastReply' as DraftSource, text: lastReply.value }
    }
    const content = novel.currentChapter?.content?.trim() || ''
    if (content) {
      return { source: 'chapter' as DraftSource, text: content }
    }
    return { source: 'none' as DraftSource, text: '' }
  })

  function setReviseMode(on: boolean) {
    reviseMode.value = on
    storageSet('reviseMode', on)
  }

  function setInjectLore(on: boolean) {
    injectLore.value = on
    storageSet('injectLoreByKeyword', on)
  }

  function bindChapter(chapterId: string | null) {
    if (boundChapterId.value === chapterId) return
    const switching =
      boundChapterId.value !== null &&
      chapterId !== null &&
      boundChapterId.value !== chapterId
    const leaving = boundChapterId.value !== null && chapterId === null
    if (switching || leaving) {
      messages.value = []
      lastReply.value = ''
    }
    boundChapterId.value = chapterId
  }

  function applyTemplates(list: PromptTemplate[]) {
    templates.value = list
    const stillValid = list.some((t) => t.id === selectedTemplateId.value)
    if (!stillValid) {
      const forMode = list.find((t) => t.mode === mode.value) || list[0]
      selectedTemplateId.value = forMode?.id || builtinByMode(mode.value).id
    }
    localRepository.saveSelectedTemplateId(selectedTemplateId.value)
  }

  function selectTemplate(id: string) {
    selectedTemplateId.value = id
    localRepository.saveSelectedTemplateId(id)
  }

  function setMode(m: ChatMode) {
    mode.value = m
    const t = templates.value.find((x) => x.mode === m) || builtinByMode(m)
    selectTemplate(t.id)
  }

  async function loadTemplates(forceRemote = false) {
    const cached = localRepository.getCachedPromptTemplates()
    if (cached?.length && !forceRemote) {
      applyTemplates(cached)
    }

    const auth = useAuthStore()
    if (!auth.isLoggedIn || !auth.token) {
      if (!cached?.length) applyTemplates([...BUILTIN_TEMPLATES])
      return
    }

    try {
      const list = await apiFetchTemplates(auth.token)
      if (list?.length) {
        const mapped = list.map((t) => ({
          id: t.id,
          mode: t.mode as ChatMode,
          name: t.name,
          content: t.content,
          updatedAt: t.updatedAt,
        }))
        localRepository.saveCachedPromptTemplates(mapped)
        applyTemplates(mapped)
        return
      }
    } catch (e) {
      console.warn('拉取提示词失败，使用本地缓存/内置', e)
    }

    if (cached?.length) applyTemplates(cached)
    else applyTemplates([...BUILTIN_TEMPLATES])
  }

  function clearMessages() {
    messages.value = []
    lastReply.value = ''
    toolStatus.value = ''
    activityLog.value = []
    outputStarted.value = false
  }

  function prepareEditResend(messageId: string): string {
    if (loading.value) throw new Error('生成中，请稍候')
    const idx = messages.value.findIndex((m) => m.id === messageId)
    if (idx < 0) throw new Error('消息不存在')
    const msg = messages.value[idx]
    if (msg.role !== 'user') throw new Error('只能编辑用户消息')
    const content = msg.content
    messages.value = messages.value.slice(0, idx)
    const lastAsst = [...messages.value].reverse().find((m) => m.role === 'assistant')
    lastReply.value = lastAsst?.content || ''
    return content
  }

  function useAsDraft(messageId: string) {
    const msg = messages.value.find((m) => m.id === messageId)
    if (!msg || msg.role !== 'assistant' || !msg.content.trim()) {
      throw new Error('没有可用底稿')
    }
    lastReply.value = msg.content
    setReviseMode(true)
  }

  async function send(userText: string) {
    const settings = useSettingsStore()
    const novel = useNovelStore()
    if (!novel.currentNovelId) throw new Error('请先选择小说')

    if (novel.currentChapterId && boundChapterId.value !== novel.currentChapterId) {
      bindChapter(novel.currentChapterId)
    }

    const provider = settings.settings.defaultProvider
    const apiKey = settings.apiKeyFor(provider)
    const model = settings.settings.defaultModel
    const novelId = novel.currentNovelId

    const draft = draftInfo.value
    const useRevise = reviseMode.value && draft.source !== 'none'

    if (reviseMode.value && draft.source === 'none') {
      uni.showToast({ title: '无底稿，已按新创作发送', icon: 'none' })
    }

    aborted = false
    abortHandle = null
    activityLog.value = []
    outputStarted.value = false
    pushActivity('准备请求…')

    const systemParts: ChatCompletionMessage[] = []

    const writingTarget = resolveWritingTarget(novelId, novel.currentChapterId)
    pushActivity(`写作目标：${writingTarget.label}`)

    if (useRevise) {
      systemParts.push({ role: 'system', content: REVISE_SYSTEM_PROMPT })
      pushActivity('模式：修订')
    } else {
      const tpl =
        templates.value.find((t) => t.id === selectedTemplateId.value) ||
        builtinByMode(mode.value)
      systemParts.push({ role: 'system', content: tpl.content })
      pushActivity(`模式：${{ chapter: '章节', outline: '大纲', advice: '建议' }[mode.value]} · 模板「${tpl.name}」`)
    }

    systemParts.push({
      role: 'system',
      content: buildWritingTargetMessage(writingTarget, {
        revise: useRevise,
        draftSource: useRevise ? draft.source : undefined,
      }),
    })
    systemParts.push({
      role: 'system',
      content: toolsSystemHint(writingTarget.label),
    })

    const bibleText = novel.currentNovel?.meta?.bible?.trim()
    if (bibleText) {
      const bibleMsg = buildBibleInjectContent(bibleText)
      if (bibleMsg) {
        systemParts.push({ role: 'system', content: bibleMsg })
        pushActivity('已注入本书设定')
      }
    }

    const shouldInjectOutline =
      injectOutline.value && settings.settings.injectOutlineByDefault !== false
    if (shouldInjectOutline) {
      const range: OutlineRange = { ...outlineRange.value }
      if (range.type === 'current' || range.type === 'continuity') {
        range.currentChapterId = novel.currentChapterId || undefined
      }
      const ctx = buildOutlineContextMessage(novelId, range)
      if (ctx) {
        systemParts.push(ctx)
        pushActivity(`已注入大纲（${range.type}）`)
      } else {
        pushActivity('大纲注入：范围内无内容')
      }
    }

    const loreEnabled =
      injectLore.value && settings.settings.injectLoreByKeyword !== false
    if (loreEnabled) {
      const lore = buildLoreInjectMessage(novelId, userText)
      if (lore) {
        systemParts.push(lore)
        pushActivity('已按关键词注入设定卡')
      } else {
        pushActivity('设定卡：未命中关键词')
      }
    }

    if (useRevise) {
      const label = draft.source === 'lastReply' ? '最近生成' : '当前章正文'
      systemParts.push({
        role: 'system',
        content: `【底稿来源：${label}】\n【说明】以下整段即为写作目标章「${writingTarget.label}」的待修订正文，请只改这一篇，勿换成上一章。\n\n${draft.text}`,
      })
      pushActivity(`已附带底稿（${label}）→ ${writingTarget.label}`)
    }

    const displayUser = useRevise ? wrapReviseUserPrompt(userText) : userText

    messages.value.push({
      id: createId('m_'),
      role: 'user',
      content: useRevise ? `✎ 修订：${userText}` : userText,
      createdAt: new Date().toISOString(),
    })

    const history: ChatCompletionMessage[] = useRevise
      ? [{ role: 'user', content: displayUser }]
      : messages.value.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))

    const assistantId = createId('m_')
    messages.value.push({
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    })

    const setAssistantText = (text: string) => {
      const target = messages.value.find((m) => m.id === assistantId)
      if (target) target.content = text
    }

    const markOutputStarted = () => {
      if (outputStarted.value) return
      outputStarted.value = true
      pushActivity('开始输出正文…')
    }

    loading.value = true
    try {
      const apiMessages: ChatCompletionMessage[] = [...systemParts, ...history]
      let toolsOk = true

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        throwIfAborted()
        pushActivity(`工具轮询 ${round + 1}/${MAX_TOOL_ROUNDS}…`)
        let result
        try {
          result = await chatCompletionWithTools({
            provider,
            apiKey,
            model,
            messages: apiMessages,
            tools: NOVEL_TOOLS,
            tool_choice: 'auto',
            onAbortHandle: bindAbortHandle,
          })
        } catch (e) {
          throwIfAborted()
          // 厂商不支持 tools 等：降级为纯流式
          console.warn('tools 请求失败，降级无工具流式', e)
          pushActivity('工具调用不可用，改直接流式生成')
          toolsOk = false
          break
        }
        throwIfAborted()

        if (result.reasoning_content) {
          appendThinking(result.reasoning_content)
        }

        if (!result.tool_calls?.length) {
          // 即使本轮已带正文，也不在非流式里整包落地，改走下方流式以恢复边出边看
          pushActivity(
            result.content?.trim()
              ? '资料已齐，进入流式输出…'
              : '未调用工具，进入流式生成',
          )
          break
        }

        apiMessages.push({
          role: 'assistant',
          content: result.content || null,
          reasoning_content: result.reasoning_content || null,
          tool_calls: result.tool_calls,
        })

        for (const call of result.tool_calls) {
          throwIfAborted()
          const status = toolStatusLabel(call.function.name, call.function.arguments)
          pushActivity(status)
          const out = executeNovelTool(novelId, call.function.name, call.function.arguments)
          apiMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: out,
          })
          pushActivity(`${status.replace(/…$/, '')} · 完成`)
        }
      }

      throwIfAborted()
      pushActivity(toolsOk ? '流式生成正文…' : '流式生成…')
      setAssistantText('')

      const reply = await chatCompletionStream({
        provider,
        apiKey,
        model,
        messages: toolsOk
          ? [...apiMessages, { role: 'user', content: '请基于已有信息继续，直接输出最终正文或回答，勿再调用工具。' }]
          : [...systemParts, ...history],
        onAbortHandle: bindAbortHandle,
        onReasoning: (delta) => {
          appendThinking(delta)
        },
        onDelta: (_delta, fullText) => {
          if (fullText) markOutputStarted()
          setAssistantText(fullText)
          lastReply.value = fullText
        },
      })
      throwIfAborted()
      lastReply.value = reply
      setAssistantText(reply)
      pushActivity('生成完成')
      return reply
    } catch (e) {
      const msg = (e as Error).message || ''
      if (aborted || msg === '已停止') {
        pushActivity('已停止生成')
        const target = messages.value.find((m) => m.id === assistantId)
        if (target && !target.content.trim()) {
          messages.value = messages.value.filter((m) => m.id !== assistantId)
        }
        throw new Error('已停止')
      }
      const target = messages.value.find((m) => m.id === assistantId)
      if (target && !target.content) {
        messages.value = messages.value.filter((m) => m.id !== assistantId)
      }
      pushActivity(`失败：${msg || '未知错误'}`)
      throw e
    } finally {
      loading.value = false
      abortHandle = null
      toolStatus.value = ''
    }
  }

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
    bindChapter(cid)

    const provider = settings.settings.defaultProvider
    const apiKey = settings.apiKeyFor(provider)
    const model = settings.settings.defaultModel

    // 占位标题时用正文生成章名并写回（不覆盖用户自拟标题）
    const ch = localRepository.getChapter(cid)
    if (ch && isPlaceholderChapterTitle(ch.title, ch.order)) {
      try {
        const generated = await generateChapterTitleFromContent({
          content: lastReply.value,
          order: ch.order,
          provider,
          apiKey,
          model,
        })
        novel.saveChapterContent(cid, lastReply.value, generated)
      } catch (e) {
        console.warn('自动生成章节标题失败', e)
        uni.showToast({ title: '正文已保存，标题生成失败', icon: 'none' })
      }
    }

    if (settings.settings.autoMaintainOutline) {
      try {
        await maintainOutlineFromContent({
          chapterId: cid,
          provider,
          apiKey,
          model,
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

  function saveReplyAsOutline(chapterId?: string, title?: string) {
    const novel = useNovelStore()
    if (!lastReply.value) throw new Error('没有可保存的内容')

    let cid = chapterId
    if (!cid) {
      const c = novel.createChapter(title || `第${novel.chapters.length + 1}章`)
      cid = c.id
    }
    const summary = lastReply.value.slice(0, 500)
    // 按行拆成情节点，保留全部有效行（勿截断条数，避免缺情节）
    const beats = lastReply.value
      .split(/\n+/)
      .map((s) => s.replace(/^[\d\.\-\*\s]+/, '').trim())
      .filter(Boolean)
    novel.saveChapterOutline(cid, {
      summary,
      beats,
      characterStates: [],
      hangingThreads: [],
      notes: '',
      source: 'from_chat',
      updatedAt: new Date().toISOString(),
    })
    bindChapter(cid)
    return cid
  }

  return {
    mode,
    messages,
    loading,
    toolStatus,
    activityLog,
    outputStarted,
    injectOutline,
    injectLore,
    outlineRange,
    templates,
    selectedTemplateId,
    lastReply,
    reviseMode,
    boundChapterId,
    draftInfo,
    setReviseMode,
    setInjectLore,
    bindChapter,
    setMode,
    selectTemplate,
    loadTemplates,
    clearMessages,
    prepareEditResend,
    useAsDraft,
    send,
    stopGeneration,
    saveReplyAsContent,
    saveReplyAsOutline,
  }
})
