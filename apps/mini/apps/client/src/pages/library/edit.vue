<template>
  <view class="page">
    <view class="card">
      <view class="label">标题</view>
      <input v-model="title" class="field" placeholder="如：原作·某角色背景" />

      <view class="label">关键词（用、分隔多个；也支持换行）</view>
      <textarea
        v-model="keywordsText"
        class="area"
        placeholder="如：鸣人、火影、木叶"
      />

      <view class="label">来源链接（可选）</view>
      <input v-model="sourceUrl" class="field" placeholder="https://…" />

      <view class="label">资料正文</view>
      <view class="hint muted">粘贴摘录、设定笔记或整理后的参考信息。</view>
      <textarea
        v-model="content"
        class="area tall"
        placeholder="资料内容…"
        :maxlength="20000"
      />
      <view class="input-meta">{{ content.length }}/20000</view>

      <view class="row">
        <view class="btn-primary" @click="onSave">保存</view>
        <view v-if="id" class="btn-ghost danger-btn" @click="onDelete">删除</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { localRepository } from '@/repository/localRepository'
import { useLibraryStore } from '@/stores/library'
import { useNovelStore } from '@/stores/novel'

const library = useLibraryStore()
const novel = useNovelStore()

const id = ref('')
const title = ref('')
const keywordsText = ref('')
const sourceUrl = ref('')
const content = ref('')

onLoad((query) => {
  if (query?.id) {
    id.value = query.id as string
    const entry = localRepository.getLibraryEntry(id.value)
    if (entry) {
      title.value = entry.title
      keywordsText.value = (entry.keywords || []).join('、')
      sourceUrl.value = entry.sourceUrl || ''
      content.value = entry.content || ''
      novel.selectNovel(entry.novelId)
    }
  }
})

function parseKeywords(text: string): string[] {
  return text
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function onSave() {
  try {
    if (!title.value.trim()) throw new Error('请填写标题')
    if (!content.value.trim()) throw new Error('请填写资料正文')
    const keys = parseKeywords(keywordsText.value)
    const entry = library.saveEntry({
      id: id.value || undefined,
      title: title.value.trim(),
      content: content.value.trim(),
      sourceUrl: sourceUrl.value.trim() || undefined,
      keywords: keys.length ? keys : [title.value.trim()],
    })
    id.value = entry.id
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onDelete() {
  if (!id.value) return
  uni.showModal({
    title: '删除',
    content: '确认删除此资料？',
    success: (res) => {
      if (res.confirm) {
        library.removeEntry(id.value)
        uni.navigateBack()
      }
    },
  })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
  padding-bottom: 48rpx;
}
.label {
  margin: 12rpx 0 8rpx;
  color: var(--color-text-secondary);
}
.field {
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
}
.area {
  width: 100%;
  min-height: 160rpx;
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
}
.area.tall {
  min-height: 360rpx;
}
.hint {
  font-size: 22rpx;
  margin-bottom: 8rpx;
  line-height: 1.5;
}
.input-meta {
  text-align: right;
  font-size: 22rpx;
  color: var(--color-text-muted);
  margin-top: 4rpx;
}
.row {
  display: flex;
  gap: 16rpx;
  margin-top: 28rpx;
}
.row > view {
  flex: 1;
}
.danger-btn {
  color: var(--color-danger);
  border-color: var(--color-danger);
}
</style>
