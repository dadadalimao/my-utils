<template>
  <view class="page">
    <view class="card meta" v-if="novel.currentNovel" @click="goChapters">
      <view class="meta-row">
        <text class="title">{{ novel.currentNovel.title }}</text>
        <text class="chapters-link">章节列表 ›</text>
      </view>
      <view class="muted">当前章：{{ novel.currentChapter?.title || '未选择（保存将新建）' }}</view>
    </view>
    <view v-else class="card muted">请先从小说列表进入</view>

    <view v-if="writingProgress" class="card progress-card">
      <view class="progress-title">长篇规范进度</view>
      <view class="progress-row">
        <view
          v-for="item in writingProgress"
          :key="item.key"
          class="progress-item"
          :class="{ done: item.done, clickable: !!item.navigateTo }"
          @click="onProgressTap(item)"
        >
          <text class="progress-mark">{{ item.done ? '✓' : '○' }}</text>
          <text class="progress-label">{{ item.label }}</text>
        </view>
      </view>
    </view>

    <view class="toolbar">
      <view class="mode-trigger" @click="modeSheetOpen = true">
        <view class="mode-trigger-main">
          <text class="mode-trigger-label">创作模式</text>
          <text class="mode-trigger-value">{{ currentModeLabel }}</text>
        </view>
        <text class="mode-chevron">切换 ▾</text>
      </view>
      <view
        v-if="chat.activityLog.length || chat.loading"
        class="icon-btn log-btn"
        @click="logOpen = true"
      >
        <text class="log-icon">志</text>
        <text v-if="chat.loading" class="badge pulse">…</text>
      </view>
      <view class="icon-btn" @click="optionsOpen = true">
        <view class="gear" />
        <text v-if="chat.reviseMode" class="badge">修</text>
      </view>
    </view>

    <view v-if="chat.reviseMode" class="draft-panel">
      <view class="draft-head" @click="draftExpanded = !draftExpanded">
        <view class="draft-head-left">
          <text class="revise-tag">修订</text>
          <text class="muted">{{ draftHint }}</text>
        </view>
        <text class="draft-toggle">{{ draftExpanded ? '收起' : '展开正文' }}</text>
      </view>
      <scroll-view v-if="draftExpanded" scroll-y class="draft-body">
        <view v-if="chat.draftInfo.source === 'none'" class="muted">
          暂无底稿。先生成或保存正文后，即可在此对照修订。
        </view>
        <view v-else class="draft-text" user-select selectable>{{ chat.draftInfo.text }}</view>
      </scroll-view>
      <view v-if="draftExpanded && chat.draftInfo.source !== 'none'" class="draft-actions">
        <text class="act" @click="onCopy(chat.draftInfo.text)">复制底稿</text>
      </view>
    </view>

    <scroll-view scroll-y class="messages">
      <view
        v-for="msg in chat.messages"
        :key="msg.id"
        class="msg"
        :class="msg.role"
      >
        <view class="msg-body" user-select selectable>{{ msg.content }}</view>
        <view v-if="!msg.content && msg.role === 'assistant' && chat.loading" class="muted streaming">
          {{ chat.toolStatus || '生成中…' }}
          <text class="act log-inline" @click="logOpen = true">查看日志</text>
        </view>
        <view class="msg-actions">
          <text class="act" @click="onCopy(msg.content)">复制</text>
          <text
            v-if="msg.role === 'assistant' && msg.content && !chat.loading"
            class="act"
            @click="onUseDraft(msg.id)"
          >
            设为底稿
          </text>
          <text
            v-if="msg.role === 'user' && !chat.loading"
            class="act"
            @click="onEditResend(msg.id)"
          >
            编辑重发
          </text>
        </view>
      </view>
    </scroll-view>

    <view class="composer">
      <textarea
        v-model="input"
        class="input ai-prompt-input"
        :placeholder="composerPlaceholder"
        :disabled="chat.loading"
        :maxlength="20000"
        :auto-height="false"
        show-confirm-bar
      />
      <view class="input-meta">{{ input.length }}/20000</view>
      <view class="actions">
        <view class="btn-primary" :class="{ disabled: chat.loading }" @click="onSend">
          {{ chat.loading ? '生成中…' : chat.reviseMode ? '修订发送' : '发送' }}
        </view>
        <view class="btn-ghost" @click="onSaveContent">保存正文</view>
        <view class="btn-ghost" @click="onSaveOutline">保存大纲</view>
        <view class="btn-ghost" @click="chat.clearMessages()">清空</view>
      </view>
    </view>

    <!-- 创作模式切换 -->
    <view v-if="modeSheetOpen" class="mask" @click="modeSheetOpen = false">
      <view class="sheet" @click.stop>
        <view class="sheet-title">选择创作模式</view>
        <view class="muted hint">点击切换；当前：{{ currentModeLabel }}</view>
        <view
          v-for="m in modes"
          :key="m.id"
          class="mode-option"
          :class="{ active: chat.mode === m.id }"
          @click="onPickMode(m.id)"
        >
          <view class="mode-option-text">
            <text class="mode-option-name">{{ m.label }}</text>
            <text class="mode-option-desc muted">{{ m.desc }}</text>
          </view>
          <text v-if="chat.mode === m.id" class="mode-check">✓</text>
        </view>
        <view class="btn-ghost sheet-close" @click="modeSheetOpen = false">取消</view>
      </view>
    </view>

    <!-- 生成日志 -->
    <view v-if="logOpen" class="mask" @click="onLogMask">
      <view class="sheet log-sheet" @click.stop>
        <view class="sheet-title">生成日志</view>
        <view class="muted hint">
          {{ chat.loading ? '进行中…开始输出后会自动收起，可随时再打开。' : '本轮过程记录（可再次打开）' }}
        </view>
        <scroll-view scroll-y class="log-scroll" :scroll-into-view="logAnchor">
          <view v-if="!chat.activityLog.length" class="muted empty-log">暂无日志</view>
          <view
            v-for="(item, idx) in chat.activityLog"
            :id="'log-' + idx"
            :key="idx"
            class="log-line"
            :class="{ thinking: item.kind === 'thinking' }"
          >
            <text class="log-time">{{ formatLogTime(item.at) }}</text>
            <text class="log-text">
              <text v-if="item.kind === 'thinking'" class="log-tag">思考</text>
              {{ item.text }}
            </text>
          </view>
          <view id="log-end" />
        </scroll-view>
        <view class="row log-actions">
          <view
            v-if="chat.loading"
            class="btn-primary danger-fill"
            @click="onStop"
          >
            停止生成
          </view>
          <view class="btn-ghost" @click="onCopyLog">复制日志</view>
          <view class="btn-ghost" @click="logOpen = false">关闭</view>
        </view>
      </view>
    </view>

    <!-- 选项弹框 -->
    <view v-if="optionsOpen" class="mask" @click="optionsOpen = false">
      <view class="sheet" @click.stop>
        <view class="sheet-title">工作台选项</view>

        <view class="label">提示词模板</view>
        <picker :range="templateNames" @change="onTplChange">
          <view class="picker">{{ currentTplName }}</view>
        </picker>

        <view class="label row-between">
          <text>修订模式</text>
          <switch :checked="chat.reviseMode" @change="onReviseChange" :color="themeControlColor" />
        </view>
        <view class="hint muted">
          开：按底稿局部修改。无底稿（新章）时自动按新创作发送。底稿优先「最近生成」，其次「当前章正文」。
        </view>
        <view class="hint muted">当前底稿：{{ draftHint }}</view>

        <view class="label row-between">
          <text>关键词注入设定卡</text>
          <switch :checked="chat.injectLore" @change="onInjectLoreChange" :color="themeControlColor" />
        </view>
        <view class="hint muted">发送内容命中人物/道具关键词时，自动把对应设定塞进提示词。</view>

        <view class="label row-between">
          <text>注入大纲</text>
          <switch :checked="chat.injectOutline" @change="onInjectChange" :color="themeControlColor" />
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

        <view class="btn-primary sheet-close" @click="optionsOpen = false">完成</view>
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { ChatMode } from '@/types'
import {
  buildWritingProgress,
  type WritingProgressItem,
} from '@/ai/writingGate'
import { THEME_CONTROL_COLOR } from '@/constants/theme'
import { useChatStore } from '@/stores/chat'
import { useNovelStore } from '@/stores/novel'
import SaveContentDone from '@/components/SaveContentDone.vue'
import { useLoreStore } from '@/stores/lore'

