<template>
  <view v-if="visible" class="mask" @click="emitBack">
    <view class="panel" @click.stop>
      <view class="title">正文已保存</view>
      <view class="sub">第{{ order }}章 · {{ title }}</view>
      <view class="btn primary" @click="emitPreview">预览</view>
      <view class="btn" @click="emitUpdateLore">更新设定卡</view>
      <view v-if="isLatest" class="btn" @click="emitKeep">继续创作</view>
      <view class="btn ghost" @click="emitBack">返回</view>
    </view>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean
  isLatest: boolean
  title: string
  order: number
}>()

const emit = defineEmits<{
  preview: []
  keepWriting: []
  updateLore: []
  back: []
}>()

function emitPreview() {
  emit('preview')
}
function emitKeep() {
  emit('keepWriting')
}
function emitUpdateLore() {
  emit('updateLore')
}
function emitBack() {
  emit('back')
}
</script>

<style scoped>
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: var(--color-mask);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  box-sizing: border-box;
}
.panel {
  width: 100%;
  max-width: 560rpx;
  background: var(--color-surface);
  border-radius: 24rpx;
  padding: 40rpx 32rpx 32rpx;
  box-sizing: border-box;
}
.title {
  font-size: 34rpx;
  font-weight: 600;
  text-align: center;
}
.sub {
  margin-top: 12rpx;
  margin-bottom: 36rpx;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 26rpx;
}
.btn {
  text-align: center;
  padding: 24rpx;
  border-radius: 12rpx;
  margin-bottom: 16rpx;
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-size: 30rpx;
}
.btn.primary {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}
.btn.ghost {
  background: transparent;
  color: var(--color-text-muted);
  margin-bottom: 0;
}
</style>
