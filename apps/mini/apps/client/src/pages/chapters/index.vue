<template>
  <view class="page">
    <view class="quick-nav-wrap" v-if="novel.currentNovel">
      <view class="quick-nav">
        <view class="quick-item" @click="goBookOutline">
          <text class="quick-text">全书大纲</text>
        </view>
        <view class="quick-item" @click="goBible">
          <text class="quick-text">本书设定</text>
        </view>
        <view class="quick-item" @click="goLore">
          <text class="quick-text">设定卡</text>
        </view>
        <view class="quick-item" @click="goLibrary">
          <text class="quick-text">资料库</text>
        </view>
      </view>
    </view>

    <view v-if="showMigrateBanner" class="card migrate-banner">
      <view class="migrate-title">可升级为长篇规范</view>
      <view class="muted migrate-desc">
        旧书当前为轻量模式。升级后写正文将强制全书大纲 + 章纲，设定卡支持本体/时间线。
      </view>
      <view class="row migrate-actions">
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
      <view v-if="outlineOpen" class="outline-preview muted">
        {{ ch.outline.summary?.trim() || '暂无大纲' }}
      </view>
      <view class="row">
        <text class="link" @click.stop="openDetail(ch.id)">查看/编辑</text>
        <text class="link" @click.stop="goReader(ch.id)">阅读</text>
        <text class="danger" @click.stop="onDelete(ch.id)">删除</text>
      </view>
    </view>
    <view v-if="!novel.chapters.length" class="muted empty">暂无章节，点右下角 + 开始创作</view>

    <view class="fab" @click="onCreate">
      <text class="fab-plus">+</text>
    </view>

    <!-- 左侧悬浮：阅读、大纲显隐、滚到底、滚到顶 -->
    <view v-if="novel.currentNovel" class="side-actions">
      <view class="capsule" @click="goReader()">
        <text class="cap-label">阅读</text>
      </view>
      <view class="capsule" :class="{ on: outlineOpen }" @click="toggleOutline">
        <view v-if="outlineOpen" class="chevron up" />
        <view v-else class="bars">
          <view class="bar" />
          <view class="bar" />
          <view class="bar short" />
        </view>
        <text class="cap-label">{{ outlineOpen ? '折叠' : '大纲' }}</text>
      </view>
      <view class="capsule" @click="scrollToBottom">
        <view class="chevron down" />
        <text class="cap-label">到底</text>
      </view>
      <view class="capsule" @click="scrollToTop">
        <view class="chevron up" />
        <text class="cap-label">到顶</text>
      </view>
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
/** 章节卡片上的大纲摘要，默认折叠 */
const outlineOpen = ref(false)

/** 折叠或展开各章大纲摘要 */
function toggleOutline() {
  outlineOpen.value = !outlineOpen.value
}

/** 目录滚到页面顶部 */
function scrollToTop() {
  uni.pageScrollTo({ scrollTop: 0, duration: 280 })
}

/** 目录滚到页面底部 */
function scrollToBottom() {
  uni.pageScrollTo({ scrollTop: 1000000, duration: 280 })
}

const isLong = computed(() => getWritingMode(novel.currentNovel?.meta) === 'long')

const showMigrateBanner = computed(() => {
  const n = novel.currentNovel
  if (!n) return false
  if (getWritingMode(n.meta) === 'long') return false
  if (n.meta?.migratedAt) return false
  return !dismissedIds.value.includes(n.id)
})

onShow(() => {
  novel.refresh()
  syncNavTitle()
})

/** 导航栏展示书名（原「章节列表」位置） */
function syncNavTitle() {
  const title = novel.currentNovel?.title?.trim()
  uni.setNavigationBarTitle({ title: title || '章节列表' })
}

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

/**
 * 进入阅读模式。传入章节则从该章开始，否则接着上次读到的章。
 */
function goReader(id?: string) {
  if (!novel.chapters.length) {
    uni.showToast({ title: '暂无章节', icon: 'none' })
    return
  }
  const q = id ? `?id=${id}` : ''
  uni.navigateTo({ url: `/pages/reader/index${q}` })
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
  padding-bottom: calc(340rpx + env(safe-area-inset-bottom));
  min-height: 100vh;
  box-sizing: border-box;
}
.quick-nav-wrap {
  position: sticky;
  top: 0;
  z-index: 50;
  margin: -24rpx -24rpx 20rpx;
  padding: 16rpx 24rpx 12rpx;
  background: var(--color-bg);
}
.quick-nav {
  display: flex;
  border-radius: 12rpx;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}
.quick-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 22rpx 8rpx;
  min-height: 72rpx;
  box-sizing: border-box;
}
.quick-item + .quick-item {
  border-left: 1px solid var(--color-border);
}
.quick-text {
  color: var(--color-accent);
  font-size: 26rpx;
  line-height: 1.2;
  text-align: center;
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
.migrate-actions {
  justify-content: space-between;
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
.outline-preview {
  margin-top: 4rpx;
  font-size: 24rpx;
  line-height: 1.5;
}
.row {
  display: flex;
  gap: 24rpx;
  margin-top: 12rpx;
  align-items: center;
}
.side-actions {
  position: fixed;
  left: 20rpx;
  bottom: calc(48rpx + env(safe-area-inset-bottom));
  z-index: 90;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.capsule {
  display: flex;
  align-items: center;
  gap: 8rpx;
  height: 64rpx;
  padding: 0 18rpx 0 14rpx;
  border-radius: 999rpx;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: 0 8rpx 20rpx var(--color-fab-shadow);
  box-sizing: border-box;
}
.capsule.on {
  background: var(--color-accent);
  border-color: var(--color-accent);
}
.cap-label {
  font-size: 24rpx;
  line-height: 1;
  font-weight: 600;
  color: var(--color-accent);
}
.capsule.on .cap-label {
  color: var(--color-primary-contrast);
}
.bars {
  width: 22rpx;
  height: 18rpx;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex-shrink: 0;
}
.bar {
  height: 3rpx;
  border-radius: 2rpx;
  background: var(--color-accent);
}
.bar.short {
  width: 14rpx;
}
.chevron {
  width: 14rpx;
  height: 14rpx;
  flex-shrink: 0;
  border-right: 3rpx solid var(--color-accent);
  border-bottom: 3rpx solid var(--color-accent);
  box-sizing: border-box;
}
.chevron.down {
  transform: rotate(45deg);
  margin-top: -6rpx;
}
.chevron.up {
  transform: rotate(-135deg);
  margin-top: 6rpx;
}
.capsule.on .chevron {
  border-color: var(--color-primary-contrast);
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
