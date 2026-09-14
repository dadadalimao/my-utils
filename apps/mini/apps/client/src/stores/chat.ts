import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { chatAnthropicWithTools } from '@/ai/anthropicDeepseek'
import {
  chatCompletion,
  chatCompletionWithTools,
  type ChatCompletionMessage,
} from '@/ai/client'
import { buildBookOutlineInjectContent } from '@/ai/bookOutline'
import { chapterOutputFormatHint, parseChapterFence } from '@/ai/chapterFence'
import { buildBibleInjectContent } from '@/ai/novelBible'
import { buildLibraryInjectMessage } from '@/ai/libraryInject'
import { buildLoreInjectMessage } from '@/ai/loreInject'
import {
  buildOutlineContextMessage,
  buildWritingTargetMessage,
  resolveWritingTarget,
} from '@/ai/outlineInject'
import { maintainOutlineFromContent } from '@/ai/outlineMaintain'
import { checkWritingGate } from '@/ai/writingGate'
import {
  generateChapterTitleFromContent,
  isPlaceholderChapterTitle,
} from '@/ai/chapterTitle'
import {
  executeNovelTool,
  MAX_NOVEL_TOOL_ROUNDS,
  ADOPT_TOOL_ROUND_CONTENT_MIN,
  NOVEL_TOOLS,
  classifyToolRoundError,
  messagesHaveToolResults,
  runDeepseekAnthropicToolRounds,
  toolRoundFallbackActivity,
  toolStatusLabel,
  toolsSystemHint,
} from '@/ai/tools'
import { REVISE_SYSTEM_PROMPT, wrapReviseUserPrompt } from '@/constants/revise'
import { builtinByMode, BUILTIN_TEMPLATES } from '@/constants/templates'
import { apiFetchTemplates } from '@/api/http'
import { localRepository } from '@/repository/localRepository'
import { storageGet, storageSet } from '@/repository/storage'
import {
  createId,
  getWritingMode,
  type ChatMessage,
  type ChatMode,
  type OutlineRange,
  type PromptTemplate,
} from '@/types'
import { useAuthStore } from './auth'
import { useNovelStore } from './novel'
import { useSettingsStore } from './settings'

