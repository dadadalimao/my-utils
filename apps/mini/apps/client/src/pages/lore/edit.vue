<template>
  <view class="page">
    <view class="card">
      <view class="label">类型</view>
      <picker :range="kindLabels" :value="kindIndex" @change="onKind">
        <view class="picker">{{ kind === 'character' ? '人物卡' : '道具卡' }}</view>
      </picker>

      <view class="label">名称</view>
      <input v-model="name" class="field" placeholder="角色或道具名" />

      <view class="label">关键词（用、分隔多个；也支持换行）</view>
      <textarea
        v-model="keywordsText"
        class="area"
        :placeholder="kind === 'character' ? '如：林晚、晚晚' : '如：血玉佩、玉佩'"
      />

      <view v-if="isLong" class="tabs">
        <view class="tab" :class="{ active: tab === 'core' }" @click="tab = 'core'">本体</view>
        <view class="tab" :class="{ active: tab === 'states' }" @click="tab = 'states'">时间线</view>
      </view>

      <view v-if="!isLong || tab === 'core'">
        <view class="label">{{ isLong ? '本体（稳定设定）' : kind === 'item' ? '道具数据正文' : '设定正文' }}</view>
        <view v-if="kind === 'item'" class="hint muted">
          请记录具体数据（效果数值、使用条件、消耗、持有者），勿只写外观。
          <text class="link" @click="fillItemTemplate">填入模板</text>
        </view>
        <view v-else class="hint muted">
          只写人物本体（身份/体态/性格/天赋/自身属性）。装备详情请建道具卡。
          <text class="link" @click="fillCharacterTemplate">填入模板</text>
        </view>
        <textarea
          v-model="core"
          class="area tall"
          :placeholder="contentPlaceholder"
          :maxlength="20000"
        />
      </view>

      <view v-if="isLong && tab === 'states'">
        <view class="muted hint">
          重大变化时新增阶段（按章序生效）。写作注入 = 本体 + 当前章最近阶段。
        </view>
        <view v-for="(s, idx) in states" :key="s.id" class="state-card">
          <view class="state-head">
            <text>第 {{ s.fromOrder }} 章起{{ s.label ? ` · ${s.label}` : '' }}</text>
            <text class="danger" @click="removeState(idx)">删除</text>
          </view>
          <view class="state-preview muted">{{ (s.content || '').slice(0, 80) || '（空）' }}</view>
          <text class="link" @click="editState(idx)">编辑</text>
        </view>
        <view v-if="!states.length" class="muted tip">暂无阶段，可点击下方新增。</view>
        <view class="btn-ghost" @click="startAddState">新增阶段</view>
      </view>

      <view v-if="!isLong" class="muted tip">轻量模式不维护时间线；升级长篇后可拆分阶段。</view>

      <view class="row">
        <view class="btn-primary" @click="onSave">保存</view>
        <view v-if="id" class="btn-ghost danger-btn" @click="onDelete">删除</view>
      </view>
    </view>

    <view v-if="id" class="card">
      <view class="section">AI 按章节更新</view>
      <view class="muted hint">
        选择章序范围，根据正文分析并合并
        {{ isLong ? '（长篇：可变信息写入阶段）' : '' }}。
      </view>
      <view class="range-row">
        <view class="range-field">
          <text class="label">起始章</text>
          <input v-model.number="fromOrder" type="number" class="field" />
        </view>
        <view class="range-field">
          <text class="label">结束章</text>
          <input v-model.number="toOrder" type="number" class="field" />
        </view>
      </view>
      <view class="label">用户提示词（可选）</view>
      <textarea
        v-model="userPrompt"
        class="area ai-prompt-input"
        placeholder="额外要求，例如：只保留本体属性、去掉装备词条…"
        :maxlength="4000"
      />
      <view class="btn-primary" :class="{ disabled: analyzing }" @click="onAnalyze">
        {{ analyzing ? '分析中…' : 'AI 分析并更新' }}
      </view>
    </view>
    <view v-else class="muted tip">先保存设定卡后，才能按章节范围做 AI 更新。</view>

    <view v-if="stateEditor" class="mask" @click="stateEditor = null">
      <view class="panel" @click.stop>
        <view class="panel-title">{{ stateEditor.index < 0 ? '新增阶段' : '编辑阶段' }}</view>
        <view class="label">生效章序</view>
        <input v-model.number="stateEditor.fromOrder" type="number" class="field" />
        <view class="label">标签（可选）</view>
        <input v-model="stateEditor.label" class="field" placeholder="如：开眼后" />
        <view class="label">阶段正文</view>
        <textarea v-model="stateEditor.content" class="area tall" :maxlength="12000" />
        <text class="link" @click="fillStateTemplate">填入阶段模板</text>
        <view class="row">
          <view class="btn-primary" @click="applyStateEditor">确定</view>
          <view class="btn-ghost" @click="stateEditor = null">取消</view>
        </view>
      </view>
    </view>

    <view v-if="preview" class="mask" @click="preview = null">
      <view class="panel" @click.stop>
        <view class="panel-title">确认更新</view>
        <view class="muted" v-if="preview.reason">{{ preview.reason }}</view>
        <view class="label">新名称 / 关键词</view>
        <view class="box ai-generated">{{ preview.name }} · {{ preview.keywords.join('、') }}</view>
        <view class="label">本体</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ preview.core }}</view>
        </scroll-view>
        <view v-if="preview.stateContent" class="label">
          阶段（第{{ preview.stateFromOrder }}章起）
        </view>
        <scroll-view v-if="preview.stateContent" scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ preview.stateContent }}</view>
        </scroll-view>
        <view class="row">
          <view class="btn-primary" @click="applyPreview">采用</view>
          <view class="btn-ghost" @click="preview = null">取消</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import {
  CHARACTER_CONTENT_HINT,
  CHARACTER_CONTENT_TEMPLATE,
  ITEM_CONTENT_TEMPLATE,
  LORE_STATE_TEMPLATE,
  updateLoreCardFromChapterRange,
  upsertLoreState,
} from '@/ai/loreExtract'
import { createId, getWritingMode, type LoreCardKind, type LoreStateEntry } from '@/types'
import { localRepository } from '@/repository/localRepository'
import { useLoreStore } from '@/stores/lore'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'

