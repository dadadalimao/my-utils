<template>
  <view class="page">
    <view class="card head" v-if="novel.currentNovel">
      <view class="title">{{ novel.currentNovel.title }} · 资料库</view>
      <view class="muted hint">
        存放同人/原作参考资料（摘录、角色背景、来源链接等）。写作时可按关键词注入，也可由 AI 工具查阅。
      </view>
    </view>

    <view class="toolbar">
      <view class="btn-primary" @click="onCreate">新建资料</view>
    </view>

    <view v-for="e in library.entries" :key="e.id" class="card" @click="openEdit(e.id)">
      <view class="name">{{ e.title }}</view>
      <view class="muted">关键词：{{ (e.keywords || []).join('、') || '无' }}</view>
      <view v-if="e.sourceUrl" class="muted source">来源：{{ e.sourceUrl }}</view>
      <view class="preview">
        {{ (e.content || '').slice(0, 80)
        }}{{ (e.content || '').length > 80 ? '…' : '' }}
      </view>
      <view class="row">
        <text class="link" @click.stop="openEdit(e.id)">编辑</text>
        <text class="danger" @click.stop="onDelete(e.id)">删除</text>
      </view>
    </view>
    <view v-if="!library.entries.length" class="muted empty">暂无资料，点击上方新建</view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { useLibraryStore } from '@/stores/library'
import { useNovelStore } from '@/stores/novel'

const library = useLibraryStore()
const novel = useNovelStore()

onShow(() => {
  novel.refresh()
  library.refresh()
})

function onCreate() {
  uni.navigateTo({ url: '/pages/library/edit' })
}

function openEdit(id: string) {
  uni.navigateTo({ url: `/pages/library/edit?id=${id}` })
}

function onDelete(id: string) {
  uni.showModal({
    title: '删除资料',
    content: '确认删除？',
    success: (res) => {
      if (res.confirm) library.removeEntry(id)
    },
  })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
  padding-bottom: 48rpx;
}
.head .title {
  font-weight: 600;
  font-size: 30rpx;
  margin-bottom: 8rpx;
}
.hint {
  font-size: 24rpx;
  line-height: 1.5;
}
.toolbar {
  display: flex;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.toolbar > view {
  flex: 1;
  font-size: 26rpx;
  padding: 16rpx;
}
.name {
  font-weight: 600;
  margin-bottom: 8rpx;
}
.source {
  font-size: 22rpx;
  margin-top: 4rpx;
  word-break: break-all;
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
</style>
