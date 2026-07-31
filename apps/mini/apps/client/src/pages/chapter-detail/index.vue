<template>
  <view class="page" v-if="chapter">
    <view class="tabs">
      <view :class="{ active: tab === 'content' }" @click="tab = 'content'">正文</view>
      <view :class="{ active: tab === 'outline' }" @click="tab = 'outline'">大纲</view>
    </view>

    <view v-if="tab === 'content'" class="card card-fill">
      <input v-model="title" class="title-input" placeholder="章节标题" />
      <view class="editor-wrap">
        <textarea
          v-model="content"
          class="editor"
          placeholder="正文章节内容"
          :maxlength="80000"
        />
      </view>
      <view class="input-meta">{{ content.length }}/80000</view>
      <view class="btn-primary" @click="saveContent">保存正文</view>
    </view>

    <scroll-view v-else scroll-y class="card card-fill outline-scroll">
      <view class="label">摘要（2～4 句剧情）</view>
      <textarea v-model="summary" class="small" :maxlength="2000" />
      <view class="label">本章事件（每行一条）</view>
      <textarea v-model="beatsText" class="small" :maxlength="20000" />
      <view class="label">人物状态变化（每行一条）</view>
      <textarea
        v-model="characterStatesText"
        class="small"
        placeholder="如：林晚：负伤撤离，暂避客栈"
        :maxlength="10000"
      />
      <view class="label">未收束线 / 章末伏笔（每行一条）</view>
      <textarea
        v-model="hangingThreadsText"
        class="small"
        placeholder="如：血玉佩来历未揭；仇家已盯上客栈"
        :maxlength="10000"
      />
      <view class="label">备注 notes（自动维护不会覆盖）</view>
      <textarea v-model="notes" class="small tall" :maxlength="10000" />
      <view class="btn-primary" @click="saveOutline">保存大纲</view>

      <view class="ai-section">
        <view class="section-title">AI 修订大纲</view>
        <view class="muted hint">单轮：说明要怎么改，生成后可采用到上方表单（仍需点保存大纲落库）。</view>
        <view class="label">用户提示词</view>
        <textarea
          v-model="userPrompt"
          class="small ai-prompt-input"
          placeholder="例如：补人物状态；把未收束线写清楚；事件再拆细…"
          :maxlength="4000"
          :disabled="revising"
        />
        <view class="btn-primary" :class="{ disabled: revising }" @click="onRevise">
          {{ revising ? '修订中…' : 'AI 修订' }}
        </view>

        <template v-if="aiResult">
          <view class="label">AI 结果</view>
          <view class="box ai-generated pre">{{ formatOutlinePreview(aiResult) }}</view>
          <view class="btn-ghost" @click="onAdopt">采用到表单</view>
        </template>
      </view>
    </scroll-view>

    <!-- 采用前预览（表单非空时） -->
    <view v-if="previewOpen && aiResult" class="mask" @click="previewOpen = false">
      <view class="panel" @click.stop>
        <view class="panel-title">确认采用</view>
        <view class="label">当前表单</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre">{{ formatFormPreview() }}</view>
        </scroll-view>
        <view class="label">将采用</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ formatOutlinePreview(aiResult) }}</view>
        </scroll-view>
        <view class="row">
          <view class="btn-primary" @click="confirmAdopt">采用</view>
          <view class="btn-ghost" @click="previewOpen = false">取消</view>
        </view>
      </view>
    </view>

    <SaveContentDone
      :visible="saveDone.visible"
      :is-latest="saveDone.isLatest"
      :title="saveDone.title"
      :order="saveDone.order"
      @preview="onSavePreview"
      @keep-writing="onSaveContinue"
      @update-lore="onUpdateLore"
      @back="onSaveBack"
    />
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import {
  reviseOutlineByPrompt,
  type OutlineReviseResult,
} from '@/ai/outlineMaintain'
import {
  generateChapterTitleFromContent,
  isPlaceholderChapterTitle,
} from '@/ai/chapterTitle'
import { localRepository } from '@/repository/localRepository'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'
import type { Chapter } from '@/types'
import SaveContentDone from '@/components/SaveContentDone.vue'
import { useLoreStore } from '@/stores/lore'

