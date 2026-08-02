<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { storageReady } from '@/repository/storage'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useNovelStore } from '@/stores/novel'

onLaunch(async () => {
  try {
    await storageReady()
  } catch (e) {
    console.error('[App] storageReady failed', e)
  }
  useSettingsStore().reload()
  useNovelStore().refresh()
  // 有缓存用缓存；已登录则后台刷新云端列表
  useChatStore().loadTemplates()
})
</script>

<style>
/* 必须经 App.vue 样式打包进 app.wxss；仅 main.ts import 在小程序不可靠 */
@import './styles/theme.css';

page {
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 28rpx;
}

.btn-primary {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  border-radius: 12rpx;
  padding: 20rpx 32rpx;
  text-align: center;
}

.btn-ghost {
  background: var(--color-surface);
  color: var(--color-accent);
  border: 1px solid var(--color-border);
  border-radius: 12rpx;
  padding: 20rpx 32rpx;
  text-align: center;
}

.card {
  background: var(--color-surface);
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
  border: 1px solid var(--color-border);
}

.muted {
  color: var(--color-text-muted);
  font-size: 24rpx;
}

/** 用户提示词输入框 */
.ai-prompt-input {
  background-color: var(--color-ai-prompt);
}

/** AI 生成内容（与工作台修订底稿同色） */
.ai-generated {
  background-color: var(--color-ai-output);
}

.link {
  color: var(--color-accent);
}

.danger {
  color: var(--color-danger);
}
</style>
