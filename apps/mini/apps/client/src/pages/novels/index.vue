<template>
  <view class="page">
    <view class="toolbar">
      <view class="btn-primary" @click="createSheetOpen = true">新建小说</view>
      <view class="btn-ghost" @click="goSettings">设置</view>
    </view>

    <view v-if="!novel.novels.length" class="empty muted">
      还没有小说。未登录也可本地创作，配置 Key 后即可对话生成。
    </view>

    <view
      v-for="item in novel.novels"
      :key="item.id"
      class="card"
      @click="openChapters(item.id)"
    >
      <view class="title-row">
        <view class="title">{{ item.title }}</view>
        <text class="mode-tag" :class="modeOf(item)">{{ modeLabel(item) }}</text>
      </view>
      <view class="muted">更新 {{ formatTime(item.updatedAt) }}</view>
      <view class="row">
        <text class="link" @click.stop="onRename(item.id, item.title)">重命名</text>
        <text class="danger" @click.stop="onDelete(item.id)">删除</text>
      </view>
    </view>

    <view v-if="createSheetOpen" class="mask" @click="createSheetOpen = false">
      <view class="sheet" @click.stop>
        <view class="sheet-title">新建小说</view>
        <view class="label">书名</view>
        <input v-model="newTitle" class="field" placeholder="书名" />

        <view class="label">写作模式</view>
        <view class="mode-options">
          <view
            class="mode-opt"
            :class="{ active: newMode === 'light' }"
            @click="newMode = 'light'"
          >
            <text class="mode-opt-name">轻量短篇</text>
            <text class="muted mode-opt-desc">自由写，不强制全书大纲</text>
          </view>
          <view
            class="mode-opt"
            :class="{ active: newMode === 'long' }"
            @click="newMode = 'long'"
          >
            <text class="mode-opt-name">长篇规范</text>
            <text class="muted mode-opt-desc">写正文前须全书大纲 + 章纲（建议 ≥50 万字）</text>
          </view>
        </view>

        <view v-if="newMode === 'long'" class="label">预计字数（可选）</view>
        <input
          v-if="newMode === 'long'"
          v-model.number="newTargetWords"
          class="field"
          type="number"
          placeholder="如 500000"
        />

        <view class="row sheet-actions">
          <view class="btn-primary" @click="confirmCreate">创建</view>
          <view class="btn-ghost" @click="createSheetOpen = false">取消</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { getWritingMode, type Novel, type WritingMode } from '@/types'
import { writingModeLabel } from '@/ai/writingGate'
import { useNovelStore } from '@/stores/novel'

const novel = useNovelStore()
novel.refresh()

const createSheetOpen = ref(false)
const newTitle = ref('')
const newMode = ref<WritingMode>('light')
const newTargetWords = ref(500000)

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function modeOf(item: Novel): WritingMode {
  return getWritingMode(item.meta)
}

function modeLabel(item: Novel) {
  return writingModeLabel(modeOf(item))
}

function confirmCreate() {
  const title = newTitle.value.trim() || '未命名小说'
  const opts =
    newMode.value === 'long'
      ? {
          writingMode: 'long' as const,
          targetWords: Number(newTargetWords.value) > 0 ? Number(newTargetWords.value) : 500000,
        }
      : { writingMode: 'light' as const }
  novel.createNovel(title, opts)
  createSheetOpen.value = false
  newTitle.value = ''
  newMode.value = 'light'
  uni.navigateTo({ url: '/pages/chapters/index' })
}

function openChapters(id: string) {
  novel.selectNovel(id)
  uni.navigateTo({ url: '/pages/chapters/index' })
}

function onRename(id: string, oldTitle: string) {
  uni.showModal({
    title: '重命名',
    editable: true,
    placeholderText: oldTitle,
    success: (res) => {
      if (res.confirm && res.content?.trim()) {
        novel.renameNovel(id, res.content.trim())
      }
    },
  })
}

function onDelete(id: string) {
  uni.showModal({
    title: '确认删除',
    content: '将删除该小说及全部章节（仅本地）',
    success: (res) => {
      if (res.confirm) novel.removeNovel(id)
    },
  })
}

function goSettings() {
  uni.navigateTo({ url: '/pages/settings/index' })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
}
.toolbar {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}
.toolbar .btn-primary,
.toolbar .btn-ghost {
  flex: 1;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 8rpx;
}
.title {
  font-size: 32rpx;
  font-weight: 600;
  flex: 1;
}
.mode-tag {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: var(--color-border);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
.mode-tag.long {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
.row {
  display: flex;
  gap: 24rpx;
  margin-top: 16rpx;
}
.link {
  color: var(--color-accent);
}
.danger {
  color: var(--color-danger);
}
.empty {
  padding: 80rpx 24rpx;
  text-align: center;
}
.mask {
  position: fixed;
  inset: 0;
  background: var(--color-mask);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  background: var(--color-surface);
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx;
  box-sizing: border-box;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}
.sheet-title {
  font-weight: 600;
  font-size: 32rpx;
  margin-bottom: 16rpx;
  text-align: center;
}
.label {
  margin: 16rpx 0 8rpx;
  color: var(--color-text-secondary);
}
.field {
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
}
.mode-options {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.mode-opt {
  padding: 20rpx;
  border-radius: 12rpx;
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
}
.mode-opt.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}
.mode-opt-name {
  font-weight: 600;
  display: block;
  margin-bottom: 4rpx;
}
.mode-opt-desc {
  font-size: 24rpx;
  line-height: 1.4;
}
.sheet-actions {
  margin-top: 28rpx;
}
.sheet-actions > view {
  flex: 1;
}
</style>