const novel = useNovelStore()
const lore = useLoreStore()
const settings = useSettingsStore()
const chapter = ref<Chapter | null>(null)
const tab = ref<'content' | 'outline'>('content')
const title = ref('')
const content = ref('')
const summary = ref('')
const beatsText = ref('')
const characterStatesText = ref('')
const hangingThreadsText = ref('')
const notes = ref('')
const userPrompt = ref('')
const revising = ref(false)
const aiResult = ref<OutlineReviseResult | null>(null)
const previewOpen = ref(false)

const saveDone = reactive({
  visible: false,
  chapterId: '',
  isLatest: false,
  title: '',
  order: 0,
})

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
  characterStatesText.value = (ch.outline.characterStates || []).join('\n')
  hangingThreadsText.value = (ch.outline.hangingThreads || []).join('\n')
  notes.value = ch.outline.notes || ''
})

function openSaveDone(chapterId: string) {
  novel.refresh()
  const ch = novel.chapters.find((c) => c.id === chapterId) || localRepository.getChapter(chapterId)
  if (!ch) return
  const last = novel.chapters[novel.chapters.length - 1]
  saveDone.chapterId = chapterId
  saveDone.title = ch.title
  saveDone.order = ch.order
  saveDone.isLatest = last?.id === chapterId
  chapter.value = { ...ch, content: content.value, title: title.value }
  saveDone.visible = true
}

