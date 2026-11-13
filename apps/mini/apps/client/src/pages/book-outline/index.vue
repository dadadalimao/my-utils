<template>
  <view class="page" v-if="novel.currentNovel">
    <view class="card head">
      <view class="title">{{ novel.currentNovel.title }} · 全书大纲</view>
      <view class="muted hint">
        写全书主线、分幕/分卷与关键转折。长篇模式下生成正文前必须填写；写作时会注入上下文，也可用工具查阅。下方可查看各章大纲，并一次性让 AI 生成多章细纲。
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
        <PromptPolishBtn
          v-model="assistPrompt"
          scene="bookAssist"
          :disabled="busy"
        />
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

    <view class="card">
      <view class="label">批量生成章纲</view>
      <view class="muted hint">
        按全书大纲一次规划多章细纲（最多 {{ maxBatch }} 章）。生成后预览，确认采用才写入各章。
      </view>
      <view class="range-row">
        <text>第</text>
        <input
          class="num ai-prompt-input"
          type="number"
          v-model="fromOrderText"
          :disabled="busy"
        />
        <text>章 至 第</text>
        <input
          class="num ai-prompt-input"
          type="number"
          v-model="toOrderText"
          :disabled="busy"
        />
        <text>章</text>
      </view>
      <textarea
        v-model="batchPrompt"
        class="area small ai-prompt-input"
        :placeholder="batchPlaceholder"
        :maxlength="4000"
        :disabled="busy"
      />
      <view class="row">
        <PromptPolishBtn
          v-model="batchPrompt"
          scene="bookBatch"
          :disabled="busy"
        />
        <view class="btn-primary" :class="{ disabled: busy }" @click="onGenerateChapters">
          {{ batching ? '生成中…' : 'AI 生成多章大纲' }}
        </view>
      </view>
    </view>

    <view class="card">
      <view class="label">章节大纲列表</view>
      <view v-if="!novel.chapters.length" class="muted empty-list">暂无章节</view>
      <view
        v-for="ch in novel.chapters"
        :key="ch.id"
        class="ch-item"
        @click="openChapterOutline(ch.id)"
      >
        <view class="ch-title">第{{ ch.order }}章 · {{ ch.title }}</view>
        <view class="muted ch-sum">
          {{ ch.outline.summary || '暂无章纲' }}
        </view>
        <view v-if="ch.outline.beats.length" class="muted ch-beats">
          {{ ch.outline.beats.slice(0, 3).join(' · ') }}
        </view>
        <text class="link">查看/编辑</text>
      </view>
    </view>

    <view v-if="preview" class="mask" @click="preview = null">
      <view class="panel" @click.stop>
        <view class="panel-title">{{ preview.title }}</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ previewText }}</view>
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
import {
  draftToChapterOutline,
  formatChapterOutlineDrafts,
  generateChapterOutlines,
  MAX_BATCH_CHAPTER_OUTLINES,
  resolveAdoptTitle,
  type ChapterOutlineDraft,
} from '@/ai/chapterOutlinesBatch'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'
import PromptPolishBtn from '@/components/PromptPolishBtn.vue'

const novel = useNovelStore()
const settings = useSettingsStore()
const outline = ref('')
const assistPrompt = ref('')
const batchPrompt = ref('')
const fromOrderText = ref('1')
const toOrderText = ref('5')
const assisting = ref(false)
const drafting = ref(false)
const batching = ref(false)
const saving = ref(false)

type Preview =
  | { kind: 'book'; title: string; text: string }
  | { kind: 'chapters'; title: string; drafts: ChapterOutlineDraft[] }

const preview = ref<Preview | null>(null)

const busy = computed(
  () => assisting.value || drafting.value || batching.value || saving.value,
)
const maxBatch = MAX_BATCH_CHAPTER_OUTLINES
const outlinePlaceholder =
  '例如：三幕结构、各阶段核心事件、主题与角色定位…'
const assistPlaceholder =
  '例如：补全第二幕宇宙探索阶段；标明最终 BOSS 与主角命途…'
const batchPlaceholder =
  '例如：按全书大纲写这几章细纲，每章含冲突与章末钩子；已有摘要的章只细化不推翻…'

const previewText = computed(() => {
  if (!preview.value) return ''
  if (preview.value.kind === 'book') return preview.value.text
  return formatChapterOutlineDrafts(preview.value.drafts)
})

onShow(() => {
  novel.refresh()
  outline.value = novel.currentNovel?.meta?.bookOutline || ''
  syncDefaultRange()
})

