import { defineStore } from 'pinia'
import { ref } from 'vue'
import { localRepository } from '@/repository/localRepository'
import type { LibraryEntry } from '@/types'
import { useNovelStore } from './novel'

export const useLibraryStore = defineStore('library', () => {
  const entries = ref<LibraryEntry[]>([])

  function refresh(novelId?: string | null) {
    const nid = novelId ?? useNovelStore().currentNovelId
    entries.value = nid ? localRepository.listLibraryEntries(nid) : []
  }

  function saveEntry(input: {
    id?: string
    title: string
    content: string
    sourceUrl?: string
    keywords: string[]
  }) {
    const novel = useNovelStore()
    if (!novel.currentNovelId) throw new Error('请先选择小说')
    const entry = localRepository.saveLibraryEntry({
      ...input,
      novelId: novel.currentNovelId,
    })
    refresh(novel.currentNovelId)
    return entry
  }

  function removeEntry(id: string) {
    localRepository.deleteLibraryEntry(id)
    refresh()
  }

  return {
    entries,
    refresh,
    saveEntry,
    removeEntry,
  }
})