const themeControlColor = THEME_CONTROL_COLOR
const chat = useChatStore()
const novel = useNovelStore()
const lore = useLoreStore()
const input = ref('')
const fromOrder = ref(1)
const toOrder = ref(3)
const optionsOpen = ref(false)
const modeSheetOpen = ref(false)
const logOpen = ref(false)
/** 修订时默认展开底稿，方便对照描述 */
const draftExpanded = ref(true)

const saveDone = reactive({
  visible: false,
  chapterId: '',
  isLatest: false,
  title: '',
  order: 0,
})

const modes: { id: ChatMode; label: string; desc: string }[] = [
  { id: 'chapter', label: '章节', desc: '按模板写正文 / 修订正文' },
  { id: 'outline', label: '大纲', desc: '生成或细化章节大纲' },
  { id: 'advice', label: '建议', desc: '剧情节奏与写法建议' },
]

const currentModeLabel = computed(
  () => modes.find((m) => m.id === chat.mode)?.label || '章节',
)

const writingProgress = computed(() =>
  buildWritingProgress({
    novel: novel.currentNovel,
    currentChapterId: novel.currentChapterId,
  }),
)

function onProgressTap(item: WritingProgressItem) {
  if (item.navigateTo) {
    uni.navigateTo({ url: item.navigateTo })
  }
}