const lore = useLoreStore()
const novel = useNovelStore()
const settings = useSettingsStore()

const id = ref('')
const kind = ref<LoreCardKind>('character')
const name = ref('')
const keywordsText = ref('')
const core = ref('')
const states = ref<LoreStateEntry[]>([])
const tab = ref<'core' | 'states'>('core')
const fromOrder = ref(1)
const toOrder = ref(1)
const userPrompt = ref('')
const analyzing = ref(false)
const preview = ref<{
  name: string
  keywords: string[]
  core: string
  stateFromOrder?: number
  stateContent?: string
  reason: string
} | null>(null)
const stateEditor = ref<{
  index: number
  fromOrder: number
  label: string
  content: string
} | null>(null)

const kindLabels = ['人物卡', '道具卡']
const kindIndex = computed(() => (kind.value === 'item' ? 1 : 0))
const isLong = computed(() => getWritingMode(novel.currentNovel?.meta) === 'long')
const contentPlaceholder = computed(() =>
  kind.value === 'item'
    ? '请按模板填写：功能数值、使用条件、持有者等'
    : CHARACTER_CONTENT_HINT,
)

function syncChapterRangeDefaults() {
  const list = novel.currentNovelId
    ? localRepository.listChapters(novel.currentNovelId)
    : []
  if (!list.length) {
    fromOrder.value = 1
    toOrder.value = 1
    return
  }
  fromOrder.value = list[0].order
  toOrder.value = list[list.length - 1].order
}

