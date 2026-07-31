<template>
  <view class="page">
    <view class="card">
      <view class="tabs">
        <view :class="{ active: tab === 'login' }" @click="tab = 'login'">登录</view>
        <view :class="{ active: tab === 'register' }" @click="tab = 'register'">注册</view>
      </view>
      <input v-model="username" class="field" placeholder="用户名（4-32，字母数字下划线）" />
      <input v-model="password" class="field" password placeholder="密码（至少 6 位）" />
      <view class="muted tip">不支持密码找回。丢失密码将无法访问该账号云端数据。</view>
      <view class="btn-primary" @click="submit">{{ tab === 'login' ? '登录' : '注册' }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'

const auth = useAuthStore()
const chat = useChatStore()
const tab = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')

async function submit() {
  try {
    uni.showLoading({ title: '请稍候' })
    if (tab.value === 'login') {
      await auth.login(username.value.trim(), password.value)
    } else {
      await auth.register(username.value.trim(), password.value)
    }
    // 登录后强制拉取提示词并缓存到本地
    await chat.loadTemplates(true)
    uni.showToast({ title: '成功', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 500)
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}
</script>

<style scoped>
.page {
  padding: 24rpx;
}
.tabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 20rpx;
}
.tabs > view {
  flex: 1;
  text-align: center;
  padding: 16rpx;
  background: #f5f5f4;
  border-radius: 12rpx;
}
.tabs .active {
  background: #0f766e;
  color: #fff;
}
.field {
  background: #f5f5f4;
  padding: 20rpx;
  border-radius: 8rpx;
  margin-bottom: 16rpx;
}
.tip {
  margin-bottom: 20rpx;
}
</style>
