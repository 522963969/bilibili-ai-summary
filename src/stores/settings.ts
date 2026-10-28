import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { AppError } from '@/core/errors/app-error';
import { messageClient } from '@/core/messaging/client';
import type { ExtensionSettings } from '@/core/settings/types';

/** 设置状态：所有读取都经过 Service Worker，保证与存储一致。 */
export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<ExtensionSettings | null>(null);
  const modelConfigured = ref(false);
  const visionConfigured = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const theme = computed(() => settings.value?.general.theme ?? 'auto');

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const snapshot = await messageClient.send('settings.get');
      settings.value = snapshot.settings;
      modelConfigured.value = snapshot.modelConfigured;
      visionConfigured.value = snapshot.visionConfigured;
    } catch (cause) {
      error.value = AppError.from(cause).message;
    } finally {
      loading.value = false;
    }
  }

  return { settings, modelConfigured, visionConfigured, loading, error, theme, load };
});
