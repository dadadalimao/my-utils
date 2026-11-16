<template>
  <view class="polish-pair">
    <view
      class="btn-ghost"
      :class="{ disabled: disabled || polishing }"
      @click="onPolish"
    >
      {{ polishing ? '润色中…' : '润色' }}
    </view>
    <view
      v-if="canUndo"
      class="btn-ghost"
      :class="{ disabled: disabled || polishing }"
      @click="onUndo"
    >
      撤回
    </view>
  </view>
</template>

<script lang="ts">
/** 让根节点参与父级 flex，避免自定义组件在按钮行里被撑变形 */
export default {
  options: {
    virtualHost: true,
  },
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { polishUserPrompt, type PromptPolishScene } from '@/ai/polishPrompt'
import { useSettingsStore } from '@/stores/settings'

const props = withDefaults(
  defineProps<{
    modelValue: string
    scene: PromptPolishScene
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const polishing = ref(false)
/** 每次润色前压栈，撤回按次还原 */
const undoStack = ref<string[]>([])

const canUndo = computed(() => undoStack.value.length > 0)

/**
 * 用当前厂商把输入框里的用户提示词润色后写回。
 */
async function onPolish() {
  if (props.disabled || polishing.value) return
  const raw = (props.modelValue || '').trim()
  if (!raw) {
    uni.showToast({ title: '请先填写提示词', icon: 'none' })
    return
  }
  const settings = useSettingsStore()
  const provider = settings.settings.defaultProvider
  const apiKey = settings.apiKeyFor(provider)
  if (!apiKey) {
    uni.showToast({ title: '请先配置 API Key', icon: 'none' })
    return
  }
  polishing.value = true
  try {
    uni.showLoading({ title: '润色中', mask: true })
    const next = await polishUserPrompt({
      text: raw,
      scene: props.scene,
      provider,
      apiKey,
      model: settings.settings.defaultModel,
    })
    undoStack.value = [...undoStack.value, raw].slice(-10)
    emit('update:modelValue', next)
    uni.showToast({ title: '已润色', icon: 'success' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '润色失败', icon: 'none' })
  } finally {
    polishing.value = false
    uni.hideLoading()
  }
}

/** 还原到上一次润色前的提示词 */
function onUndo() {
  if (props.disabled || polishing.value) return
  const prev = undoStack.value[undoStack.value.length - 1]
  if (prev == null) return
  undoStack.value = undoStack.value.slice(0, -1)
  emit('update:modelValue', prev)
  uni.showToast({ title: '已撤回润色', icon: 'none' })
}
</script>

<style scoped>
.polish-pair {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  width: 100%;
  min-width: 140rpx;
  padding: 0 !important;
  background: transparent !important;
  border: none !important;
  box-sizing: border-box;
}
.polish-pair .btn-ghost {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  padding: 16rpx;
  box-sizing: border-box;
}
</style>
