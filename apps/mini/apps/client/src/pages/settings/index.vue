<template>
  <view class="page">
    <view class="card">
      <view class="section-title">账号</view>
      <view v-if="auth.isLoggedIn" class="muted">已登录：{{ auth.username }}</view>
      <view v-else class="muted">未登录（可纯本地使用；同步需登录。不支持密码找回）</view>
      <view class="row">
        <view v-if="!auth.isLoggedIn" class="btn-primary" @click="goAuth">登录 / 注册</view>
        <view v-else class="btn-ghost" @click="auth.logout()">退出登录</view>
      </view>
    </view>

    <view class="card">
      <view class="section-title">后端地址</view>
      <input v-model="apiBaseUrl" class="field" placeholder="http://localhost:3000" />
      <view class="row">
        <view class="btn-ghost" @click="pingBackend">Ping 后端</view>
      </view>
      <view v-if="backendPingMsg" class="muted ping-msg">{{ backendPingMsg }}</view>
    </view>

    <view class="card">
      <view class="section-title">DeepSeek Key</view>
      <input v-model="deepseekApiKey" class="field" password placeholder="sk-..." />
      <view class="section-title">Kimi Key</view>
      <input v-model="kimiApiKey" class="field" password placeholder="sk-..." />

      <view class="section-title">默认厂商</view>
      <picker :range="providerNames" @change="onProvider">
        <view class="picker">{{ providerLabel }}</view>
      </picker>
      <view class="section-title">默认模型</view>
      <picker :range="modelList" @change="onModel">
        <view class="picker">{{ defaultModel }}</view>
      </picker>

      <view class="row-between">
        <text>保存正文后自动维护大纲</text>
        <switch :checked="autoMaintainOutline" @change="onAutoMaintain" :color="themeControlColor" />
      </view>
      <view class="row-between">
        <text>对话默认注入大纲</text>
        <switch :checked="injectOutlineByDefault" @change="onInjectDefault" :color="themeControlColor" />
      </view>
      <view class="row-between">
        <text>关键词注入设定卡</text>
        <switch :checked="injectLoreByKeyword" @change="onInjectLore" :color="themeControlColor" />
      </view>

      <view class="row">
        <view class="btn-primary" @click="save">保存设置</view>
        <view class="btn-ghost" @click="ping">测通当前厂商</view>
      </view>
    </view>

    <view class="card">
      <view class="section-title">云端同步</view>
      <view class="muted">上传将覆盖云端；导入将覆盖本地。需登录。</view>
      <view class="row">
        <view class="btn-primary" :class="{ disabled: !auth.isLoggedIn }" @click="onUpload">上传</view>
        <view class="btn-ghost" :class="{ disabled: !auth.isLoggedIn }" @click="onImport">导入</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { pingProvider } from '@/ai/client'
import { importAll, uploadAll } from '@/sync'
import { PROVIDERS } from '@/constants/providers'
import { THEME_CONTROL_COLOR } from '@/constants/theme'
import type { Provider } from '@/types'
import { useAuthStore } from '@/stores/auth'
import { useNovelStore } from '@/stores/novel'
import { useSettingsStore } from '@/stores/settings'

const themeControlColor = THEME_CONTROL_COLOR

const auth = useAuthStore()
const settingsStore = useSettingsStore()
const novel = useNovelStore()
const s = settingsStore.settings

const apiBaseUrl = ref(s.apiBaseUrl)
const deepseekApiKey = ref(s.deepseekApiKey)
const kimiApiKey = ref(s.kimiApiKey)
const defaultProvider = ref<Provider>(s.defaultProvider)
const defaultModel = ref(s.defaultModel)
const autoMaintainOutline = ref(s.autoMaintainOutline)
const injectOutlineByDefault = ref(s.injectOutlineByDefault)
const injectLoreByKeyword = ref(s.injectLoreByKeyword !== false)
const backendPingMsg = ref('')

const providerNames = PROVIDERS.map((p) => p.name)
const providerLabel = computed(
  () => PROVIDERS.find((p) => p.id === defaultProvider.value)?.name || '',
)
const modelList = computed(
  () => PROVIDERS.find((p) => p.id === defaultProvider.value)?.models || [],
)

function onProvider(e: { detail: { value: string } }) {
  const p = PROVIDERS[Number(e.detail.value)]
  if (!p) return
  defaultProvider.value = p.id
  defaultModel.value = p.defaultModel
}

function onModel(e: { detail: { value: string } }) {
  const m = modelList.value[Number(e.detail.value)]
  if (m) defaultModel.value = m
}

function onAutoMaintain(e: { detail: { value: boolean } }) {
  autoMaintainOutline.value = e.detail.value
}

function onInjectDefault(e: { detail: { value: boolean } }) {
  injectOutlineByDefault.value = e.detail.value
}

function onInjectLore(e: { detail: { value: boolean } }) {
  injectLoreByKeyword.value = e.detail.value
}