const logAnchor = computed(() =>
  chat.activityLog.length ? 'log-end' : '',
)

watch(
  () => chat.outputStarted,
  (started) => {
    // 工具轮非流式整包返回时，loading 可能在 watch 微任务前已结束，勿依赖 loading
    if (started) logOpen.value = false
  },
  { flush: 'sync' },
)

const draftHint = computed(() => {
  const d = chat.draftInfo
  if (d.source === 'lastReply') return `最近生成（${d.text.length} 字）`
  if (d.source === 'chapter') return `当前章正文（${d.text.length} 字）`
  return '无（新创作）'
})

const composerPlaceholder = computed(() => {
  if (!chat.reviseMode) return '描述你的需求…'
  if (chat.draftInfo.source === 'none') return '暂无底稿，将按新创作发送。也可先生成/保存正文…'
  return '说明要改哪里，例如：第三段再慢一点、删掉旁白…'
})

function goChapters() {
  if (!novel.currentNovelId) {
    uni.showToast({ title: '请先选择小说', icon: 'none' })
    return
  }
  uni.navigateTo({ url: '/pages/chapters/index' })
}

function openSaveDone(chapterId: string) {
  novel.refresh()
  const ch = novel.chapters.find((c) => c.id === chapterId)
  if (!ch) {
    uni.showToast({ title: '正文已保存', icon: 'success' })
    return
  }
  const last = novel.chapters[novel.chapters.length - 1]
  saveDone.chapterId = chapterId
  saveDone.title = ch.title
  saveDone.order = ch.order
  saveDone.isLatest = last?.id === chapterId
  saveDone.visible = true
}

function onSavePreview() {
  saveDone.visible = false
  uni.navigateTo({ url: `/pages/chapter-detail/index?id=${saveDone.chapterId}` })
}