async function saveContent() {
  if (!chapter.value) return
  if (content.value.length > 80000) {
    uni.showToast({ title: '正文过长，请考虑拆章', icon: 'none' })
    return
  }
  let nextTitle = title.value.trim() || chapter.value.title
  try {
    uni.showLoading({ title: '保存中', mask: true })
    if (content.value.trim() && isPlaceholderChapterTitle(nextTitle, chapter.value.order)) {
      try {
        const provider = settings.settings.defaultProvider
        nextTitle = await generateChapterTitleFromContent({
          content: content.value,
          order: chapter.value.order,
          provider,
          apiKey: settings.apiKeyFor(provider),
          model: settings.settings.defaultModel,
        })
        title.value = nextTitle
      } catch (e) {
        console.warn('自动生成章节标题失败', e)
      }
    }
    localRepository.updateChapter(chapter.value.id, {
      title: nextTitle,
      content: content.value,
    })
    novel.refresh()
    uni.hideLoading()
    openSaveDone(chapter.value.id)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onSavePreview() {
  // 已在预览/编辑页，关闭弹框并刷新展示即可
  saveDone.visible = false
  const ch = localRepository.getChapter(saveDone.chapterId)
  if (ch) {
    chapter.value = ch
    title.value = ch.title
    content.value = ch.content
  }
  uni.showToast({ title: '可继续查看修改', icon: 'none' })
}

function onSaveContinue() {
  saveDone.visible = false
  novel.selectChapter(saveDone.chapterId)
  uni.navigateTo({ url: '/pages/workbench/index' })
}

async function onUpdateLore() {
  saveDone.visible = false
  try {
    uni.showLoading({ title: '分析设定中' })
    await lore.startExtractFromChapter(saveDone.chapterId)
    uni.navigateTo({ url: '/pages/lore/review' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function onSaveBack() {
  saveDone.visible = false
  uni.navigateTo({ url: '/pages/chapters/index' })
}

function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isFormOutlineEmpty(): boolean {
  return (
    !summary.value.trim() &&
    !parseLines(beatsText.value).length &&
    !parseLines(characterStatesText.value).length &&
    !parseLines(hangingThreadsText.value).length
  )
}

function formatList(items: string[], empty = '（无）'): string {
  return items.length ? items.map((b, i) => `${i + 1}. ${b}`).join('\n') : empty
}

function formatOutlinePreview(r: OutlineReviseResult): string {
  const notesLine =
    r.notes === undefined
      ? `备注：（保留原备注）\n${notes.value || '（空）'}`
      : `备注：${r.notes || '（空）'}`
  return [
    `摘要：${r.summary || '（空）'}`,
    `本章事件：\n${formatList(r.beats)}`,
    `人物状态：\n${formatList(r.characterStates)}`,
    `未收束线：\n${formatList(r.hangingThreads)}`,
    notesLine,
  ].join('\n')
}

function formatFormPreview(): string {
  return [
    `摘要：${summary.value.trim() || '（空）'}`,
    `本章事件：\n${formatList(parseLines(beatsText.value))}`,
    `人物状态：\n${formatList(parseLines(characterStatesText.value))}`,
    `未收束线：\n${formatList(parseLines(hangingThreadsText.value))}`,
    `备注：${notes.value.trim() || '（空）'}`,
  ].join('\n')
}

function applyAiResult(r: OutlineReviseResult) {
  summary.value = r.summary
  beatsText.value = r.beats.join('\n')
  characterStatesText.value = r.characterStates.join('\n')
  hangingThreadsText.value = r.hangingThreads.join('\n')
  if (r.notes !== undefined) notes.value = r.notes
  uni.showToast({ title: '已写入表单，请保存大纲', icon: 'none' })
}

async function onRevise() {
  if (revising.value) return
  try {
    revising.value = true
    uni.showLoading({ title: '修订中', mask: true })
    const provider = settings.settings.defaultProvider
    aiResult.value = await reviseOutlineByPrompt({
      title: title.value.trim() || chapter.value?.title || '',
      summary: summary.value,
      beats: parseLines(beatsText.value),
      characterStates: parseLines(characterStatesText.value),
      hangingThreads: parseLines(hangingThreadsText.value),
      notes: notes.value,
      userPrompt: userPrompt.value,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    revising.value = false
    uni.hideLoading()
  }
}

function onAdopt() {
  if (!aiResult.value) return
  if (isFormOutlineEmpty()) {
    applyAiResult(aiResult.value)
    return
  }
  previewOpen.value = true
}

function confirmAdopt() {
  if (!aiResult.value) return
  applyAiResult(aiResult.value)
  previewOpen.value = false
}

function saveOutline() {
  if (!chapter.value) return
  novel.saveChapterOutline(
    chapter.value.id,
    {
      summary: summary.value.trim(),
      beats: parseLines(beatsText.value),
      characterStates: parseLines(characterStatesText.value),
      hangingThreads: parseLines(hangingThreadsText.value),
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
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: 24rpx;
  box-sizing: border-box;
}
.tabs {
  display: flex;
  flex-shrink: 0;
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
.card-fill {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  margin-bottom: 0;
  box-sizing: border-box;
}
.outline-scroll {
  display: block;
  height: 0;
  padding-bottom: 48rpx;
  box-sizing: border-box;
}
.title-input {
  flex-shrink: 0;
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
  padding: 12rpx;
  background: #f5f5f4;
  border-radius: 8rpx;
}
/** 原生 textarea 不吃 flex，用占位层撑高后再绝对填满 */
.editor-wrap {
  position: relative;
  flex: 1;
  min-height: 200rpx;
  margin-bottom: 8rpx;
}
.editor {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
}
.input-meta {
  flex-shrink: 0;
  text-align: right;
  font-size: 22rpx;
  color: #a8a29e;
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
.small.tall {
  min-height: 200rpx;
}
.small.ai-prompt-input {
  background-color: #ccfbf1;
}
.label {
  flex-shrink: 0;
  margin: 8rpx 0;
  color: #57534e;
}
.btn-primary,
.btn-ghost {
  flex-shrink: 0;
  margin-bottom: 16rpx;
}
.disabled {
  opacity: 0.6;
}
.ai-section {
  margin-top: 8rpx;
  padding-top: 16rpx;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}
.section-title {
  font-weight: 600;
  font-size: 30rpx;
  margin-bottom: 8rpx;
}
.hint {
  font-size: 22rpx;
  line-height: 1.5;
  margin-bottom: 8rpx;
}
.box {
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
  font-size: 26rpx;
  margin-bottom: 16rpx;
}
.box.pre {
  white-space: pre-wrap;
  word-break: break-word;
}
.box.ai-generated {
  background-color: #fff7ed;
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
  max-height: 22vh;
  margin-bottom: 8rpx;
}
.row {
  display: flex;
  gap: 16rpx;
  margin-top: 16rpx;
}
.row > view {
  flex: 1;
  margin-bottom: 0;
}
</style>