onLoad((query) => {
  if (query?.kind === 'item' || query?.kind === 'character') {
    kind.value = query.kind
  }
  if (query?.id) {
    id.value = query.id as string
    const card = localRepository.getLoreCard(id.value)
    if (card) {
      kind.value = card.kind
      name.value = card.name
      keywordsText.value = (card.keywords || []).join('、')
      core.value = card.core || card.content || ''
      states.value = [...(card.states || [])]
      novel.selectNovel(card.novelId)
    }
  } else if (kind.value === 'item' && !core.value) {
    core.value = ITEM_CONTENT_TEMPLATE
  }
  syncChapterRangeDefaults()
})

onShow(() => {
  novel.refresh()
  syncChapterRangeDefaults()
})

function onKind(e: { detail: { value: string } }) {
  const next: LoreCardKind = Number(e.detail.value) === 1 ? 'item' : 'character'
  if (next === 'item' && kind.value !== 'item' && !core.value.trim()) {
    core.value = ITEM_CONTENT_TEMPLATE
  }
  kind.value = next
}

function fillItemTemplate() {
  const apply = () => {
    core.value = ITEM_CONTENT_TEMPLATE
  }
  if (core.value.trim()) {
    uni.showModal({
      title: '填入模板',
      content: '将覆盖当前正文，是否继续？',
      success: (res) => {
        if (res.confirm) apply()
      },
    })
  } else apply()
}

function fillCharacterTemplate() {
  const apply = () => {
    core.value = CHARACTER_CONTENT_TEMPLATE
  }
  if (core.value.trim()) {
    uni.showModal({
      title: '填入模板',
      content: '将覆盖当前正文，是否继续？',
      success: (res) => {
        if (res.confirm) apply()
      },
    })
  } else apply()
}

function fillStateTemplate() {
  if (!stateEditor.value) return
  stateEditor.value.content = LORE_STATE_TEMPLATE
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function persistCard(quiet = false) {
  if (!name.value.trim()) throw new Error('请填写名称')
  if (!core.value.trim()) throw new Error(isLong.value ? '请填写本体' : '请填写设定')
  const keys = parseKeywords(keywordsText.value)
  const card = lore.saveCard({
    id: id.value || undefined,
    kind: kind.value,
    name: name.value.trim(),
    keywords: keys.length ? keys : [name.value.trim()],
    core: core.value.trim(),
    content: core.value.trim(),
    states: isLong.value ? states.value : [],
  })
  id.value = card.id
  states.value = [...(card.states || [])]
  if (!quiet) uni.showToast({ title: '已保存', icon: 'success' })
  return card
}

function onSave() {
  try {
    persistCard(false)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  }
}

function onDelete() {
  if (!id.value) return
  uni.showModal({
    title: '删除',
    content: '确认删除此设定卡？',
    success: (res) => {
      if (res.confirm) {
        lore.removeCard(id.value)
        uni.navigateBack()
      }
    },
  })
}

function startAddState() {
  const last = novel.chapters[novel.chapters.length - 1]
  stateEditor.value = {
    index: -1,
    fromOrder: last?.order || toOrder.value || 1,
    label: '',
    content: '',
  }
}

function editState(idx: number) {
  const s = states.value[idx]
  if (!s) return
  stateEditor.value = {
    index: idx,
    fromOrder: s.fromOrder,
    label: s.label || '',
    content: s.content,
  }
}

function removeState(idx: number) {
  uni.showModal({
    title: '删除阶段',
    content: '确认删除该时间线阶段？',
    success: (res) => {
      if (!res.confirm) return
      states.value = states.value.filter((_, i) => i !== idx)
    },
  })
}

function applyStateEditor() {
  if (!stateEditor.value) return
  const from = Math.floor(Number(stateEditor.value.fromOrder) || 0)
  if (from < 1) {
    uni.showToast({ title: '章序须 ≥ 1', icon: 'none' })
    return
  }
  if (!stateEditor.value.content.trim()) {
    uni.showToast({ title: '请填写阶段正文', icon: 'none' })
    return
  }
  const entry = {
    fromOrder: from,
    label: stateEditor.value.label.trim() || undefined,
    content: stateEditor.value.content.trim(),
  }
  if (stateEditor.value.index >= 0) {
    const list = [...states.value]
    const old = list[stateEditor.value.index]
    list[stateEditor.value.index] = {
      id: old?.id || createId('lst_'),
      fromOrder: entry.fromOrder,
      label: entry.label,
      content: entry.content,
      updatedAt: new Date().toISOString(),
    }
    states.value = list.sort((a, b) => a.fromOrder - b.fromOrder)
  } else {
    states.value = upsertLoreState(states.value, entry)
  }
  stateEditor.value = null
}

async function onAnalyze() {
  if (!id.value || !novel.currentNovelId) {
    uni.showToast({ title: '请先保存设定卡', icon: 'none' })
    return
  }
  if (analyzing.value) return
  const from = Number(fromOrder.value) || 1
  const to = Number(toOrder.value) || from
  try {
    analyzing.value = true
    persistCard(true)
    uni.showLoading({ title: '分析章节中', mask: true })
    const provider = settings.settings.defaultProvider
    const result = await updateLoreCardFromChapterRange({
      novelId: novel.currentNovelId,
      cardId: id.value,
      fromOrder: from,
      toOrder: to,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
      userPrompt: userPrompt.value,
    })
    preview.value = {
      name: result.name,
      keywords: result.keywords,
      core: result.core || result.content,
      stateFromOrder: result.stateFromOrder,
      stateContent: result.stateContent,
      reason: result.reason,
    }
    uni.hideLoading()
    uni.showToast({ title: '分析完成，请确认', icon: 'none' })
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message || '分析失败', icon: 'none' })
  } finally {
    analyzing.value = false
  }
}

