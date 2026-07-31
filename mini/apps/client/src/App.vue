<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useNovelStore } from '@/stores/novel'

onLaunch(() => {
  useSettingsStore().reload()
  useNovelStore().refresh()
  // 有缓存用缓存；已登录则后台刷新云端列表
  useChatStore().loadTemplates()
})
</script>

<style>
page {
  background: #f7f4ef;
  color: #1c1917;
  font-size: 28rpx;
}
.btn-primary {
  background: #0f766e;
  color: #fff;
  border-radius: 12rpx;
  padding: 20rpx 32rpx;
  text-align: center;
}
.btn-ghost {
  background: #fff;
  color: #0f766e;
  border: 1px solid #0f766e;
  border-radius: 12rpx;
  padding: 20rpx 32rpx;
  text-align: center;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
}
.muted {
  color: #78716c;
  font-size: 24rpx;
}
/** 用户提示词输入框 */
.ai-prompt-input {
  background-color: #ccfbf1;
}
/** AI 生成内容（与工作台修订底稿同色） */
.ai-generated {
  background-color: #fff7ed;
}
</style>
