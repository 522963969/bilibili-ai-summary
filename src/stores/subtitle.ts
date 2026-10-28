import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { AppError } from '@/core/errors/app-error';
import { messageClient } from '@/core/messaging/client';
import { readSubtitleFile } from '@/core/subtitle/file-input';
import { SUBTITLE_LIMITS, type NormalizedSubtitle, type SubtitleDiscovery } from '@/core/subtitle/types';

type BusyKind = 'idle' | 'discover' | 'fetch' | 'import';

/** 字幕状态：发现、获取、导入、清除。 */
export const useSubtitleStore = defineStore('subtitle', () => {
  const discovery = ref<SubtitleDiscovery | null>(null);
  const subtitle = ref<NormalizedSubtitle | null>(null);
  const busy = ref<BusyKind>('idle');
  const error = ref<string | null>(null);
  const selectedTrackId = ref<string | null>(null);

  const hasSubtitle = computed(() => (subtitle.value?.cues.length ?? 0) > 0);
  const availableTracks = computed(
    () => discovery.value?.tracks.filter((track) => !track.locked && track.url !== null) ?? []
  );
  const previewCues = computed(() => subtitle.value?.cues.slice(0, 4) ?? []);
  const statusMessage = computed(() => {
    const current = discovery.value;
    if (!current) return '';
    return current.availability === 'ok' ? '' : current.message;
  });
  const isLoading = computed(() => busy.value !== 'idle');

  function reset(): void {
    discovery.value = null;
    subtitle.value = null;
    selectedTrackId.value = null;
    error.value = null;
    busy.value = 'idle';
  }

  async function loadCached(videoKey: string): Promise<void> {
    try {
      const response = await messageClient.send('subtitle.getCached', { videoKey });
      subtitle.value = response.subtitle;
    } catch {
      // 缓存读取失败不应阻塞主流程，界面按“未获取”处理
    }
  }

  async function discover(tabId: number): Promise<SubtitleDiscovery | null> {
    busy.value = 'discover';
    error.value = null;
    try {
      const result = await messageClient.send('subtitle.discover', { tabId });
      discovery.value = result;
      const first = result.tracks.find((track) => !track.locked && track.url !== null);
      selectedTrackId.value = first?.id ?? null;
      return result;
    } catch (cause) {
      error.value = AppError.from(cause).message;
      return null;
    } finally {
      busy.value = 'idle';
    }
  }

  async function fetchTrack(tabId: number, trackId: string): Promise<void> {
    busy.value = 'fetch';
    error.value = null;
    try {
      const result = await messageClient.send('subtitle.fetch', { tabId, trackId });
      subtitle.value = result;
      selectedTrackId.value = trackId;
    } catch (cause) {
      error.value = AppError.from(cause).message;
    } finally {
      busy.value = 'idle';
    }
  }

  /** 发现后立即获取首条可用轨道；多条轨道时由用户在下拉中切换。 */
  async function discoverAndFetch(tabId: number): Promise<void> {
    const result = await discover(tabId);
    const trackId = selectedTrackId.value;
    if (result && result.availability === 'ok' && trackId) {
      await fetchTrack(tabId, trackId);
    }
  }

  async function importFile(tabId: number, file: File): Promise<NormalizedSubtitle | null> {
    busy.value = 'import';
    error.value = null;
    try {
      if (file.size > SUBTITLE_LIMITS.maxFileBytes) {
        throw new AppError('E_SUBTITLE_PARSE_FAILED', {
          message: `字幕文件超过 ${Math.round(SUBTITLE_LIMITS.maxFileBytes / 1024 / 1024)}MB 上限`
        });
      }
      const content = await readSubtitleFile(file);
      const result = await messageClient.send('subtitle.import', {
        tabId,
        fileName: file.name,
        content
      });
      subtitle.value = result;
      return result;
    } catch (cause) {
      error.value = AppError.from(cause).message;
      return null;
    } finally {
      busy.value = 'idle';
    }
  }

  async function clear(videoKey: string): Promise<boolean> {
    try {
      await messageClient.send('subtitle.clear', { videoKey });
      subtitle.value = null;
      return true;
    } catch (cause) {
      error.value = AppError.from(cause).message;
      return false;
    }
  }

  return {
    discovery,
    subtitle,
    busy,
    error,
    selectedTrackId,
    hasSubtitle,
    availableTracks,
    previewCues,
    statusMessage,
    isLoading,
    reset,
    loadCached,
    discover,
    discoverAndFetch,
    fetchTrack,
    importFile,
    clear
  };
});