function applyPreview() {
  if (!preview.value) return
  name.value = preview.value.name
  keywordsText.value = preview.value.keywords.join('、')
  core.value = preview.value.core
  if (isLong.value && preview.value.stateContent && preview.value.stateFromOrder != null) {
    states.value = upsertLoreState(states.value, {
      fromOrder: preview.value.stateFromOrder,
      content: preview.value.stateContent,
    })
  }
  preview.value = null
  try {
    persistCard(true)
    uni.showToast({ title: '已采用并保存', icon: 'success' })
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
.label {
  margin: 12rpx 0 8rpx;
  color: var(--color-text-secondary);
}
.section {
  font-weight: 600;
  font-size: 30rpx;
  margin-bottom: 8rpx;
}
.field,
.picker {
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
.link {
  color: var(--color-accent);
  margin-left: 8rpx;
}
.tip {
  padding: 16rpx 0;
  font-size: 24rpx;
}
.tabs {
  display: flex;
  gap: 8rpx;
  margin: 16rpx 0;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 14rpx;
  border-radius: 8rpx;
  background: var(--color-surface-muted);
  color: var(--color-text-secondary);
}
.tab.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}
.state-card {
  background: var(--color-surface-soft);
  border-radius: 8rpx;
  padding: 16rpx;
  margin-bottom: 12rpx;
}
.state-head {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 8rpx;
}
.state-preview {
  font-size: 24rpx;
  margin-bottom: 8rpx;
  white-space: pre-wrap;
}
.range-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.range-field {
  flex: 1;
}
.row {
  display: flex;
  gap: 16rpx;
  margin-top: 28rpx;
}
.row > view {
  flex: 1;
}
.danger {
  color: var(--color-danger);
  font-size: 24rpx;
  font-weight: 400;
}
.danger-btn {
  color: var(--color-danger);
  border-color: var(--color-danger);
}
.disabled {
  opacity: 0.6;
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
  overflow: hidden;
}
.panel-title {
  font-weight: 600;
  font-size: 32rpx;
  margin-bottom: 12rpx;
  text-align: center;
}
.preview-scroll {
  max-height: 24vh;
  margin-bottom: 8rpx;
}
.box {
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
  font-size: 26rpx;
  margin-bottom: 8rpx;
}
.area.ai-prompt-input {
  background-color: var(--color-ai-prompt);
  margin-bottom: 16rpx;
}
.box.ai-generated {
  background-color: var(--color-ai-output);
}
.box.pre {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
