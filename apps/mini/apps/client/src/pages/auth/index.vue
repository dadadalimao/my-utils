<template>
  <view class="page">
    <view class="card">
      <view class="tabs">
        <view :class="{ active: tab === 'login' }" @click="tab = 'login'">登录</view>
        <view :class="{ active: tab === 'register' }" @click="tab = 'register'">注册</view>
      </view>
      <input v-model="username" class="field" placeholder="用户名（4-32，字母数字下划线）" />
      <input v-model="password" class="field" password placeholder="密码（至少 6 位）" />
      <view class="remember" @click="remember = !remember">
        <view :class="['check', remember ? 'on' : '']">
          <text v-if="remember" class="check-mark">✓</text>
        </view>
        <text class="remember-label">记住用户名密码</text>
      </view>
      <view class="muted tip">不支持密码找回。丢失密码将无法访问该账号云端数据。</view>
      <view class="btn-primary" @click="submit">{{ tab === 'login' ? '登录' : '注册' }}</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { storageGet, storageRemove, storageSet } from '@/repository/storage'

/** 与登录态分离，退出登录后仍可回填 */
const KEY_REMEMBER = 'auth_remember'
const KEY_SAVED_USER = 'auth_saved_username'
const KEY_SAVED_PASS = 'auth_saved_password'

const auth = useAuthStore()
const chat = useChatStore()
const tab = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const remember = ref(true)

onShow(() => {
  remember.value = storageGet<boolean>(KEY_REMEMBER, true)
  if (remember.value) {
    username.value = storageGet<string>(KEY_SAVED_USER, '')
    password.value = storageGet<string>(KEY_SAVED_PASS, '')
  }
})

/**
 * 成功登录/注册后写入或清除本地记住的账号（不受 logout 影响）。
 */
function persistRemembered(name: string, pass: string) {
  storageSet(KEY_REMEMBER, remember.value)
  if (remember.value) {
    storageSet(KEY_SAVED_USER, name)
    storageSet(KEY_SAVED_PASS, pass)
  } else {
    storageRemove(KEY_SAVED_USER)
    storageRemove(KEY_SAVED_PASS)
  }
}

async function submit() {
  const name = username.value.trim()
  const pass = password.value
  try {
    uni.showLoading({ title: '请稍候' })
    if (tab.value === 'login') {
      await auth.login(name, pass)
    } else {
      await auth.register(name, pass)
    }
    persistRemembered(name, pass)
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
  background: var(--color-surface-muted);
  border-radius: 12rpx;
}
.tabs .active {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}
.field {
  background: var(--color-surface-muted);
  padding: 20rpx;
  border-radius: 8rpx;
  margin-bottom: 16rpx;
}
.remember {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
  padding: 4rpx 0;
}
.check {
  width: 36rpx;
  height: 36rpx;
  border-radius: 8rpx;
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.check.on {
  background: var(--color-primary);
  border-color: var(--color-primary);
}
.check-mark {
  color: var(--color-primary-contrast);
  font-size: 24rpx;
  line-height: 1;
}
.remember-label {
  font-size: 26rpx;
  color: var(--color-text);
}
.tip {
  margin-bottom: 20rpx;
}
</style>
