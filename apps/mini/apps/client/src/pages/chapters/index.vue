<template>
  <view class="page">
    <view class="header" v-if="novel.currentNovel">
      <text class="book">{{ novel.currentNovel.title }}</text>
      <view class="header-links">
        <text class="link" @click="goBookOutline">全书大纲</text>
        <text class="link" @click="goBible">本书设定</text>
        <text class="link" @click="goLore">设定卡</text>
        <text class="link" @click="goLibrary">资料库</text>
      </view>
    </view>

    <view v-if="showMigrateBanner" class="card migrate-banner">
      <view class="migrate-title">可升级为长篇规范</view>
      <view class="muted migrate-desc">
        旧书当前为轻量模式。升级后写正文将强制全书大纲 + 章纲，设定卡支持本体/时间线。
      </view>
      <view class="row">
        <view class="btn-primary mini-btn" @click="goMigrate">升级向导</view>
        <text class="link" @click="dismissMigrate">暂不提示</text>
      </view>
    </view>

    <view v-if="isLong" class="card mode-bar">
      <text class="mode-pill">长篇规范</text>
      <text class="muted" v-if="novel.currentNovel?.meta?.targetWords">
        预计 {{ novel.currentNovel.meta.targetWords }} 字
      </text>
      <text class="link" @click="switchToLight">改回轻量</text>
    </view>

    <view
      v-for="ch in novel.chapters"
      :key="ch.id"
      class="card"
      @click="goWorkbench(ch.id)"
    >
      <view class="title-row">
        <text class="title">第{{ ch.order }}章 · {{ ch.title }}</text>
        <text v-if="ch.id === novel.currentChapterId" class="tag">当前</text>
      </view>
      <view class="muted">
        {{ ch.outline.summary || (ch.content ? `正文 ${ch.content.length} 字` : '暂无内容') }}
      </view>
      <view class="row">
        <text class="link" @click.stop="openDetail(ch.id)">查看/编辑</text>
        <text class="danger" @click.stop="onDelete(ch.id)">删除</text>
      </view>
    </view>
    <view v-if="!novel.chapters.length" class="muted empty">暂无章节，点右下角 + 开始创作</view>

    <view class="fab" @click="onCreate">
      <text class="fab-plus">+</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getWritingMode } from '@/types'
import { storageGet, storageSet } from '@/repository/storage'
import { useNovelStore } from '@/stores/novel'

const novel = useNovelStore()
const dismissedIds = ref<string[]>(storageGet<string[]>('migrateBannerDismissed', []))

const isLong = computed(() => getWritingMode(novel.currentNovel?.meta) === 'long')

const showMigrateBanner = computed(() => {
  const n = novel.currentNovel
  if (!n) return false
  if (getWritingMode(n.meta) === 'long') return false
  if (n.meta?.migratedAt) return false
  return !dismissedIds.value.includes(n.id)
})

onShow(() => novel.refresh())

function onCreate() {
  uni.showModal({
    title: '新章节创作',
    editable: true,
    placeholderText: '章节标题（可留空）',
    success: (res) => {
      if (!res.confirm) return
      const title = res.content?.trim() || `第${novel.chapters.length + 1}章`
      try {
        const c = novel.createChapter(title)
        novel.selectChapter(c.id)
        uni.navigateTo({ url: '/pages/workbench/index' })
      } catch (e) {
        uni.showToast({ title: (e as Error).message, icon: 'none' })
      }
    },
  })
}

function goWorkbench(id: string) {
  novel.selectChapter(id)
  uni.navigateTo({ url: '/pages/workbench/index' })
}

function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/chapter-detail/index?id=${id}` })
}

function goLore() {
  uni.navigateTo({ url: '/pages/lore/index' })
}

function goLibrary() {
  uni.navigateTo({ url: '/pages/library/index' })
}

function goBible() {
  uni.navigateTo({ url: '/pages/bible/index' })
}

function goBookOutline() {
  uni.navigateTo({ url: '/pages/book-outline/index' })
}

function goMigrate() {
  uni.navigateTo({ url: '/pages/migrate/index' })
}

function dismissMigrate() {
  const id = novel.currentNovelId
  if (!id) return
  if (!dismissedIds.value.includes(id)) {
    dismissedIds.value = [...dismissedIds.value, id]
    storageSet('migrateBannerDismissed', dismissedIds.value)
  }
}

function switchToLight() {
  if (!novel.currentNovelId) return
  uni.showModal({
    title: '改回轻量模式',
    content: '将取消长篇写正文门禁；全书大纲与设定卡时间线数据会保留。',
    success: (res) => {
      if (!res.confirm || !novel.currentNovelId) return
      novel.updateNovelMeta(novel.currentNovelId, { writingMode: 'light' })
      uni.showToast({ title: '已改为轻量', icon: 'success' })
    },
  })
}

function onDelete(id: string) {
  uni.showModal({
    title: '删除章节',
    content: '确认删除？',
    success: (res) => {
      if (res.confirm) novel.removeChapter(id)
    },
  })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
  padding-bottom: 200rpx;
  min-height: 100vh;
  box-sizing: border-box;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
  gap: 12rpx;
}
.header-links {
  display: flex;
  gap: 16rpx;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.book {
  font-weight: 600;
  font-size: 32rpx;
  flex: 1;
  margin-right: 16rpx;
}
.migrate-banner {
  border: 1px solid var(--color-warning);
  background: var(--color-warning-bg);
  margin-bottom: 16rpx;
}
.migrate-title {
  font-weight: 600;
  margin-bottom: 8rpx;
}
.migrate-desc {
  font-size: 24rpx;
  line-height: 1.5;
  margin-bottom: 12rpx;
}
.mini-btn {
  display: inline-flex;
  padding: 12rpx 24rpx;
  font-size: 26rpx;
}
.mode-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 16rpx;
  flex-wrap: wrap;
}
.mode-pill {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 8rpx;
}
.title {
  font-weight: 600;
  flex: 1;
}
.tag {
  font-size: 22rpx;
  color: var(--color-accent);
  background: var(--color-accent-soft);
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.row {
  display: flex;
  gap: 24rpx;
  margin-top: 12rpx;
  align-items: center;
}
.link {
  color: var(--color-accent);
}
.danger {
  color: var(--color-danger);
}
.empty {
  text-align: center;
  padding: 80rpx 24rpx;
}
.fab {
  position: fixed;
  right: 40rpx;
  bottom: calc(48rpx + env(safe-area-inset-bottom));
  width: 128rpx;
  height: 128rpx;
  border-radius: 64rpx;
  background: var(--color-primary);
  box-shadow: 0 12rpx 32rpx var(--color-fab-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.fab-plus {
  color: var(--color-primary-contrast);
  font-size: 80rpx;
  line-height: 1;
  font-weight: 300;
  margin-top: -6rpx;
}
</style>
