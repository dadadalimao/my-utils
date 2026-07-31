<template>
  <view class="page" v-if="novel.currentNovel">
    <view class="card head">
      <view class="title">升级为长篇规范</view>
      <view class="muted hint">
        将「{{ novel.currentNovel.title }}」从轻量升级为长篇：写正文前强制全书大纲 + 章纲，设定卡支持本体/时间线。
      </view>
      <view class="steps">
        <text :class="{ on: step >= 1 }">1.模式</text>
        <text>›</text>
        <text :class="{ on: step >= 2 }">2.大纲</text>
        <text>›</text>
        <text :class="{ on: step >= 3 }">3.设定卡</text>
      </view>
    </view>

    <view v-if="step === 1" class="card">
      <view class="label">预计字数</view>
      <input v-model.number="targetWords" type="number" class="field" placeholder="500000" />
      <view class="muted hint">建议长篇 ≥ 50 万字；仅作提示，不参与门禁计算。</view>
      <view class="row">
        <view class="btn-primary" @click="step = 2">下一步</view>
        <view class="btn-ghost" @click="goBack">取消</view>
      </view>
    </view>

    <view v-if="step === 2" class="card">
      <view class="label">全书大纲</view>
      <textarea
        v-model="bookOutline"
        class="area tall ai-prompt-input"
        placeholder="粘贴或撰写全书大纲；也可 AI 从章纲生成"
        :maxlength="30000"
      />
      <view class="row">
        <view class="btn-ghost" :class="{ disabled: busy }" @click="onDraftOutline">
          {{ drafting ? '生成中…' : '从章纲生成初稿' }}
        </view>
        <view class="btn-primary" @click="goStep3">下一步</view>
      </view>
      <view class="btn-ghost skip" @click="goStep3Skip">暂时跳过（之后写正文会被拦住）</view>
      <view class="btn-ghost" @click="step = 1">上一步</view>
    </view>

    <view v-if="step === 3" class="card">
      <view class="label">设定卡处理</view>
      <view class="mode-options">
        <view
          class="mode-opt"
          :class="{ active: loreAction === 'core' }"
          @click="loreAction = 'core'"
        >
          <text class="mode-opt-name">推荐：全部归入本体</text>
          <text class="muted mode-opt-desc">现有 content 写入 core，时间线留空，之后按需加阶段</text>
        </view>
        <view
          class="mode-opt"
          :class="{ active: loreAction === 'ai' }"
          @click="loreAction = 'ai'"
        >
          <text class="mode-opt-name">高级：AI 拆分本体/阶段</text>
          <text class="muted mode-opt-desc">按已有章纲猜测阶段（需 API Key，较慢）</text>
        </view>
      </view>
      <view class="muted hint">共 {{ loreCount }} 张设定卡。</view>
      <view class="row">
        <view class="btn-primary" :class="{ disabled: busy }" @click="onFinish">
          {{ finishing ? '处理中…' : '完成升级' }}
        </view>
        <view class="btn-ghost" @click="step = 2">上一步</view>
      </view>
    </view>

    <view v-if="outlinePreview" class="mask" @click="outlinePreview = null">
      <view class="panel" @click.stop>
        <view class="panel-title">确认大纲初稿</view>
        <scroll-view scroll-y class="preview-scroll">
          <view class="box pre ai-generated">{{ outlinePreview }}</view>
        </scroll-view>
        <view class="row">
          <view class="btn-primary" @click="applyOutlinePreview">采用</view>
          <view class="btn-ghost" @click="outlinePreview = null">取消</view>
        </view>
      </view>
    </view>
  </view>
  <view v-else class="muted empty">请先选择小说</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { draftBookOutlineFromChapters } from '@/ai/bookOutline'
import { chatCompletion } from '@/ai/client'
import { localRepository } from '@/repository/localRepository'
import { createId, type LoreStateEntry } from '@/types'
import { useLoreStore } from '@/stores/lore'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'

const novel = useNovelStore()
const lore = useLoreStore()
const settings = useSettingsStore()

const step = ref(1)
const targetWords = ref(500000)
const bookOutline = ref('')
const loreAction = ref<'core' | 'ai'>('core')
const drafting = ref(false)
const finishing = ref(false)
const outlinePreview = ref<string | null>(null)

const busy = computed(() => drafting.value || finishing.value)
const loreCount = computed(() =>
  novel.currentNovelId ? localRepository.listLoreCards(novel.currentNovelId).length : 0,
)

onShow(() => {
  novel.refresh()
  bookOutline.value = novel.currentNovel?.meta?.bookOutline || ''
  if (novel.currentNovel?.meta?.targetWords) {
    targetWords.value = novel.currentNovel.meta.targetWords
  }
})

function goBack() {
  uni.navigateBack()
}

function goStep3() {
  step.value = 3
}

function goStep3Skip() {
  uni.showToast({ title: '已跳过大纲，可稍后补写', icon: 'none' })
  step.value = 3
}

async function onDraftOutline() {
  if (!novel.currentNovelId || busy.value) return
  try {
    drafting.value = true
    uni.showLoading({ title: '生成大纲初稿', mask: true })
    const provider = settings.settings.defaultProvider
    const text = await draftBookOutlineFromChapters({
      novelId: novel.currentNovelId,
      provider,
      apiKey: settings.apiKeyFor(provider),
      model: settings.settings.defaultModel,
    })
    outlinePreview.value = text
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    drafting.value = false
    uni.hideLoading()
  }
}

