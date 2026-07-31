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

      <view class="label">{{ kind === 'item' ? '道具数据正文' : '设定正文' }}</view>
      <view v-if="kind === 'item'" class="hint muted">
        请记录具体数据（效果数值、使用条件、消耗、持有者、状态变化），勿只写外观。
        <text class="link" @click="fillItemTemplate">填入模板</text>
      </view>
      <view v-else class="hint muted">
        只写人物本体（身份/体态/性格/天赋/自身属性）。装备详情请建道具卡，此处最多「持有：xxx」。
        <text class="link" @click="fillCharacterTemplate">填入模板</text>
      </view>
      <textarea
        v-model="content"
        class="area tall"
        :placeholder="contentPlaceholder"
        :maxlength="20000"
      />

      <view class="row">
        <view class="btn-primary" @click="onSave">保存</view>
        <view v-if="id" class="btn-ghost danger-btn" @click="onDelete">删除</view>
      </view>
    </view>

    <!-- 按章节范围 AI 更新（需已保存的卡） -->
    <view v-if="id" class="card">
      <view class="section">AI 按章节更新</view>
      <view class="muted hint">选择章序范围，根据这些章正文分析并合并进本卡（先预览再确认）。</view>
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
        placeholder="额外要求，例如：只保留本体属性、去掉装备词条、精简人际关系…"
        :maxlength="4000"
      />
      <view class="btn-primary" :class="{ disabled: analyzing }" @click="onAnalyze">
        {{ analyzing ? '分析中…' : 'AI 分析并更新' }}
      </view>
    </view>
    <view v-else class="muted tip">先保存设定卡后，才能按章节范围做 AI 更新。</view>

    <!-- 预览确认 -->
    <view v-if="preview" class="mask" @click="preview = null">
      <view class="panel" @click.stop>
        <view class="panel-title">确认更新</view>
        <view class="muted" v-if="preview.reason">{{ preview.reason }}</view>
        <view class="label">新名称 / 关键词</view>
        <view class="box ai-generated">{{ preview.name }} · {{ preview.keywords.join('、') }}</view>
        <view class="label">新设定</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ preview.content }}</view>
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
  updateLoreCardFromChapterRange,
} from '@/ai/loreExtract'
import type { LoreCardKind } from '@/types'
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
const content = ref('')
const fromOrder = ref(1)
const toOrder = ref(1)
const userPrompt = ref('')
const analyzing = ref(false)
const preview = ref<{
  name: string
  keywords: string[]
  content: string
  reason: string
} | null>(null)

const kindLabels = ['人物卡', '道具卡']
const kindIndex = computed(() => (kind.value === 'item' ? 1 : 0))
const contentPlaceholder = computed(() =>
  kind.value === 'item'
    ? '请按模板填写：功能数值、使用条件、持有者、状态记录等'
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
      content.value = card.content
      novel.selectNovel(card.novelId)
    }
  } else if (kind.value === 'item' && !content.value) {
    content.value = ITEM_CONTENT_TEMPLATE
  }
  syncChapterRangeDefaults()
})

onShow(() => {
  novel.refresh()
  syncChapterRangeDefaults()
})

function onKind(e: { detail: { value: string } }) {
  const next: LoreCardKind = Number(e.detail.value) === 1 ? 'item' : 'character'
  if (next === 'item' && kind.value !== 'item' && !content.value.trim()) {
    content.value = ITEM_CONTENT_TEMPLATE
  }
  kind.value = next
}

function fillItemTemplate() {
  if (content.value.trim()) {
    uni.showModal({
      title: '填入模板',
      content: '将覆盖当前正文，是否继续？',
      success: (res) => {
        if (res.confirm) content.value = ITEM_CONTENT_TEMPLATE
      },
    })
  } else {
    content.value = ITEM_CONTENT_TEMPLATE
  }
}

function fillCharacterTemplate() {
  if (content.value.trim()) {
    uni.showModal({
      title: '填入模板',
      content: '将覆盖当前正文，是否继续？',
      success: (res) => {
        if (res.confirm) content.value = CHARACTER_CONTENT_TEMPLATE
      },
    })
  } else {
    content.value = CHARACTER_CONTENT_TEMPLATE
  }
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 落盘当前表单；quiet 时不弹成功 toast（供 AI 流程内部调用） */
function persistCard(quiet = false) {
  if (!name.value.trim()) throw new Error('请填写名称')
  if (!content.value.trim()) throw new Error('请填写设定')
  const keys = parseKeywords(keywordsText.value)
  const card = lore.saveCard({
    id: id.value || undefined,
    kind: kind.value,
    name: name.value.trim(),
    keywords: keys.length ? keys : [name.value.trim()],
    content: content.value.trim(),
  })
  id.value = card.id
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
    // 先静默落盘，避免分析用旧内容，也不误报「已保存」
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
      content: result.content,
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
  content.value = preview.value.content
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
  color: #57534e;
}
.section {
  font-weight: 600;
  font-size: 30rpx;
  margin-bottom: 8rpx;
}
.field,
.picker {
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
}
.area {
  width: 100%;
  min-height: 160rpx;
  background: #f5f5f4;
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
  color: #0f766e;
  margin-left: 8rpx;
}
.tip {
  padding: 16rpx;
  font-size: 24rpx;
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
.danger-btn {
  color: #b91c1c;
  border-color: #b91c1c;
}
.disabled {
  opacity: 0.6;
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
  max-height: 40vh;
  margin-bottom: 8rpx;
}
.box {
  background: #f5f5f4;
  padding: 16rpx;
  border-radius: 8rpx;
  font-size: 26rpx;
  margin-bottom: 8rpx;
}
.area.ai-prompt-input {
  background-color: #ccfbf1;
  margin-bottom: 16rpx;
}
.box.ai-generated {
  background-color: #fff7ed;
}
.box.pre {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
