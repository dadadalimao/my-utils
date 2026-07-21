<template>
  <view class="page">
    <view class="toolbar">
      <view class="btn-primary" @click="onCreate">新建章节</view>
      <view class="btn-ghost" @click="goWorkbench">工作台</view>
    </view>
    <view
      v-for="ch in novel.chapters"
      :key="ch.id"
      class="card"
      @click="open(ch.id)"
    >
      <view class="title">第{{ ch.order }}章 · {{ ch.title }}</view>
      <view class="muted">{{ ch.outline.summary || '暂无大纲摘要' }}</view>
      <view class="row">
        <text class="link" @click.stop="selectAndWorkbench(ch.id)">去写作</text>
        <text class="danger" @click.stop="onDelete(ch.id)">删除</text>
      </view>
    </view>
    <view v-if="!novel.chapters.length" class="muted empty">暂无章节</view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { useNovelStore } from '@/stores/novel'

const novel = useNovelStore()

onShow(() => novel.refresh())

function onCreate() {
  uni.showModal({
    title: '新建章节',
    editable: true,
    placeholderText: '章节标题',
    success: (res) => {
      if (res.confirm) {
        const title = res.content?.trim() || `第${novel.chapters.length + 1}章`
        try {
          const c = novel.createChapter(title)
          uni.navigateTo({ url: `/pages/chapter-detail/index?id=${c.id}` })
        } catch (e) {
          uni.showToast({ title: (e as Error).message, icon: 'none' })
        }
      }
    },
  })
}

function open(id: string) {
  uni.navigateTo({ url: `/pages/chapter-detail/index?id=${id}` })
}

function selectAndWorkbench(id: string) {
  novel.selectChapter(id)
  uni.navigateTo({ url: '/pages/workbench/index' })
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

function goWorkbench() {
  uni.navigateTo({ url: '/pages/workbench/index' })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
}
.toolbar {
  display: flex;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.toolbar > view {
  flex: 1;
}
.title {
  font-weight: 600;
  margin-bottom: 8rpx;
}
.row {
  display: flex;
  gap: 24rpx;
  margin-top: 12rpx;
}
.link {
  color: #0f766e;
}
.danger {
  color: #b91c1c;
}
.empty {
  text-align: center;
  padding: 60rpx;
}
</style>
