<template>
  <view class="page" v-if="novel.currentNovel">
    <view class="card head">
      <view class="title">{{ novel.currentNovel.title }} · 本书设定</view>
      <view class="muted hint">
        世界观、道具品质、高潮符号惯例等写在这里；写作时会自动注入。点标签可插入【分节】。
      </view>
    </view>

    <view class="card">
      <view class="label">快速插入标签</view>
      <view class="tags">
        <view
          v-for="tag in tags"
          :key="tag"
          class="tag"
          @click="onInsertTag(tag)"
        >
          【{{ tag }}】
        </view>
      </view>

      <view class="label">设定正文</view>
      <textarea
        v-model="bible"
        class="area ai-prompt-input"
        :placeholder="biblePlaceholder"
        :maxlength="20000"
      />
      <view class="input-meta">{{ bible.length }}/20000</view>

      <view class="label">AI 辅助（可选）</view>
      <textarea
        v-model="assistPrompt"
        class="area small ai-prompt-input"
        :placeholder="assistPlaceholder"
        :maxlength="4000"
        :disabled="busy"
      />
      <view class="row">
        <view class="btn-ghost" :class="{ disabled: busy }" @click="onAssist">
          {{ assisting ? '辅助中…' : 'AI 辅助撰写' }}
        </view>
        <view class="btn-primary" :class="{ disabled: busy }" @click="onSave">
          {{ saving ? '保存中…' : '保存（自动格式化）' }}
        </view>
      </view>
    </view>

    <view v-if="preview" class="mask" @click="preview = null">
      <view class="panel" @click.stop>
        <view class="panel-title">{{ preview.title }}</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ preview.text }}</view>
        </scroll-view>
        <view class="row">
          <view class="btn-primary" @click="applyPreview">采用</view>
          <view class="btn-ghost" @click="preview = null">取消</view>
        </view>
      </view>
    </view>
  </view>
  <view v-else class="muted empty">请先选择小说</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import {
  assistNovelBible,
  BIBLE_TAGS,
  formatNovelBible,
  insertBibleTag,
} from '@/ai/novelBible'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'

const novel = useNovelStore()
const settings = useSettingsStore()
const bible = ref('')
const assistPrompt = ref('')
const assisting = ref(false)
const saving = ref(false)
const preview = ref<{ title: string; text: string } | null>(null)

const tags = BIBLE_TAGS
const busy = computed(() => assisting.value || saving.value)
/** 小程序 WXML 属性不能含真实换行，placeholder 放脚本里 */
const biblePlaceholder =
  '点上方标签插入【分节】，例如：世界观、道具品质、高潮惯例…'
const assistPlaceholder =
  '例如：补全品质色与词条习惯；高潮符号惯例；力量体系写清楚…'

onShow(() => {
  novel.refresh()
  bible.value = novel.currentNovel?.meta?.bible || ''
})

function onInsertTag(tag: string) {
  bible.value = insertBibleTag(bible.value, tag)
}

async function onAssist() {
  if (busy.value) return
  if (!novel.currentNovelId) {
    uni.showToast({ title: '请先选择小说', icon: 'none' })
    return
  }
  try {
    assisting.value = true
    uni.showLoading({ title: 'AI 辅助中', mask: true })
    const provider = settings.settings.defaultProvider
    const text = await assistNovelBible({
      current: bible.value,
      userPrompt: assistPrompt.value,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })
    preview.value = { title: '确认采用 AI 辅助结果', text }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    assisting.value = false
    uni.hideLoading()
  }
}

function applyPreview() {
  if (!preview.value) return
  bible.value = preview.value.text
  preview.value = null
  uni.showToast({ title: '已写入编辑区，可再保存', icon: 'none' })
}

async function onSave() {
  if (busy.value || !novel.currentNovelId) return
  const raw = bible.value.trim()
  if (!raw) {
    persist('')
    return
  }
  try {
    saving.value = true
    uni.showLoading({ title: '格式化并保存', mask: true })
    const provider = settings.settings.defaultProvider
    const formatted = await formatNovelBible({
      text: raw,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })
    bible.value = formatted
    persist(formatted)
  } catch (e) {
    uni.hideLoading()
    saving.value = false
    uni.showModal({
      title: '格式化失败',
      content: `${(e as Error).message || '未知错误'}。是否仍保存当前原文？`,
      success: (res) => {
        if (res.confirm) persist(raw)
      },
    })
    return
  } finally {
    saving.value = false
    uni.hideLoading()
  }
}

function persist(text: string) {
  if (!novel.currentNovelId) return
  try {
    novel.updateNovelMeta(novel.currentNovelId, { bible: text })
    bible.value = text
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}
</script>

<style scoped>
.page {
  padding: 24rpx;
  padding-bottom: 48rpx;
}
.head .title {
  font-weight: 600;
  font-size: 32rpx;
  margin-bottom: 8rpx;
}
.hint {
  line-height: 1.5;
}
.label {
  margin: 12rpx 0 8rpx;
  color: #57534e;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 8rpx;
}
.tag {
  padding: 10rpx 16rpx;
  background: #ccfbf1;
  color: #0f766e;
  border-radius: 8rpx;
  font-size: 24rpx;
}
.area {
  width: 100%;
  min-height: 420rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
  background-color: #ccfbf1;
}
.area.small {
  min-height: 140rpx;
}
.input-meta {
  text-align: right;
  font-size: 22rpx;
  color: #a8a29e;
  margin: 8rpx 0 16rpx;
}
.row {
  display: flex;
  gap: 16rpx;
  margin-top: 8rpx;
}
.row > view {
  flex: 1;
}
.disabled {
  opacity: 0.6;
}
.empty {
  padding: 80rpx;
  text-align: center;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(28, 25, 23, 0.45);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
  box-sizing: border-box;
}
.panel {
  width: 100%;
  max-height: 80vh;
  background: #fff;
  border-radius: 24rpx;
  padding: 32rpx;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.panel-title {
  font-weight: 600;
  font-size: 32rpx;
  margin-bottom: 12rpx;
  text-align: center;
}
.preview-scroll {
  max-height: 48vh;
  margin-bottom: 8rpx;
}
.box {
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
  font-size: 26rpx;
}
.box.pre {
  white-space: pre-wrap;
  word-break: break-word;
}
.box.ai-generated {
  background-color: #fff7ed;
}
</style>
