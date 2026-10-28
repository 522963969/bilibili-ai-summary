import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { AppError } from '@/core/errors/app-error';
import { messageClient } from '@/core/messaging/client';
import type { ActiveVideoResolution } from '@/core/video/types';

/** 当前标签页视频识别状态。 */
export const useVideoStore = defineStore('video', () => {
  const resolution = ref<ActiveVideoResolution | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const video = computed(() =>
    resolution.value?.status === 'ready' ? resolution.value.video : null
  );

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      resolution.value = await messageClient.send('video.resolveActive');
    } catch (cause) {
      error.value = AppError.from(cause).message;
      resolution.value = null;
    } finally {
      loading.value = false;
    }
  }

  return { resolution, video, loading, error, refresh };
});
