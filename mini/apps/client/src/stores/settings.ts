import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getProvider, PROVIDERS } from '@/constants/providers'
import { localRepository } from '@/repository/localRepository'
import type { Provider, UserSettings } from '@/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<UserSettings>(localRepository.getSettings())

  function reload() {
    settings.value = localRepository.getSettings()
  }

  function save(partial: Partial<UserSettings>) {
    settings.value = { ...settings.value, ...partial }
    localRepository.saveSettings(settings.value)
  }

  function apiKeyFor(provider: Provider): string {
    return provider === 'deepseek'
      ? settings.value.deepseekApiKey
      : settings.value.kimiApiKey
  }

  function modelsFor(provider: Provider) {
    return getProvider(provider).models
  }

  return { settings, providers: PROVIDERS, reload, save, apiKeyFor, modelsFor }
})