function save() {
  settingsStore.save({
    apiBaseUrl: apiBaseUrl.value.trim(),
    deepseekApiKey: deepseekApiKey.value.trim(),
    kimiApiKey: kimiApiKey.value.trim(),
    defaultProvider: defaultProvider.value,
    defaultModel: defaultModel.value,
    autoMaintainOutline: autoMaintainOutline.value,
    injectOutlineByDefault: injectOutlineByDefault.value,
    injectLoreByKeyword: injectLoreByKeyword.value,
  })
  uni.showToast({ title: '已保存', icon: 'success' })
}

/** 用当前输入框地址请求公开接口，测后端连通（不依赖登录） */
async function pingBackend() {
  const base = apiBaseUrl.value.trim().replace(/\/$/, '')
  if (!base) {
    uni.showToast({ title: '请先填写后端地址', icon: 'none' })
    return
  }
  // 先写入设置，便于后续登录/同步用同一地址
  settingsStore.save({ apiBaseUrl: base })
  backendPingMsg.value = '请求中…'
  const started = Date.now()
  try {
    uni.showLoading({ title: 'Ping 后端' })
    const res = await new Promise<UniApp.RequestSuccessCallbackResult>((resolve, reject) => {
      uni.request({
        url: `${base}/health`,
        method: 'GET',
        timeout: 8000,
        success: resolve,
        fail: reject,
      })
    })
    const ms = Date.now() - started
    if (res.statusCode >= 200 && res.statusCode < 300) {
      backendPingMsg.value = `OK ${res.statusCode} · ${ms}ms`
      uni.showToast({ title: '后端连通', icon: 'success' })
    } else {
      backendPingMsg.value = `HTTP ${res.statusCode} · ${ms}ms`
      uni.showToast({ title: `HTTP ${res.statusCode}`, icon: 'none' })
    }
  } catch (e) {
    const msg = (e as UniApp.GeneralCallbackResult)?.errMsg || (e as Error).message || '失败'
    backendPingMsg.value = msg
    uni.showToast({ title: msg.slice(0, 40), icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

async function ping() {
  save()
  try {
    uni.showLoading({ title: '测通中' })
    const key =
      defaultProvider.value === 'deepseek' ? deepseekApiKey.value : kimiApiKey.value
    const text = await pingProvider(defaultProvider.value, key.trim(), defaultModel.value)
    uni.showToast({ title: text.slice(0, 20) || '成功', icon: 'none' })
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function goAuth() {
  uni.navigateTo({ url: '/pages/auth/index' })
}

/** hideLoading 放在 toast 之前，否则会把刚弹出的失败/成功提示冲掉 */
function syncErrorToast(e: unknown, fallback: string) {
  const raw = e instanceof Error ? e.message : ''
  let title = raw.trim() || fallback
  if (/no snapshot found/i.test(title)) title = '云端暂无数据，请先上传'
  uni.showToast({ title, icon: 'none', duration: 2500 })
}

function onUpload() {
  if (!auth.isLoggedIn) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    return
  }
  uni.showModal({
    title: '确认上传',
    content: '将用本地数据覆盖云端（含 API Key）',
    success: async (res) => {
      if (!res.confirm) return
      try {
        uni.showLoading({ title: '上传中', mask: true })
        await uploadAll(auth.token)
        uni.hideLoading()
        uni.showToast({ title: '上传成功', icon: 'success' })
      } catch (e) {
        uni.hideLoading()
        syncErrorToast(e, '上传失败')
      }
    },
  })
}

function onImport() {
  if (!auth.isLoggedIn) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    return
  }
  uni.showModal({
    title: '确认导入',
    content: '将用云端数据覆盖本地（含 API Key）',
    success: async (res) => {
      if (!res.confirm) return
      try {
        uni.showLoading({ title: '导入中', mask: true })
        await importAll(auth.token)
        settingsStore.reload()
        novel.refresh()
        // refresh local form fields
        const ns = settingsStore.settings
        apiBaseUrl.value = ns.apiBaseUrl
        deepseekApiKey.value = ns.deepseekApiKey
        kimiApiKey.value = ns.kimiApiKey
        defaultProvider.value = ns.defaultProvider
        defaultModel.value = ns.defaultModel
        autoMaintainOutline.value = ns.autoMaintainOutline
        injectOutlineByDefault.value = ns.injectOutlineByDefault
        injectLoreByKeyword.value = ns.injectLoreByKeyword !== false
        uni.hideLoading()
        uni.showToast({ title: '导入成功', icon: 'success' })
      } catch (e) {
        uni.hideLoading()
        syncErrorToast(e, '导入失败')
      }
    },
  })
}
</script>

<style scoped>
.page {
  padding: 24rpx;
}
.section-title {
  font-weight: 600;
  margin: 12rpx 0;
}
.field {
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
  margin-bottom: 12rpx;
}
.picker {
  background: var(--color-surface-muted);
  padding: 16rpx;
  border-radius: 8rpx;
  margin-bottom: 12rpx;
}
.row {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
}
.row > view {
  flex: 1;
}
.row-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 12rpx 0;
}
.disabled {
  opacity: 0.45;
}
.ping-msg {
  margin-top: 8rpx;
  word-break: break-all;
}
</style>
