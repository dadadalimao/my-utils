<template>
  <view class="page">
    <view class="header" v-if="novel.currentNovel">
      <text class="book">{{ novel.currentNovel.title }}</text>
      <view class="header-links">
        <text class="link" @click="goBible">本书设定</text>
        <text class="link" @click="goLore">设定卡</text>
      </view>
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

    <!-- 右下角巨大 + ：新建章节并进入工作台 -->
    <view class="fab" @click="onCreate">
      <text class="fab-plus">+</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { useNovelStore } from '@/stores/novel'

const novel = useNovelStore()

onShow(() => novel.refresh())

/** 新建章节 → 工作台创作 */
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

/** 点章节 → 进入工作台 */
function goWorkbench(id: string) {
  novel.selectChapter(id)
  uni.navigateTo({ url: '/pages/workbench/index' })
}

/** 查看/修改正文与大纲 */
function openDetail(id: string) {
  uni.navigateTo({ url: `/pages/chapter-detail/index?id=${id}` })
}

function goLore() {
  uni.navigateTo({ url: '/pages/lore/index' })
}

function goBible() {
  uni.navigateTo({ url: '/pages/bible/index' })
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
  gap: 20rpx;
  flex-shrink: 0;
}
.book {
  font-weight: 600;
  font-size: 32rpx;
  flex: 1;
  margin-right: 16rpx;
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
  color: #0f766e;
  background: #ccfbf1;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
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
  padding: 80rpx 24rpx;
}
.fab {
  position: fixed;
  right: 40rpx;
  bottom: calc(48rpx + env(safe-area-inset-bottom));
  width: 128rpx;
  height: 128rpx;
  border-radius: 64rpx;
  background: #0f766e;
  box-shadow: 0 12rpx 32rpx rgba(15, 118, 110, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.fab-plus {
  color: #fff;
  font-size: 80rpx;
  line-height: 1;
  font-weight: 300;
  margin-top: -6rpx;
}
</style>