/** 默认从首个无摘要章起，一次 5 章；都有摘要则从下一章开始。 */
function syncDefaultRange() {
  const list = novel.chapters
  const blank = list.find((c) => !c.outline.summary?.trim())
  const from = blank?.order ?? (list.length ? list[list.length - 1].order + 1 : 1)
  fromOrderText.value = String(from)
  toOrderText.value = String(from + 4)
}

function parseRange(): { fromOrder: number; toOrder: number } {
  const fromOrder = Math.floor(Number(fromOrderText.value))
  const toOrder = Math.floor(Number(toOrderText.value))
  if (!Number.isFinite(fromOrder) || !Number.isFinite(toOrder)) {
    throw new Error('请填写有效的起止章序')
  }
  if (fromOrder < 1 || toOrder < fromOrder) throw new Error('章序范围无效')
  if (toOrder - fromOrder + 1 > MAX_BATCH_CHAPTER_OUTLINES) {
    throw new Error(`单次最多生成 ${MAX_BATCH_CHAPTER_OUTLINES} 章大纲`)
  }
  return { fromOrder, toOrder }
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
    const text = await assistBookOutline({
      novelId: novel.currentNovelId,
      current: outline.value,
      userPrompt: assistPrompt.value,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })
    preview.value = { kind: 'book', title: '确认采用 AI 辅助结果', text }
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
    preview.value = { kind: 'book', title: '确认采用大纲初稿', text }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    drafting.value = false
    uni.hideLoading()
  }
}

async function onGenerateChapters() {
  if (busy.value || !novel.currentNovelId) return
  let range: { fromOrder: number; toOrder: number }
  try {
    range = parseRange()
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
    return
  }
  try {
    batching.value = true
    uni.showLoading({ title: '生成多章大纲', mask: true })
    const provider = settings.settings.defaultProvider
    const drafts = await generateChapterOutlines({
      novelId: novel.currentNovelId,
      fromOrder: range.fromOrder,
      toOrder: range.toOrder,
      userPrompt: batchPrompt.value,
      bookOutline: outline.value,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
      thinkingEffort: settings.settings.thinkingEffort,
    })
    preview.value = {
      kind: 'chapters',
      title: `确认采用 ${drafts.length} 章大纲`,
      drafts,
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    batching.value = false
    uni.hideLoading()
  }
}

function applyPreview() {
  if (!preview.value) return
  if (preview.value.kind === 'book') {
    outline.value = preview.value.text
    preview.value = null
    uni.showToast({ title: '已写入编辑区，可再保存', icon: 'none' })
    return
  }
  const drafts = preview.value.drafts
  const overwritten = drafts.filter((d) => {
    const ch = novel.chapters.find((c) => c.order === d.order)
    return !!(ch?.outline.summary || '').trim()
  })
  if (overwritten.length) {
    uni.showModal({
      title: '覆盖已有章纲？',
      content: `第 ${overwritten.map((d) => d.order).join('、')} 章已有摘要，采用后将覆盖。`,
      success: (res) => {
        if (res.confirm) commitChapterDrafts(drafts)
      },
    })
    return
  }
  commitChapterDrafts(drafts)
}

function commitChapterDrafts(drafts: ChapterOutlineDraft[]) {
  try {
    for (const d of drafts) {
      const ch = novel.ensureChapterAtOrder(d.order, d.title || `第${d.order}章`)
      const title = resolveAdoptTitle(d.order, ch.title, d.title)
      novel.saveChapterOutline(ch.id, draftToChapterOutline(d, ch.outline.notes), title)
    }
    preview.value = null
    novel.refresh()
    uni.showToast({ title: `已写入 ${drafts.length} 章大纲`, icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function openChapterOutline(id: string) {
  uni.navigateTo({ url: `/pages/chapter-detail/index?id=${id}&tab=outline` })
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
.row > view,
.row :deep(.btn-ghost) {
  flex: 1;
}
.save-btn {
  margin-top: 20rpx;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 8rpx 0 16rpx;
  font-size: 26rpx;
}
.num {
  width: 120rpx;
  padding: 12rpx;
  border-radius: 8rpx;
  text-align: center;
}
.ch-item {
  padding: 16rpx 0;
}
.ch-item + .ch-item {
  border-top: 1px solid var(--color-border);
}
.ch-title {
  font-weight: 600;
  margin-bottom: 6rpx;
}
.ch-sum {
  line-height: 1.5;
  margin-bottom: 4rpx;
}
.ch-beats {
  line-height: 1.4;
  margin-bottom: 8rpx;
}
.empty-list {
  padding: 24rpx 0;
  text-align: center;
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
