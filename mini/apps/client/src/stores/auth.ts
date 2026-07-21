import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiLogin, apiRegister } from '@/api/http'
import { storageGet, storageRemove, storageSet } from '@/repository/storage'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(storageGet<string>('auth_token', ''))
  const userId = ref(storageGet<string>('auth_userId', ''))
  const username = ref(storageGet<string>('auth_username', ''))

  const isLoggedIn = computed(() => !!token.value)

  function persist() {
    storageSet('auth_token', token.value)
    storageSet('auth_userId', userId.value)
    storageSet('auth_username', username.value)
  }

  async function register(name: string, password: string) {
    const res = await apiRegister(name, password)
    token.value = res.accessToken
    userId.value = res.userId
    username.value = res.username
    persist()
  }

  async function login(name: string, password: string) {
    const res = await apiLogin(name, password)
    token.value = res.accessToken
    userId.value = res.userId
    username.value = res.username
    persist()
  }

  function logout() {
    token.value = ''
    userId.value = ''
    username.value = ''
    storageRemove('auth_token')
    storageRemove('auth_userId')
    storageRemove('auth_username')
  }

  return { token, userId, username, isLoggedIn, register, login, logout }
})
