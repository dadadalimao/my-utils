<template>
  <view class="page">
    <view v-if="!pending" class="muted empty">没有待确认的设定卡</view>
    <template v-else>
      <view class="card meta">
        <view class="title">确认设定卡更新</view>
        <view class="muted">来源：{{ pending.chapterTitle }} · 共 {{ ops.length }} 项</view>
      </view>

      <view v-for="(op, idx) in ops" :key="idx" class="card">
        <view class="head">
          <text class="tag" :class="op.action">{{ op.action === 'create' ? '新建' : '更新' }}</text>
          <text class="kind">{{ op.kind === 'character' ? '人物' : '道具' }}</text>
          <text class="name">{{ op.name }}</text>
        </view>
        <view class="muted" v-if="op.reason">说明：{{ op.reason }}</view>
        <view class="muted">关键词：{{ (op.keywords || []).join('、') }}</view>
        <view v-if="op.action === 'update' && oldMap[op.id || '']" class="compare">
          <view class="label">原设定</view>
          <view class="box">{{ oldMap[op.id || ''].slice(0, 200) }}{{ oldMap[op.id || ''].length > 200 ? '…' : '' }}</view>
          <view class="label">新设定</view>
        </view>
        <view v-if="op.core" class="label">本体</view>
        <view class="box ai-generated">{{ op.core || op.content }}</view>
        <view v-if="op.stateContent" class="label">
          阶段（第{{ op.stateFromOrder || '?' }}章起{{ op.stateLabel ? ` · ${op.stateLabel}` : '' }}）
        </view>
        <view v-if="op.stateContent" class="box ai-generated">{{ op.stateContent }}</view>
        <text class="danger" @click="removeAt(idx)">移除此项</text>
      </view>

      <view class="actions">
        <view class="btn-primary" :class="{ disabled: !ops.length }" @click="onConfirm">确认保存</view>
        <view class="btn-ghost" @click="onCancel">取消</view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { localRepository } from '@/repository/localRepository'
import { useLoreStore, type LoreExtractPending } from '@/stores/lore'
import type { LoreCardOp } from '@/types'

const lore = useLoreStore()
const pending = ref<LoreExtractPending | null>(null)
const ops = ref<LoreCardOp[]>([])

const oldMap = computed(() => {
  const map: Record<string, string> = {}
  for (const op of ops.value) {
    if (op.action === 'update' && op.id) {
      const old = localRepository.getLoreCard(op.id)
      if (old) map[op.id] = old.core || old.content
    }
  }
  return map
})

onShow(() => {
  pending.value = lore.getPending()
  ops.value = pending.value ? [...pending.value.ops] : []
})

function removeAt(idx: number) {
  ops.value.splice(idx, 1)
}

function onCancel() {
  lore.setPending(null)
  uni.navigateBack()
}

function onConfirm() {
  if (!ops.value.length) {
    uni.showToast({ title: '没有可保存项', icon: 'none' })
    return
  }
  try {
    lore.confirmPending(ops.value)
    uni.showToast({ title: '设定卡已保存', icon: 'success' })
    setTimeout(() => {
      uni.redirectTo({ url: '/pages/lore/index' })
    }, 400)
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
.meta .title {
  font-weight: 600;
  font-size: 32rpx;
  margin-bottom: 8rpx;
}
.head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 8rpx;
  flex-wrap: wrap;
}
.tag {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  background: var(--color-border);
}
.tag.create {
  background: var(--color-tag-create-bg);
  color: var(--color-tag-create-text);
}
.tag.update {
  background: var(--color-tag-update-bg);
  color: var(--color-tag-update-text);
}
.kind {
  color: var(--color-text-muted);
  font-size: 24rpx;
}
.name {
  font-weight: 600;
}
.label {
  margin: 12rpx 0 6rpx;
  color: var(--color-text-secondary);
  font-size: 24rpx;
}
.box {
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 26rpx;
  margin-bottom: 8rpx;
}
.box.ai-generated {
  background-color: var(--color-ai-output);
}
.danger {
  color: var(--color-danger);
  font-size: 24rpx;
}
.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}
.actions > view {
  flex: 1;
}
.empty {
  text-align: center;
  padding: 80rpx;
}
.disabled {
  opacity: 0.5;
}
</style>
