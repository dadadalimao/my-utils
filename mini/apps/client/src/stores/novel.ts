import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { localRepository } from '@/repository/localRepository'
import type { Chapter, Novel } from '@/types'

export const useNovelStore = defineStore('novel', () => {
  const novels = ref<Novel[]>([])
  const currentNovelId = ref<string | null>(null)
  const chapters = ref<Chapter[]>([])
  const currentChapterId = ref<string | null>(null)

  const currentNovel = computed(() =>
    novels.value.find((n) => n.id === currentNovelId.value),
  )
  const currentChapter = computed(() =>
    chapters.value.find((c) => c.id === currentChapterId.value),
  )

  function refresh() {
    novels.value = localRepository.listNovels()
    currentNovelId.value = localRepository.getCurrentNovelId()
    if (currentNovelId.value) {
      chapters.value = localRepository.listChapters(currentNovelId.value)
    } else {
      chapters.value = []
    }
  }

  function selectNovel(id: string) {
    localRepository.setCurrentNovelId(id)
    currentNovelId.value = id
    chapters.value = localRepository.listChapters(id)
    currentChapterId.value = chapters.value[0]?.id ?? null
  }

  function createNovel(title: string) {
    const n = localRepository.createNovel(title)
    refresh()
    selectNovel(n.id)
    return n
  }

  function renameNovel(id: string, title: string) {
    localRepository.updateNovel(id, { title })
    refresh()
  }

  function removeNovel(id: string) {
    localRepository.deleteNovel(id)
    refresh()
  }

  function createChapter(title: string) {
    if (!currentNovelId.value) throw new Error('请先选择小说')
    const c = localRepository.createChapter(currentNovelId.value, title)
    chapters.value = localRepository.listChapters(currentNovelId.value)
    currentChapterId.value = c.id
    return c
  }

  function selectChapter(id: string) {
    currentChapterId.value = id
  }

  function saveChapterContent(id: string, content: string) {
    localRepository.updateChapter(id, { content })
    chapters.value = localRepository.listChapters(currentNovelId.value!)
  }

  function saveChapterOutline(
    id: string,
    outline: Chapter['outline'],
    title?: string,
  ) {
    localRepository.updateChapter(id, {
      outline: { ...outline, source: outline.source || 'manual', updatedAt: new Date().toISOString() },
      ...(title ? { title } : {}),
    })
    chapters.value = localRepository.listChapters(currentNovelId.value!)
  }

  function removeChapter(id: string) {
    localRepository.deleteChapter(id)
    chapters.value = localRepository.listChapters(currentNovelId.value!)
    if (currentChapterId.value === id) {
      currentChapterId.value = chapters.value[0]?.id ?? null
    }
  }

  refresh()

  return {
    novels,
    currentNovelId,
    chapters,
    currentChapterId,
    currentNovel,
    currentChapter,
    refresh,
    selectNovel,
    createNovel,
    renameNovel,
    removeNovel,
    createChapter,
    selectChapter,
    saveChapterContent,
    saveChapterOutline,
    removeChapter,
  }
})
