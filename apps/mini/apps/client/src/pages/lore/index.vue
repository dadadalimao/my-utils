<template>
  <view class="page">
    <view class="tabs">
      <view :class="{ active: tab === 'character' }" @click="tab = 'character'">人物卡</view>
      <view :class="{ active: tab === 'item' }" @click="tab = 'item'">道具卡</view>
    </view>

    <view class="toolbar">
      <view class="btn-primary" @click="onCreate">新建</view>
      <view class="btn-ghost" :class="{ disabled: !extractChapterId }" @click="onExtractCurrent">
        根据本章更新
      </view>
    </view>
    <!-- 展示具体章节，点击可切换分析目标 -->
    <picker
      v-if="chapterLabels.length"
      :range="chapterLabels"
      :value="extractChapterIndex"
      @change="onExtractChapter"
    >
      <view class="chapter-pick">
        <text class="chapter-label">分析章节</text>
        <text class="chapter-value">{{ extractChapterTitle }} ›</text>
      </view>
    </picker>
    <view v-else class="chapter-pick muted">暂无章节，请先创作</view>

    <view v-for="c in filtered" :key="c.id" class="card" @click="openEdit(c.id)">
      <view class="name">{{ c.name }}</view>
      <view class="muted">关键词：{{ (c.keywords || []).join('、') || '无' }}</view>
      <view class="preview">{{ (c.core || c.content || '').slice(0, 80) }}{{ (c.core || c.content || '').length > 80 ? '…' : '' }}</view>
      <view v-if="c.states?.length" class="muted">时间线 {{ c.states.length }} 个阶段</view>
      <view class="row">
        <text class="link" @click.stop="openEdit(c.id)">编辑</text>
        <text class="danger" @click.stop="onDelete(c.id)">删除</text>
      </view>
    </view>
    <view v-if="!filtered.length" class="muted empty">暂无{{ tab === 'character' ? '人物' : '道具' }}卡</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { LoreCardKind } from '@/types'
import { useLoreStore } from '@/stores/lore'
import { useNovelStore } from '@/stores/novel'

const lore = useLoreStore()
const novel = useNovelStore()
const tab = ref<LoreCardKind>('character')
/** 设定抽取目标章；默认跟随 novel.currentChapterId */
const extractChapterId = ref('')

const filtered = computed(() => lore.listByKind(tab.value))

const chapterLabels = computed(() =>
  novel.chapters.map((c) => `第${c.order}章 · ${c.title}`),
)

const extractChapterIndex = computed(() => {
  const idx = novel.chapters.findIndex((c) => c.id === extractChapterId.value)
  return idx >= 0 ? idx : 0
})

const extractChapterTitle = computed(() => {
  const ch = novel.chapters.find((c) => c.id === extractChapterId.value)
  if (!ch) return '请选择章节'
  return `第${ch.order}章 · ${ch.title}`
})

onShow(() => {
  novel.refresh()
  lore.refresh()
  syncExtractChapter()
})

/** 无本地选择或章节已删时，回落到当前章 / 首章 */
function syncExtractChapter() {
  const list = novel.chapters
  if (!list.length) {
    extractChapterId.value = ''
    return
  }
  if (list.some((c) => c.id === extractChapterId.value)) return
  extractChapterId.value = novel.currentChapterId || list[0].id
}

function onExtractChapter(e: { detail: { value: string } }) {
  const idx = Number(e.detail.value)
  const ch = novel.chapters[idx]
  if (!ch) return
  extractChapterId.value = ch.id
  novel.selectChapter(ch.id)
}

function onCreate() {
  uni.navigateTo({ url: `/pages/lore/edit?kind=${tab.value}` })
}

function openEdit(id: string) {
  uni.navigateTo({ url: `/pages/lore/edit?id=${id}` })
}

function onDelete(id: string) {
  uni.showModal({
    title: '删除设定卡',
    content: '确认删除？',
    success: (res) => {
      if (res.confirm) lore.removeCard(id)
    },
  })
}

async function onExtractCurrent() {
  if (!extractChapterId.value) {
    uni.showToast({ title: '请先选择章节', icon: 'none' })
    return
  }
  try {
    uni.showLoading({ title: '分析设定中', mask: true })
    await lore.startExtractFromChapter(extractChapterId.value)
    uni.hideLoading()
    uni.navigateTo({ url: '/pages/lore/review' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '分析失败', icon: 'none' })
  }
}
</script>

<style scoped>
.page {
  padding: 24rpx;
  padding-bottom: 48rpx;
}
.tabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.tabs > view {
  flex: 1;
  text-align: center;
  padding: 16rpx;
  background: var(--color-surface);
  border-radius: 12rpx;
  color: var(--color-text-muted);
}
.tabs .active {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}
.toolbar {
  display: flex;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.toolbar > view {
  flex: 1;
  font-size: 26rpx;
  padding: 16rpx;
}
.chapter-pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  background: var(--color-surface);
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 16rpx;
}
.chapter-label {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: 26rpx;
}
.chapter-value {
  flex: 1;
  text-align: right;
  color: var(--color-accent);
  font-size: 26rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name {
  font-weight: 600;
  margin-bottom: 8rpx;
}
.preview {
  margin-top: 8rpx;
  color: var(--color-text-secondary);
  font-size: 26rpx;
  white-space: pre-wrap;
}
.row {
  display: flex;
  gap: 24rpx;
  margin-top: 12rpx;
}
.link {
  color: var(--color-accent);
}
.danger {
  color: var(--color-danger);
}
.empty {
  text-align: center;
  padding: 60rpx;
}
.disabled {
  opacity: 0.5;
}
</style>
