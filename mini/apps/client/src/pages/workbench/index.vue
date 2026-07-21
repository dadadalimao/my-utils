<template>
  <view class="page">
    <view class="card meta" v-if="novel.currentNovel">
      <text class="title">{{ novel.currentNovel.title }}</text>
      <view class="muted">当前章：{{ novel.currentChapter?.title || '未选择' }}</view>
    </view>
    <view v-else class="card muted">请先从小说列表进入</view>

    <view class="modes">
      <view
        v-for="m in modes"
        :key="m.id"
        class="mode"
        :class="{ active: chat.mode === m.id }"
        @click="chat.setMode(m.id)"
      >
        {{ m.label }}
      </view>
    </view>

    <view class="card">
      <view class="label">提示词模板</view>
      <picker :range="templateNames" @change="onTplChange">
        <view class="picker">{{ currentTplName }}</view>
      </picker>

      <view class="label row-between">
        <text>注入大纲</text>
        <switch :checked="chat.injectOutline" @change="onInjectChange" color="#0f766e" />
      </view>
      <view v-if="chat.injectOutline" class="range">
        <picker :range="rangeLabels" @change="onRangeType">
          <view class="picker">范围：{{ rangeLabels[rangeIndex] }}</view>
        </picker>
        <view v-if="chat.outlineRange.type === 'range'" class="range-inputs">
          <input v-model.number="fromOrder" type="number" placeholder="起始章序" />
          <input v-model.number="toOrder" type="number" placeholder="结束章序" />
          <view class="btn-ghost mini" @click="applyRange">应用区间</view>
        </view>
      </view>
    </view>

    <scroll-view scroll-y class="messages">
      <view v-for="msg in chat.messages" :key="msg.id" class="msg" :class="msg.role">
        <text>{{ msg.content }}</text>
      </view>
    </scroll-view>

    <view class="composer">
      <textarea v-model="input" class="input" placeholder="描述你的需求…" :disabled="chat.loading" />
      <view class="actions">
        <view class="btn-primary" :class="{ disabled: chat.loading }" @click="onSend">
          {{ chat.loading ? '生成中…' : '发送' }}
        </view>
        <view class="btn-ghost" @click="onSaveContent">保存正文</view>
        <view class="btn-ghost" @click="onSaveOutline">保存大纲</view>
        <view class="btn-ghost" @click="chat.clearMessages()">清空</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { ChatMode } from '@/types'
import { useChatStore } from '@/stores/chat'
import { useNovelStore } from '@/stores/novel'

const chat = useChatStore()
const novel = useNovelStore()
const input = ref('')
const fromOrder = ref(1)
const toOrder = ref(3)

const modes: { id: ChatMode; label: string }[] = [
  { id: 'chapter', label: '章节' },
  { id: 'outline', label: '大纲' },
  { id: 'advice', label: '建议' },
]

const rangeLabels = ['全书', '当前章', '自定义区间']
const rangeIndex = computed(() => {
  const t = chat.outlineRange.type
  if (t === 'current') return 1
  if (t === 'range') return 2
  return 0
})

const templateNames = computed(() =>
  chat.templates.filter((t) => t.mode === chat.mode).map((t) => t.name),
)
const currentTplName = computed(() => {
  const t = chat.templates.find((x) => x.id === chat.selectedTemplateId)
  return t?.name || '默认'
})

onMounted(() => {
  chat.loadTemplates()
})
onShow(() => {
  novel.refresh()
})

function onTplChange(e: { detail: { value: string } }) {
  const list = chat.templates.filter((t) => t.mode === chat.mode)
  const idx = Number(e.detail.value)
  if (list[idx]) chat.selectedTemplateId = list[idx].id
}

function onInjectChange(e: { detail: { value: boolean } }) {
  chat.injectOutline = e.detail.value
}

function onRangeType(e: { detail: { value: string } }) {
  const idx = Number(e.detail.value)
  if (idx === 1) chat.outlineRange = { type: 'current', currentChapterId: novel.currentChapterId || undefined }
  else if (idx === 2) chat.outlineRange = { type: 'range', fromOrder: fromOrder.value, toOrder: toOrder.value }
  else chat.outlineRange = { type: 'all' }
}

function applyRange() {
  chat.outlineRange = {
    type: 'range',
    fromOrder: Number(fromOrder.value) || 1,
    toOrder: Number(toOrder.value) || 1,
  }
  uni.showToast({ title: '已应用区间', icon: 'none' })
}

async function onSend() {
  const text = input.value.trim()
  if (!text || chat.loading) return
  try {
    await chat.send(text)
    input.value = ''
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '发送失败', icon: 'none' })
  }
}

async function onSaveContent() {
  try {
    await chat.saveReplyAsContent(novel.currentChapterId || undefined)
    uni.showToast({ title: '正文已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onSaveOutline() {
  try {
    chat.saveReplyAsOutline(novel.currentChapterId || undefined)
    uni.showToast({ title: '大纲已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 16rpx 24rpx 24rpx;
  box-sizing: border-box;
}
.meta .title {
  font-weight: 600;
  font-size: 30rpx;
}
.modes {
  display: flex;
  gap: 12rpx;
  margin-bottom: 12rpx;
}
.mode {
  flex: 1;
  text-align: center;
  padding: 16rpx;
  background: #fff;
  border-radius: 12rpx;
  color: #78716c;
}
.mode.active {
  background: #0f766e;
  color: #fff;
}
.label {
  margin: 12rpx 0 8rpx;
  color: #57534e;
}
.row-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.picker {
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
}
.range-inputs {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
  align-items: center;
}
.range-inputs input {
  flex: 1;
  background: #f5f5f4;
  padding: 12rpx;
  border-radius: 8rpx;
}
.mini {
  padding: 12rpx 16rpx;
  font-size: 24rpx;
}
.messages {
  flex: 1;
  margin: 12rpx 0;
}
.msg {
  margin-bottom: 16rpx;
  padding: 20rpx;
  border-radius: 12rpx;
  white-space: pre-wrap;
  background: #fff;
}
.msg.user {
  background: #ccfbf1;
}
.msg.assistant {
  background: #fff;
}
.composer .input {
  width: 100%;
  min-height: 140rpx;
  background: #fff;
  padding: 16rpx;
  border-radius: 12rpx;
  box-sizing: border-box;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 12rpx;
}
.actions > view {
  flex: 1;
  min-width: 140rpx;
  font-size: 24rpx;
  padding: 16rpx;
}
.disabled {
  opacity: 0.6;
}
</style>
