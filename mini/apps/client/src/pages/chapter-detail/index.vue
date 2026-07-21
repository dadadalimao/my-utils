<template>
  <view class="page" v-if="chapter">
    <view class="tabs">
      <view :class="{ active: tab === 'content' }" @click="tab = 'content'">正文</view>
      <view :class="{ active: tab === 'outline' }" @click="tab = 'outline'">大纲</view>
    </view>

    <view v-if="tab === 'content'" class="card">
      <input v-model="title" class="title-input" placeholder="章节标题" />
      <textarea v-model="content" class="editor" placeholder="正文章节内容" />
      <view class="btn-primary" @click="saveContent">保存正文</view>
    </view>

    <view v-else class="card">
      <view class="label">摘要 summary</view>
      <textarea v-model="summary" class="small" />
      <view class="label">情节点 beats（每行一条）</view>
      <textarea v-model="beatsText" class="small" />
      <view class="label">备注 notes（自动维护不会覆盖）</view>
      <textarea v-model="notes" class="small" />
      <view class="btn-primary" @click="saveOutline">保存大纲</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { localRepository } from '@/repository/localRepository'
import { useNovelStore } from '@/stores/novel'
import type { Chapter } from '@/types'

const novel = useNovelStore()
const chapter = ref<Chapter | null>(null)
const tab = ref<'content' | 'outline'>('content')
const title = ref('')
const content = ref('')
const summary = ref('')
const beatsText = ref('')
const notes = ref('')

onLoad((query) => {
  const id = query?.id as string
  const ch = localRepository.getChapter(id)
  if (!ch) {
    uni.showToast({ title: '章节不存在', icon: 'none' })
    return
  }
  chapter.value = ch
  novel.selectNovel(ch.novelId)
  novel.selectChapter(ch.id)
  title.value = ch.title
  content.value = ch.content
  summary.value = ch.outline.summary
  beatsText.value = (ch.outline.beats || []).join('\n')
  notes.value = ch.outline.notes || ''
})

function saveContent() {
  if (!chapter.value) return
  if (content.value.length > 80000) {
    uni.showToast({ title: '正文过长，请考虑拆章', icon: 'none' })
  }
  localRepository.updateChapter(chapter.value.id, {
    title: title.value.trim() || chapter.value.title,
    content: content.value,
  })
  novel.refresh()
  uni.showToast({ title: '已保存', icon: 'success' })
}

function saveOutline() {
  if (!chapter.value) return
  novel.saveChapterOutline(
    chapter.value.id,
    {
      summary: summary.value.trim(),
      beats: beatsText.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      notes: notes.value,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    },
    title.value.trim(),
  )
  uni.showToast({ title: '大纲已保存', icon: 'success' })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
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
  background: #fff;
  border-radius: 12rpx;
}
.tabs .active {
  background: #0f766e;
  color: #fff;
}
.title-input {
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
  padding: 12rpx;
  background: #f5f5f4;
  border-radius: 8rpx;
}
.editor {
  width: 100%;
  min-height: 520rpx;
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
  margin-bottom: 16rpx;
}
.small {
  width: 100%;
  min-height: 160rpx;
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
  margin-bottom: 16rpx;
}
.label {
  margin: 8rpx 0;
  color: #57534e;
}
</style>
