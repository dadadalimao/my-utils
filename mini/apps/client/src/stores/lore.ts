import { defineStore } from 'pinia'
import { ref } from 'vue'
import { applyLoreOps, extractLoreOpsFromChapter } from '@/ai/loreExtract'
import { localRepository } from '@/repository/localRepository'
import { storageGet, storageRemove, storageSet } from '@/repository/storage'
import type { LoreCard, LoreCardKind, LoreCardOp } from '@/types'
import { useNovelStore } from './novel'
import { useSettingsStore } from './settings'

const PENDING_KEY = 'loreExtractPending'

export interface LoreExtractPending {
  novelId: string
  chapterId: string
  chapterTitle: string
  ops: LoreCardOp[]
}

export const useLoreStore = defineStore('lore', () => {
  const cards = ref<LoreCard[]>([])

  function refresh(novelId?: string | null) {
    const nid = novelId ?? useNovelStore().currentNovelId
    cards.value = nid ? localRepository.listLoreCards(nid) : []
  }

  function listByKind(kind: LoreCardKind) {
    return cards.value.filter((c) => c.kind === kind)
  }

  function saveCard(input: {
    id?: string
    kind: LoreCardKind
    name: string
    keywords: string[]
    content: string
  }) {
    const novel = useNovelStore()
    if (!novel.currentNovelId) throw new Error('请先选择小说')
    const card = localRepository.saveLoreCard({
      ...input,
      novelId: novel.currentNovelId,
    })
    refresh(novel.currentNovelId)
    return card
  }

  function removeCard(id: string) {
    localRepository.deleteLoreCard(id)
    refresh()
  }

  function getPending(): LoreExtractPending | null {
    return storageGet<LoreExtractPending | null>(PENDING_KEY, null)
  }

  function setPending(p: LoreExtractPending | null) {
    if (!p) storageRemove(PENDING_KEY)
    else storageSet(PENDING_KEY, p)
  }

  /**
   * 根据章节正文抽取设定卡，写入待确认缓存并跳转确认页。
   */
  async function startExtractFromChapter(chapterId: string) {
    const novel = useNovelStore()
    const settings = useSettingsStore()
    if (!novel.currentNovelId) throw new Error('请先选择小说')
    const ch = localRepository.getChapter(chapterId)
    if (!ch) throw new Error('章节不存在')

    const provider = settings.settings.defaultProvider
    const { ops } = await extractLoreOpsFromChapter({
      novelId: novel.currentNovelId,
      chapterId,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })

    if (!ops.length) {
      throw new Error('未识别到可更新的人物/道具')
    }

    setPending({
      novelId: novel.currentNovelId,
      chapterId,
      chapterTitle: `第${ch.order}章 ${ch.title}`,
      ops,
    })
    return ops.length
  }

  function confirmPending(ops: LoreCardOp[]) {
    const pending = getPending()
    if (!pending) throw new Error('没有待确认的设定卡')
    applyLoreOps(pending.novelId, ops)
    setPending(null)
    refresh(pending.novelId)
  }

  return {
    cards,
    refresh,
    listByKind,
    saveCard,
    removeCard,
    getPending,
    setPending,
    startExtractFromChapter,
    confirmPending,
  }
})
