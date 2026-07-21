<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useSettingsStore } from '@/stores/settings'
import { useNovelStore } from '@/stores/novel'

onLaunch(() => {
  useSettingsStore().reload()
  useNovelStore().refresh()
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
</style>
