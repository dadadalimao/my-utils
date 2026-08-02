<template>
  <view class="page" v-if="novel.currentNovel">
    <view class="card head">
      <view class="title">{{ novel.currentNovel.title }} · 全书大纲</view>
      <view class="muted hint">
        写全书主线、分幕/分卷与关键转折。长篇模式下生成正文前必须填写；写作时会注入上下文，也可用工具查阅。
      </view>
    </view>

    <view class="card">
      <view class="label">大纲正文</view>
      <textarea
        v-model="outline"
        class="area ai-prompt-input"
        :placeholder="outlinePlaceholder"
        :maxlength="30000"
      />
      <view class="input-meta">{{ outline.length }}/30000</view>

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
        <view class="btn-ghost" :class="{ disabled: busy }" @click="onDraftFromChapters">
          {{ drafting ? '生成中…' : '从章纲生成初稿' }}
        </view>
      </view>
      <view class="btn-primary save-btn" :class="{ disabled: busy }" @click="onSave">
        {{ saving ? '保存中…' : '保存' }}
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
import { assistBookOutline, draftBookOutlineFromChapters } from '@/ai/bookOutline'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'

const novel = useNovelStore()
const settings = useSettingsStore()
const outline = ref('')
const assistPrompt = ref('')
const assisting = ref(false)
const drafting = ref(false)
const saving = ref(false)
const preview = ref<{ title: string; text: string } | null>(null)

const busy = computed(() => assisting.value || drafting.value || saving.value)
const outlinePlaceholder =
  '例如：三幕结构、各阶段核心事件、主题与角色定位…'
const assistPlaceholder =
  '例如：补全第二幕宇宙探索阶段；标明最终 BOSS 与主角命途…'

onShow(() => {
  novel.refresh()
  outline.value = novel.currentNovel?.meta?.bookOutline || ''
})

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
    const text = await assistBookOutline({
      novelId: novel.currentNovelId,
      current: outline.value,
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

async function onDraftFromChapters() {
  if (busy.value || !novel.currentNovelId) return
  try {
    drafting.value = true
    uni.showLoading({ title: '根据章纲生成', mask: true })
    const provider = settings.settings.defaultProvider
    const text = await draftBookOutlineFromChapters({
      novelId: novel.currentNovelId,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })
    preview.value = { title: '确认采用大纲初稿', text }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    drafting.value = false
    uni.hideLoading()
  }
}

function applyPreview() {
  if (!preview.value) return
  outline.value = preview.value.text
  preview.value = null
  uni.showToast({ title: '已写入编辑区，可再保存', icon: 'none' })
}

function onSave() {
  if (busy.value || !novel.currentNovelId) return
  try {
    saving.value = true
    novel.updateNovelMeta(novel.currentNovelId, {
      bookOutline: outline.value.trim(),
    })
    uni.showToast({ title: '已保存', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    saving.value = false
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
  color: var(--color-text-secondary);
}
.area {
  width: 100%;
  min-height: 480rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
  background-color: var(--color-ai-prompt);
}
.area.small {
  min-height: 140rpx;
}
.input-meta {
  text-align: right;
  font-size: 22rpx;
  color: var(--color-text-faint);
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
.save-btn {
  margin-top: 20rpx;
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
  background: var(--color-mask);
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
  background: var(--color-surface);
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
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
  font-size: 26rpx;
}
.box.pre {
  white-space: pre-wrap;
  word-break: break-word;
}
.box.ai-generated {
  background-color: var(--color-ai-output);
}
</style>