function onSaveContinue() {
  saveDone.visible = false
  novel.selectChapter(saveDone.chapterId)
  chat.bindChapter(saveDone.chapterId)
  uni.showToast({ title: '可继续对话创作', icon: 'none' })
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

const rangeLabels = ['衔接（推荐）', '全书', '当前章', '自定义区间']
const rangeIndex = computed(() => {
  const t = chat.outlineRange.type
  if (t === 'all') return 1
  if (t === 'current') return 2
  if (t === 'range') return 3
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
  chat.bindChapter(novel.currentChapterId)
})

function onTplChange(e: { detail: { value: string } }) {
  const list = chat.templates.filter((t) => t.mode === chat.mode)
  const idx = Number(e.detail.value)
  if (list[idx]) chat.selectTemplate(list[idx].id)
}

function onInjectChange(e: { detail: { value: boolean } }) {
  chat.injectOutline = e.detail.value
}

function onReviseChange(e: { detail: { value: boolean } }) {
  chat.setReviseMode(e.detail.value)
  if (e.detail.value) draftExpanded.value = true
}

function onInjectLoreChange(e: { detail: { value: boolean } }) {
  chat.setInjectLore(e.detail.value)
}

function onRangeType(e: { detail: { value: string } }) {
  const idx = Number(e.detail.value)
  if (idx === 0) {
    chat.outlineRange = {
      type: 'continuity',
      currentChapterId: novel.currentChapterId || undefined,
    }
  } else if (idx === 1) chat.outlineRange = { type: 'all' }
  else if (idx === 2) {
    chat.outlineRange = {
      type: 'current',
      currentChapterId: novel.currentChapterId || undefined,
    }
  } else {
    chat.outlineRange = {
      type: 'range',
      fromOrder: fromOrder.value,
      toOrder: toOrder.value,
    }
  }
}

function applyRange() {
  chat.outlineRange = {
    type: 'range',
    fromOrder: Number(fromOrder.value) || 1,
    toOrder: Number(toOrder.value) || 1,
  }
  uni.showToast({ title: '已应用区间', icon: 'none' })
}

function onCopy(content: string) {
  if (!content) {
    uni.showToast({ title: '内容为空', icon: 'none' })
    return
  }
  uni.setClipboardData({
    data: content,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
    fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
  })
}

function onUseDraft(messageId: string) {
  try {
    chat.useAsDraft(messageId)
    draftExpanded.value = true
    uni.showToast({ title: '已设为底稿并开启修订', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onEditResend(messageId: string) {
  try {
    input.value = chat.prepareEditResend(messageId)
    uni.showToast({ title: '已填入，可编辑后发送', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

async function onSend() {
  const text = input.value.trim()
  if (!text || chat.loading) return
  logOpen.value = true
  try {
    await chat.send(text)
    input.value = ''
  } catch (e) {
    const msg = (e as Error).message || '发送失败'
    if (msg !== '已停止') {
      uni.showToast({ title: msg, icon: 'none' })
    }
  }
}

function onPickMode(id: ChatMode) {
  chat.setMode(id)
  modeSheetOpen.value = false
  uni.showToast({ title: `已切换：${modes.find((m) => m.id === id)?.label}`, icon: 'none' })
}

function formatLogTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function onLogMask() {
  // 生成中点遮罩不关（防误触）；结束后可关
  if (!chat.loading) logOpen.value = false
}

function onStop() {
  chat.stopGeneration()
  logOpen.value = false
}

function onCopyLog() {
  if (!chat.activityLog.length) {
    uni.showToast({ title: '暂无日志', icon: 'none' })
    return
  }
  const text = chat.activityLog
    .map((item) => {
      const tag = item.kind === 'thinking' ? '[思考] ' : ''
      return `${formatLogTime(item.at)}  ${tag}${item.text}`
    })
    .join('\n')
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '已复制', icon: 'success' }),
    fail: () => uni.showToast({ title: '复制失败', icon: 'none' }),
  })
}

async function onSaveContent() {
  try {
    uni.showLoading({ title: '保存正文中', mask: true })
    const cid = await chat.saveReplyAsContent(novel.currentChapterId || undefined)
    uni.hideLoading()
    openSaveDone(cid)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onSaveOutline() {
  try {
    uni.showLoading({ title: '保存大纲中', mask: true })
    chat.saveReplyAsOutline(novel.currentChapterId || undefined)
    uni.hideLoading()
    uni.showToast({ title: '大纲已保存', icon: 'success' })
  } catch (e) {
    uni.hideLoading()
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
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.meta .title {
  font-weight: 600;
  font-size: 30rpx;
  flex: 1;
}
.chapters-link {
  color: var(--color-accent);
  font-size: 26rpx;
  flex-shrink: 0;
}
.progress-card {
  margin-bottom: 12rpx;
  padding: 16rpx 20rpx;
}
.progress-title {
  font-size: 24rpx;
  color: var(--color-text-secondary);
  margin-bottom: 12rpx;
}
.progress-row {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.progress-item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  font-size: 26rpx;
  color: var(--color-text-faint);
}
.progress-item.done {
  color: var(--color-accent);
}
.progress-item.clickable {
  color: var(--color-text-secondary);
}
.progress-mark {
  width: 32rpx;
  text-align: center;
}
.progress-label {
  flex: 1;
}
.toolbar {
  display: flex;
  gap: 12rpx;
  align-items: center;
  margin-bottom: 12rpx;
}
.mode-trigger {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  background: var(--color-surface);
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
  border: 1px solid var(--color-accent);
  box-sizing: border-box;
}
.mode-trigger-main {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
  min-width: 0;
}
.mode-trigger-label {
  font-size: 20rpx;
  color: var(--color-text-muted);
}
.mode-trigger-value {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--color-accent);
}
.mode-chevron {
  flex-shrink: 0;
  font-size: 24rpx;
  color: var(--color-accent);
}
.mode-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 12rpx;
  background: var(--color-surface-muted);
  border-radius: 12rpx;
  border: 2rpx solid transparent;
}
.mode-option.active {
  background: var(--color-ai-prompt);
  border-color: var(--color-accent);
}
.mode-option-text {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}
.mode-option-name {
  font-size: 30rpx;
  font-weight: 600;
}
.mode-option-desc {
  font-size: 22rpx;
}
.mode-check {
  color: var(--color-accent);
  font-size: 32rpx;
  font-weight: 700;
}
.icon-btn {
  position: relative;
  width: 72rpx;
  height: 72rpx;
  background: var(--color-surface);
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.log-btn {
  border: 1px solid var(--color-accent);
}
.log-icon {
  font-size: 26rpx;
  color: var(--color-accent);
  font-weight: 600;
}
.pulse {
  animation: none;
}
/* 简易齿轮图标，免依赖 */
.gear {
  width: 28rpx;
  height: 28rpx;
  border: 4rpx solid var(--color-accent);
  border-radius: 50%;
  box-shadow:
    0 -10rpx 0 -4rpx var(--color-accent),
    0 10rpx 0 -4rpx var(--color-accent),
    10rpx 0 0 -4rpx var(--color-accent),
    -10rpx 0 0 -4rpx var(--color-accent),
    7rpx 7rpx 0 -4rpx var(--color-accent),
    -7rpx 7rpx 0 -4rpx var(--color-accent),
    7rpx -7rpx 0 -4rpx var(--color-accent),
    -7rpx -7rpx 0 -4rpx var(--color-accent);
}
.badge {
  position: absolute;
  top: -6rpx;
  right: -6rpx;
  background: var(--color-accent);
  color: var(--color-surface);
  font-size: 18rpx;
  padding: 2rpx 8rpx;
  border-radius: 8rpx;
}
.revise-tag {
  background: var(--color-accent);
  color: var(--color-surface);
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  flex-shrink: 0;
}
.draft-panel {
  background: var(--color-ai-output);
  border-radius: 12rpx;
  margin-bottom: 8rpx;
  overflow: hidden;
}
.draft-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 12rpx 16rpx;
}
.draft-head-left {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex: 1;
  min-width: 0;
}
.draft-toggle {
  color: var(--color-accent);
  font-size: 24rpx;
  flex-shrink: 0;
}
.draft-body {
  max-height: 360rpx;
  padding: 0 16rpx 12rpx;
  box-sizing: border-box;
}
.draft-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--color-text);
  user-select: text;
  -webkit-user-select: text;
}
.draft-actions {
  padding: 0 16rpx 12rpx;
}
.label {
  margin: 12rpx 0 8rpx;
  color: var(--color-text-secondary);
}
.row-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.picker {
  background: var(--color-surface-muted);
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
  background: var(--color-surface-muted);
  padding: 12rpx;
  border-radius: 8rpx;
}
.mini {
  padding: 12rpx 16rpx;
  font-size: 24rpx;
}
.hint {
  font-size: 22rpx;
  line-height: 1.5;
  margin-bottom: 8rpx;
}
.messages {
  flex: 1;
  margin: 12rpx 0;
}
.msg {
  margin-bottom: 16rpx;
  padding: 20rpx;
  border-radius: 12rpx;
  background: var(--color-surface);
  border: 1px solid transparent;
}
.msg-body {
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
  line-height: 1.65;
  color: var(--color-text);
}
.streaming {
  margin-top: 8rpx;
}
.log-inline {
  margin-left: 16rpx;
}
.log-sheet {
  max-height: 70vh;
}
.log-scroll {
  max-height: 46vh;
  margin: 12rpx 0 8rpx;
  background: var(--color-surface-muted);
  border-radius: 12rpx;
  padding: 16rpx;
  box-sizing: border-box;
}
.log-line {
  display: flex;
  gap: 12rpx;
  margin-bottom: 12rpx;
  font-size: 24rpx;
  line-height: 1.5;
}
.log-time {
  flex-shrink: 0;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
}
.log-text {
  flex: 1;
  color: var(--color-text);
  word-break: break-word;
}
.log-line.thinking .log-text {
  color: var(--color-text-muted);
  font-style: italic;
}
.log-tag {
  display: inline;
  margin-right: 8rpx;
  color: var(--color-text-faint);
  font-style: normal;
  font-size: 22rpx;
}
.empty-log {
  text-align: center;
  padding: 32rpx;
}
.log-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 8rpx;
}
.log-actions > view {
  flex: 1;
}
.danger-fill {
  background: var(--color-danger);
}
.msg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
  margin-top: 12rpx;
  padding-top: 8rpx;
  border-top: 1px solid var(--color-border);
}
.act {
  font-size: 24rpx;
  color: var(--color-accent);
}
.msg.user {
  background: var(--color-chat-user);
  border-color: var(--color-border);
}
.msg.assistant {
  background: var(--color-chat-assistant);
  border-color: var(--color-border);
}
.composer .input {
  width: 100%;
  min-height: 280rpx;
  max-height: 480rpx;
  background: var(--color-ai-prompt);
  padding: 16rpx;
  border-radius: 12rpx;
  box-sizing: border-box;
}
.input-meta {
  margin-top: 8rpx;
  text-align: right;
  font-size: 22rpx;
  color: var(--color-text-faint);
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
.mask {
  position: fixed;
  inset: 0;
  background: var(--color-mask);
  z-index: 900;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--color-surface);
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
  text-align: center;
}
.sheet-close {
  margin-top: 28rpx;
}
</style>