const MAX_TOOL_ROUNDS = MAX_NOVEL_TOOL_ROUNDS

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
  /** 建议弹框独立会话，不污染正文/大纲对话 */
  const adviceMessages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const toolStatus = ref('')
  /** 本轮生成过程日志（可再次打开查看） */
  const activityLog = ref<ActivityLogItem[]>([])
  /** 已开始向用户输出正文（用于自动收起日志弹框） */
  const outputStarted = ref(false)
  const injectOutline = ref(true)
  const injectLore = ref(storageGet<boolean>('injectLoreByKeyword', true))
  const injectLibrary = ref(storageGet<boolean>('injectLibraryByKeyword', true))
  /** 会话级 DeepSeek 联网；默认跟随设置 */
  const webSearch = ref(
    storageGet<boolean | null>('webSearchSession', null) ??
      localRepository.getSettings().enableDeepseekWebSearch === true,
  )
  const outlineRange = ref<OutlineRange>({ type: 'continuity' })
  const templates = ref<PromptTemplate[]>(resolveInitialTemplates())
  const selectedTemplateId = ref(resolveInitialSelectedId(templates.value))
  const selectedAdviceTemplateId = ref(
    templates.value.find((t) => t.mode === 'advice')?.id || builtinByMode('advice').id,
  )
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

  function setInjectLibrary(on: boolean) {
    injectLibrary.value = on
    storageSet('injectLibraryByKeyword', on)
  }

  function setWebSearch(on: boolean) {
    webSearch.value = on
    storageSet('webSearchSession', on)
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
      const forMode =
        list.find((t) => t.mode === mode.value && t.mode !== 'advice') ||
        list.find((t) => t.mode === 'chapter') ||
        list[0]
      selectedTemplateId.value = forMode?.id || builtinByMode('chapter').id
    }
    localRepository.saveSelectedTemplateId(selectedTemplateId.value)

    const adviceOk = list.some((t) => t.id === selectedAdviceTemplateId.value && t.mode === 'advice')
    if (!adviceOk) {
      selectedAdviceTemplateId.value =
        list.find((t) => t.mode === 'advice')?.id || builtinByMode('advice').id
    }
  }

  function selectTemplate(id: string) {
    selectedTemplateId.value = id
    localRepository.saveSelectedTemplateId(id)
  }

  function selectAdviceTemplate(id: string) {
    selectedAdviceTemplateId.value = id
  }

  function setMode(m: ChatMode) {
    // 建议已独立弹框，工作台模式仅章节/大纲
    if (m === 'advice') {
      mode.value = 'chapter'
      const t = templates.value.find((x) => x.mode === 'chapter') || builtinByMode('chapter')
      selectTemplate(t.id)
      return
    }
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

  function clearAdviceMessages() {
    adviceMessages.value = []
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

  function prepareAdviceEditResend(messageId: string): string {
    if (loading.value) throw new Error('生成中，请稍候')
    const idx = adviceMessages.value.findIndex((m) => m.id === messageId)
    if (idx < 0) throw new Error('消息不存在')
    const msg = adviceMessages.value[idx]
    if (msg.role !== 'user') throw new Error('只能编辑用户消息')
    const content = msg.content
    adviceMessages.value = adviceMessages.value.slice(0, idx)
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

  /**
   * 发送对话。channel=advice 走建议弹框独立会话（可用工具、不写正文底稿）。
   */
  async function send(userText: string, options?: { channel?: 'main' | 'advice' }) {
    const isAdvice = options?.channel === 'advice'
    const settings = useSettingsStore()
    const novel = useNovelStore()
    if (!novel.currentNovelId) throw new Error('请先选择小说')

    if (novel.currentChapterId && boundChapterId.value !== novel.currentChapterId) {
      bindChapter(novel.currentChapterId)
    }

    const provider = settings.settings.defaultProvider
    const apiKey = settings.apiKeyFor(provider)
    const model = settings.settings.defaultModel
    const thinkingEffort = settings.settings.thinkingEffort || 'low'
    const novelId = novel.currentNovelId
    const chatMode: ChatMode = isAdvice ? 'advice' : mode.value

    const draft = draftInfo.value
    const useRevise = !isAdvice && reviseMode.value && draft.source !== 'none'

    if (!isAdvice && reviseMode.value && draft.source === 'none') {
      uni.showToast({ title: '无底稿，已按新创作发送', icon: 'none' })
    }

    const gate = checkWritingGate({
      novel: novel.currentNovel,
      currentChapterId: novel.currentChapterId,
      chatMode,
      revise: useRevise,
    })
    if (!gate.ok) {
      await new Promise<void>((resolve) => {
        uni.showModal({
          title: '长篇规范未满足',
          content: gate.message,
          confirmText: gate.navigateTo ? '去完善' : '知道了',
          showCancel: !!gate.navigateTo,
          success: (res) => {
            if (res.confirm && gate.navigateTo) {
              uni.navigateTo({ url: gate.navigateTo })
            }
            resolve()
          },
          fail: () => resolve(),
        })
      })
      throw new Error(gate.message)
    }

    aborted = false
    abortHandle = null
    activityLog.value = []
    outputStarted.value = false
    pushActivity('准备请求…')
    if (provider === 'deepseek') {
      pushActivity(
        `思考强度：${
          { off: '关闭', low: '轻', high: '标准', max: '最大' }[thinkingEffort]
        }`,
      )
    }

    const systemParts: ChatCompletionMessage[] = []

    const writingTarget = resolveWritingTarget(novelId, novel.currentChapterId)
    pushActivity(isAdvice ? `咨询锚定：${writingTarget.label}` : `写作目标：${writingTarget.label}`)

    if (useRevise) {
      systemParts.push({ role: 'system', content: REVISE_SYSTEM_PROMPT })
      pushActivity('模式：修订')
    } else if (isAdvice) {
      const tpl =
        templates.value.find((t) => t.id === selectedAdviceTemplateId.value) ||
        builtinByMode('advice')
      systemParts.push({ role: 'system', content: tpl.content })
      pushActivity(`模式：编辑建议 · 模板「${tpl.name}」`)
    } else {
      const tpl =
        templates.value.find((t) => t.id === selectedTemplateId.value) ||
        builtinByMode(mode.value)
      systemParts.push({ role: 'system', content: tpl.content })
      pushActivity(
        `模式：${{ chapter: '章节', outline: '大纲', advice: '建议' }[mode.value]} · 模板「${tpl.name}」`,
      )
    }

    if (isAdvice) {
      systemParts.push({
        role: 'system',
        content: [
          `【编辑咨询上下文】当前关注：${writingTarget.label}`,
          '请以资深小说编辑身份发言：诊断问题、给出可执行改法与示例短句；不要代写整章正文或整章大纲。',
          '可调用工具核对设定/大纲/前文后再给建议，避免臆造已有内容。',
        ].join('\n'),
      })
    } else {
      systemParts.push({
        role: 'system',
        content: buildWritingTargetMessage(writingTarget, {
          revise: useRevise,
          draftSource: useRevise ? draft.source : undefined,
        }),
      })
    }

    const useDeepseekWeb =
      provider === 'deepseek' && webSearch.value === true

    systemParts.push({
      role: 'system',
      content: toolsSystemHint(writingTarget.label, {
        webSearch: useDeepseekWeb,
        advice: isAdvice,
      }),
    })
    if (useDeepseekWeb) pushActivity('已开启 DeepSeek 联网搜索')

    /** 章节写作/修订：强制 ```chapter 正文格式，便于拆分思考与落库 */
    const useChapterFence = !isAdvice && (mode.value === 'chapter' || useRevise)
    if (useChapterFence) {
      systemParts.push({ role: 'system', content: chapterOutputFormatHint() })
    }

    const bibleText = novel.currentNovel?.meta?.bible?.trim()
    if (bibleText) {
      const bibleMsg = buildBibleInjectContent(bibleText)
      if (bibleMsg) {
        systemParts.push({ role: 'system', content: bibleMsg })
        pushActivity('已注入本书设定')
      }
    }

    if (getWritingMode(novel.currentNovel?.meta) === 'long') {
      const bookMsg = buildBookOutlineInjectContent(
        novel.currentNovel?.meta?.bookOutline || '',
      )
      if (bookMsg) {
        systemParts.push({ role: 'system', content: bookMsg })
        pushActivity('已注入全书大纲')
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
      const lore = buildLoreInjectMessage(novelId, userText, {
        asOfOrder: writingTarget.order,
      })
      if (lore) {
        systemParts.push(lore)
        pushActivity('已按关键词注入设定卡')
      } else {
        pushActivity('设定卡：未命中关键词')
      }
    }

    const libraryEnabled =
      injectLibrary.value && settings.settings.injectLibraryByKeyword !== false
    if (libraryEnabled) {
      const lib = buildLibraryInjectMessage(novelId, userText)
      if (lib) {
        systemParts.push(lib)
        pushActivity('已按关键词注入资料库')
      } else {
        pushActivity('资料库：未命中关键词')
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
    const thread = isAdvice ? adviceMessages : messages

    thread.value.push({
      id: createId('m_'),
      role: 'user',
      content: useRevise ? `✎ 修订：${userText}` : userText,
      createdAt: new Date().toISOString(),
    })

    const history: ChatCompletionMessage[] = useRevise
      ? [{ role: 'user', content: displayUser }]
      : thread.value.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        }))

    const assistantId = createId('m_')
    thread.value.push({
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    })

    const setAssistantText = (text: string) => {
      const target = thread.value.find((m) => m.id === assistantId)
      if (target) target.content = text
    }

    const setAssistantAnalysis = (text: string) => {
      const target = thread.value.find((m) => m.id === assistantId)
      if (target) target.analysis = text || undefined
    }

    const markOutputStarted = () => {
      if (outputStarted.value) return
      outputStarted.value = true
      pushActivity(isAdvice ? '开始输出建议…' : '开始输出正文…')
    }

    /**
     * 定稿写入气泡与 lastReply。
     * 章节模式：```chapter 内为正文（可落库）；块外为分析说明（气泡特殊样式展示）。
     */
    const commitFinalReply = (raw: string): string => {
      const trimmed = (raw || '').trim()
      if (!trimmed) throw new Error('AI 返回为空')

      if (!useChapterFence) {
        markOutputStarted()
        setAssistantAnalysis('')
        setAssistantText(trimmed)
        if (!isAdvice) lastReply.value = trimmed
        pushActivity('生成完成')
        return trimmed
      }

      const { body, preface, hadFence } = parseChapterFence(trimmed)
      if (!hadFence) {
        pushActivity('未检测到 ```chapter 标记，整段当作正文')
      }
      const finalBody = body.trim() || trimmed
      const analysis = preface.trim()
      markOutputStarted()
      setAssistantAnalysis(analysis)
      setAssistantText(finalBody)
      lastReply.value = finalBody
      if (analysis) {
        pushActivity('已拆出分析/检索说明（仅展示，不落库）')
      }
      pushActivity('生成完成')
      return finalBody
    }

    const finalNudge = isAdvice
      ? '请基于已有信息继续，直接输出编辑建议，勿再调用工具，勿代写整章正文。'
      : useChapterFence
        ? [
            '请基于已有信息继续，勿再调用工具。',
            '分析说明可写在代码块外；最终完整正文必须包在：',
            '```chapter',
            '（完整正文）',
            '```',
          ].join('\n')
        : '请基于已有信息继续，直接输出最终正文或回答，勿再调用工具。'

    loading.value = true
    try {
      const apiMessages: ChatCompletionMessage[] = [...systemParts, ...history]
      let toolsOk = true

      // DeepSeek 联网：Anthropic 端点 + web_search；失败降级 OpenAI tools
      if (useDeepseekWeb) {
        try {
          pushActivity('使用 DeepSeek 联网通道…')
          const anth = await runDeepseekAnthropicToolRounds({
            novelId,
            apiKey,
            model,
            messages: apiMessages,
            maxRounds: MAX_TOOL_ROUNDS,
            defaultAsOfOrder: writingTarget.order,
            // 工具轮关闭思考；正式生成再用用户设置的思考强度
            thinkingEffort: 'off',
            onActivity: pushActivity,
            onThinking: appendThinking,
            onAbortHandle: bindAbortHandle,
          })
          throwIfAborted()
          const anthReady = anth.lastText.trim()
          // 效率优先：工具轮已写出正文则直接采用，不再强制二次生成
          if (anthReady.length >= ADOPT_TOOL_ROUND_CONTENT_MIN) {
            pushActivity('资料已齐，采用本轮正文…')
            return commitFinalReply(anthReady)
          }
          pushActivity(isAdvice ? '生成建议…' : '生成正文…')
          setAssistantText('')
          const final = await chatAnthropicWithTools({
            apiKey,
            model,
            system: anth.system,
            messages: [
              ...anth.messages,
              { role: 'user', content: finalNudge },
            ],
            tools: [],
            max_tokens: 16384,
            thinkingEffort,
            onAbortHandle: bindAbortHandle,
          })
          throwIfAborted()
          const reply = (final.text || anthReady).trim()
          if (!reply) throw new Error('AI 返回为空')
          if (final.thinking) appendThinking(final.thinking)
          return commitFinalReply(reply)
        } catch (e) {
          throwIfAborted()
          console.warn('DeepSeek 联网失败，降级 OpenAI 工具轮', e)
          pushActivity('联网不可用，改用本地工具通道…')
        }
      }

      /** 工具轮已产出、可直接采用的正文 */
      let adoptedFromTools = ''

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
            // 工具轮关闭思考，避免非流式长考触顶超时
            thinkingEffort: 'off',
            onAbortHandle: bindAbortHandle,
          })
        } catch (e) {
          throwIfAborted()
          const kind = classifyToolRoundError(e)
          const keepContext = kind !== 'unsupported' && messagesHaveToolResults(apiMessages)
          const errMsg = e instanceof Error ? e.message : String(e || '')
          console.warn(
            'tools 请求失败',
            kind,
            keepContext ? '保留已查资料' : '丢弃工具上下文',
            e,
          )
          pushActivity(toolRoundFallbackActivity(kind, keepContext, errMsg))
          // 仅「不支持 tools」或尚无工具结果时丢弃上下文；超时等则带着已查资料继续生成
          toolsOk = keepContext
          break
        }
        throwIfAborted()

        if (result.reasoning_content) {
          appendThinking(result.reasoning_content)
        }

        if (!result.tool_calls?.length) {
          const text = (result.content || '').trim()
          if (text.length >= ADOPT_TOOL_ROUND_CONTENT_MIN) {
            // 模型已在工具轮写完正文：直接采用，避免再请求一轮
            pushActivity('资料已齐，采用本轮正文…')
            adoptedFromTools = text
          } else {
            pushActivity(
              text ? '资料已齐，补全生成…' : '未调用工具，开始生成…',
            )
          }
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
          const out = executeNovelTool(
            novelId,
            call.function.name,
            call.function.arguments,
            { defaultAsOfOrder: writingTarget.order },
          )
          apiMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: out,
          })
          pushActivity(`${status.replace(/…$/, '')} · 完成`)
        }
      }

      throwIfAborted()

      if (adoptedFromTools) {
        return commitFinalReply(adoptedFromTools)
      }

      pushActivity(
        toolsOk
          ? isAdvice
            ? '生成建议…'
            : '生成正文…'
          : '生成（无工具上下文）…',
      )
      setAssistantText('')

      const reply = await chatCompletion({
        provider,
        apiKey,
        model,
        thinkingEffort,
        messages: toolsOk
          ? [...apiMessages, { role: 'user', content: finalNudge }]
          : [...systemParts, ...history],
        onAbortHandle: bindAbortHandle,
      })
      throwIfAborted()
      return commitFinalReply(reply)
    } catch (e) {
      const msg = (e as Error).message || ''
      if (aborted || msg === '已停止') {
        pushActivity('已停止生成')
        const target = thread.value.find((m) => m.id === assistantId)
        if (target && !target.content.trim()) {
          thread.value = thread.value.filter((m) => m.id !== assistantId)
        }
        throw new Error('已停止')
      }
      const target = thread.value.find((m) => m.id === assistantId)
      if (target && !target.content) {
        thread.value = thread.value.filter((m) => m.id !== assistantId)
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

    // 兜底：若气泡里仍含 fence，落库只取代码块内正文
    const contentToSave = parseChapterFence(lastReply.value).body.trim() || lastReply.value

    let cid = chapterId
    if (!cid) {
      const c = novel.createChapter(title || `第${novel.chapters.length + 1}章`)
      cid = c.id
    }
    novel.saveChapterContent(cid, contentToSave)
    bindChapter(cid)
    lastReply.value = contentToSave

    const provider = settings.settings.defaultProvider
    const apiKey = settings.apiKeyFor(provider)
    const model = settings.settings.defaultModel

    // 占位标题时用正文生成章名并写回（不覆盖用户自拟标题）
    const ch = localRepository.getChapter(cid)
    if (ch && isPlaceholderChapterTitle(ch.title, ch.order)) {
      try {
        const generated = await generateChapterTitleFromContent({
          content: contentToSave,
          order: ch.order,
          provider,
          apiKey,
          model,
        })
        novel.saveChapterContent(cid, contentToSave, generated)
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
    adviceMessages,
    loading,
    toolStatus,
    activityLog,
    outputStarted,
    injectOutline,
    injectLore,
    injectLibrary,
    webSearch,
    outlineRange,
    templates,
    selectedTemplateId,
    selectedAdviceTemplateId,
    lastReply,
    reviseMode,
    boundChapterId,
    draftInfo,
    setReviseMode,
    setInjectLore,
    setInjectLibrary,
    setWebSearch,
    bindChapter,
    setMode,
    selectTemplate,
    selectAdviceTemplate,
    loadTemplates,
    clearMessages,
    clearAdviceMessages,
    prepareEditResend,
    prepareAdviceEditResend,
    useAsDraft,
    send,
    stopGeneration,
    saveReplyAsContent,
    saveReplyAsOutline,
  }
})
