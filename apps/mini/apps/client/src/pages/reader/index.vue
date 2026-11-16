<template>
  <view class="page">
    <scroll-view
      scroll-y
      class="scroller"
      :scroll-top="scrollTop"
      scroll-with-animation
    >
      <view v-if="chapter" class="article">
        <view class="head">
          <text class="title">第{{ chapter.order }}章 · {{ chapter.title }}</text>
          <text class="muted meta">{{ wordCount }} 字</text>
        </view>
        <view v-if="body" class="body" user-select selectable>{{ body }}</view>
        <view v-else class="muted empty">本章暂无正文</view>

        <view v-if="nextChapter" class="next-card" @click="goNext">
          <text class="next-label">下一章</text>
          <text class="next-title">第{{ nextChapter.order }}章 · {{ nextChapter.title }}</text>
        </view>
        <view v-else class="muted end">已是最后一章</view>
      </view>
      <view v-else class="muted empty">没有可阅读的章节</view>
    </scroll-view>

    <view class="dock">
      <view class="btn-ghost" :class="{ disabled: !prevChapter }" @click="goPrev">上一章</view>
      <view class="btn-ghost" @click="goCatalog">目录</view>
      <view class="btn-ghost" :class="{ disabled: !nextChapter }" @click="goNext">下一章</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { storageGet, storageSet } from '@/repository/storage'
import { useNovelStore } from '@/stores/novel'

const novel = useNovelStore()
const chapterId = ref('')
const scrollTop = ref(0)

const chapter = computed(() =>
  novel.chapters.find((c) => c.id === chapterId.value) || null,
)
const idx = computed(() =>
  novel.chapters.findIndex((c) => c.id === chapterId.value),
)
const prevChapter = computed(() =>
  idx.value > 0 ? novel.chapters[idx.value - 1] : null,
)
const nextChapter = computed(() =>
  idx.value >= 0 && idx.value < novel.chapters.length - 1
    ? novel.chapters[idx.value + 1]
    : null,
)
const body = computed(() => chapter.value?.content?.trim() || '')
const wordCount = computed(() => body.value.length)

function progressKey(novelId: string) {
  return `readerProgress:${novelId}`
}

/** 记下当前读到哪一章，下次从目录点阅读接着看 */
function saveProgress() {
  const nid = novel.currentNovelId
  if (!nid || !chapterId.value) return
  storageSet(progressKey(nid), chapterId.value)
}

function syncTitle() {
  const ch = chapter.value
  uni.setNavigationBarTitle({
    title: ch ? `第${ch.order}章` : '阅读',
  })
}

function resetScroll() {
  scrollTop.value = scrollTop.value === 0 ? 0.01 : 0
}

/**
 * 打开指定章；滚回顶部并记下进度。
 */
function openChapter(id: string) {
  if (!id || !novel.chapters.some((c) => c.id === id)) {
    uni.showToast({ title: '章节不存在', icon: 'none' })
    return
  }
  chapterId.value = id
  novel.selectChapter(id)
  saveProgress()
  syncTitle()
  resetScroll()
}

function goPrev() {
  const prev = prevChapter.value
  if (!prev) {
    uni.showToast({ title: '已是第一章', icon: 'none' })
    return
  }
  openChapter(prev.id)
}

function goNext() {
  const next = nextChapter.value
  if (!next) {
    uni.showToast({ title: '已是最后一章', icon: 'none' })
    return
  }
  openChapter(next.id)
}

function goCatalog() {
  uni.navigateBack({
    fail: () => {
      uni.redirectTo({ url: '/pages/chapters/index' })
    },
  })
}

function resolveStartId(queryId?: string): string {
  const list = novel.chapters
  if (!list.length) return ''
  if (queryId && list.some((c) => c.id === queryId)) return queryId
  const nid = novel.currentNovelId
  const saved = nid ? storageGet<string>(progressKey(nid), '') : ''
  if (saved && list.some((c) => c.id === saved)) return saved
  if (novel.currentChapterId && list.some((c) => c.id === novel.currentChapterId)) {
    return novel.currentChapterId
  }
  return list[0].id
}

onLoad((query) => {
  novel.refresh()
  openChapter(resolveStartId(query?.id as string | undefined))
})

onShow(() => {
  novel.refresh()
  if (chapterId.value) {
    syncTitle()
  }
})
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  background: var(--color-bg);
}
.scroller {
  flex: 1;
  height: 0;
}
.article {
  padding: 32rpx 36rpx 48rpx;
}
.head {
  margin-bottom: 28rpx;
  padding-bottom: 20rpx;
  border-bottom: 1px solid var(--color-border);
}
.title {
  display: block;
  font-size: 36rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--color-text);
}
.meta {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
}
.body {
  font-size: 32rpx;
  line-height: 1.9;
  color: var(--color-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.empty,
.end {
  text-align: center;
  padding: 80rpx 24rpx;
}
.next-card {
  margin-top: 64rpx;
  padding: 28rpx 24rpx;
  border-radius: 16rpx;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
.next-label {
  display: block;
  font-size: 22rpx;
  color: var(--color-text-muted);
  margin-bottom: 8rpx;
}
.next-title {
  font-size: 28rpx;
  color: var(--color-accent);
  font-weight: 600;
}
.dock {
  display: flex;
  gap: 12rpx;
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
}
.dock .btn-ghost {
  flex: 1;
  padding: 16rpx 8rpx;
  font-size: 26rpx;
  margin: 0;
}
.disabled {
  opacity: 0.4;
}
</style>
