<template>
  <view class="page">
    <view class="toolbar">
      <view class="btn-primary" @click="onCreate">新建小说</view>
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
      <view class="title">{{ item.title }}</view>
      <view class="muted">更新 {{ formatTime(item.updatedAt) }}</view>
      <view class="row">
        <text class="link" @click.stop="onRename(item.id, item.title)">重命名</text>
        <text class="danger" @click.stop="onDelete(item.id)">删除</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { useNovelStore } from '@/stores/novel'

const novel = useNovelStore()
novel.refresh()

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function onCreate() {
  uni.showModal({
    title: '新建小说',
    editable: true,
    placeholderText: '书名',
    success: (res) => {
      if (res.confirm) {
        const title = (res.content || '').trim() || '未命名小说'
        novel.createNovel(title)
        uni.navigateTo({ url: '/pages/chapters/index' })
      }
    },
  })
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
.title {
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 8rpx;
}
.row {
  display: flex;
  gap: 24rpx;
  margin-top: 16rpx;
}
.link {
  color: #0f766e;
}
.danger {
  color: #b91c1c;
}
.empty {
  padding: 80rpx 24rpx;
  text-align: center;
}
</style>