function applyOutlinePreview() {
  if (!outlinePreview.value) return
  bookOutline.value = outlinePreview.value
  outlinePreview.value = null
}

/**
 * 将全部设定卡 content 归一到 core。
 */
function migrateLoreToCore(novelId: string) {
  const cards = localRepository.listLoreCards(novelId)
  for (const c of cards) {
    localRepository.saveLoreCard({
      id: c.id,
      novelId,
      kind: c.kind,
      name: c.name,
      keywords: c.keywords,
      core: c.core || c.content,
      content: c.core || c.content,
      states: c.states || [],
    })
  }
}

/**
 * AI 尝试把卡拆成 core + 若干阶段（失败则退回 core-only）。
 */
async function migrateLoreWithAi(novelId: string) {
  const cards = localRepository.listLoreCards(novelId)
  const chapters = localRepository.listChapters(novelId)
  const catalog = chapters
    .map((c) => `第${c.order}章 ${c.title}：${c.outline?.summary || '（无摘要）'}`)
    .join('\n')
    .slice(0, 4000)

  const provider = settings.settings.defaultProvider
  const apiKey = settings.apiKeyFor(provider)
  const model = settings.settings.defaultModel

  for (const c of cards) {
    try {
      const raw = await chatCompletion({
        provider,
        apiKey,
        model,
        messages: [
          {
            role: 'system',
            content: [
              '将设定卡拆成稳定本体 core 与可选时间线 stages。',
              '只输出 JSON：{"core":"…","states":[{"fromOrder":数字,"label":"可选","content":"…"}]}',
              '无把握时 states 可为空数组，全部放进 core。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `卡名：${c.name}（${c.kind}）`,
              '【当前正文】',
              c.core || c.content,
              '',
              '【章节摘要参考】',
              catalog || '（无）',
            ].join('\n'),
          },
        ],
      })
      let text = raw.trim()
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (fence) text = fence[1].trim()
      const obj = JSON.parse(text) as {
        core?: string
        states?: { fromOrder?: number; label?: string; content?: string }[]
      }
      const core = (obj.core || c.core || c.content || '').trim()
      const states: LoreStateEntry[] = Array.isArray(obj.states)
        ? obj.states
            .filter((s) => s && Number(s.fromOrder) >= 1 && typeof s.content === 'string')
            .map((s) => ({
              id: createId('lst_'),
              fromOrder: Math.floor(Number(s.fromOrder)),
              label: typeof s.label === 'string' ? s.label : undefined,
              content: String(s.content),
              updatedAt: new Date().toISOString(),
            }))
        : []
      localRepository.saveLoreCard({
        id: c.id,
        novelId,
        kind: c.kind,
        name: c.name,
        keywords: c.keywords,
        core,
        content: core,
        states,
      })
    } catch {
      localRepository.saveLoreCard({
        id: c.id,
        novelId,
        kind: c.kind,
        name: c.name,
        keywords: c.keywords,
        core: c.core || c.content,
        content: c.core || c.content,
        states: c.states || [],
      })
    }
  }
}

async function onFinish() {
  if (!novel.currentNovelId || busy.value) return
  try {
    finishing.value = true
    uni.showLoading({ title: '升级中', mask: true })
    const nid = novel.currentNovelId
    if (loreAction.value === 'ai') {
      await migrateLoreWithAi(nid)
    } else {
      migrateLoreToCore(nid)
    }
    novel.updateNovelMeta(nid, {
      writingMode: 'long',
      targetWords: Number(targetWords.value) > 0 ? Number(targetWords.value) : 500000,
      bookOutline: bookOutline.value.trim(),
      migratedAt: new Date().toISOString(),
    })
    lore.refresh(nid)
    uni.hideLoading()
    uni.showToast({ title: '已升级为长篇', icon: 'success' })
    setTimeout(() => {
      uni.navigateBack()
    }, 500)
  } catch (e) {
    uni.hideLoading()
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    finishing.value = false
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
  margin-bottom: 12rpx;
}
.steps {
  display: flex;
  gap: 12rpx;
  align-items: center;
  font-size: 24rpx;
  color: var(--color-text-faint);
}
.steps .on {
  color: var(--color-accent);
  font-weight: 600;
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
.area.tall {
  width: 100%;
  min-height: 360rpx;
  padding: 16rpx;
  border-radius: 8rpx;
  box-sizing: border-box;
}
.area.ai-prompt-input {
  background-color: var(--color-ai-prompt);
}
.row {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}
.row > view {
  flex: 1;
}
.skip {
  margin-top: 12rpx;
}
.mode-options {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.mode-opt {
  padding: 20rpx;
  border-radius: 12rpx;
  border: 1px solid var(--color-border);
  background: var(--color-surface-soft);
}
.mode-opt.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft);
}
.mode-opt-name {
  font-weight: 600;
  display: block;
  margin-bottom: 4rpx;
}
.mode-opt-desc {
  font-size: 24rpx;
  line-height: 1.4;
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
