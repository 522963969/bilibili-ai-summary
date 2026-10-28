import { STORAGE_KEYS } from '@/core/config/defaults';
import { AppError } from '@/core/errors/app-error';
import type { KeyValueStore } from '@/core/storage/store';
import type { SubtitleService } from '../subtitle-service';
import { identityFromTab } from '../tab-identity';
import type { HandlerRegistry } from '../router';

export interface SubtitleHandlerDeps {
  subtitles: SubtitleService;
  /** 清字幕时一并清掉该视频的总结与分块缓存，避免留下对不上的旧结论 */
  store: KeyValueStore;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTabId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError('E_INVALID_PAYLOAD', { details: 'tabId 必须是非负整数' });
  }
  return value;
}

function assertVideoKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 80) {
    throw new AppError('E_INVALID_PAYLOAD', { details: 'videoKey 不合法' });
  }
  return value;
}

export function createSubtitleHandlers(
  deps: SubtitleHandlerDeps
): Pick<
  HandlerRegistry,
  | 'subtitle.discover'
  | 'subtitle.fetch'
  | 'subtitle.import'
  | 'subtitle.getCached'
  | 'subtitle.clear'
> {
  return {
    'subtitle.discover': async (payload, sender) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 tabId' });
      }
      const tabId = assertTabId(payload.tabId);
      const identity = await identityFromTab(tabId, sender);
      return deps.subtitles.discover(identity, tabId);
    },

    'subtitle.fetch': async (payload, sender) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 tabId 与 trackId' });
      }
      const tabId = assertTabId(payload.tabId);
      const trackId = payload.trackId;
      if (typeof trackId !== 'string' || trackId.trim().length === 0) {
        throw new AppError('E_INVALID_PAYLOAD', { details: 'trackId 不合法' });
      }
      const identity = await identityFromTab(tabId, sender);
      return deps.subtitles.fetch(identity, tabId, trackId);
    },

    'subtitle.import': async (payload, sender) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少文件内容' });
      }
      const tabId = assertTabId(payload.tabId);
      const fileName = typeof payload.fileName === 'string' ? payload.fileName : '';
      const content = payload.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new AppError('E_INVALID_PAYLOAD', { message: '字幕文件内容为空' });
      }
      const identity = await identityFromTab(tabId, sender);
      return deps.subtitles.importFromFile(identity, fileName, content);
    },

    'subtitle.getCached': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      const subtitle = await deps.subtitles.getCached(videoKey);
      return { subtitle };
    },

    'subtitle.clear': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      const result = await deps.subtitles.clear(videoKey);
      await deps.store.remove(`${STORAGE_KEYS.summaryPrefix}${videoKey}`);
      await deps.store.remove(`${STORAGE_KEYS.summaryChunkPrefix}${videoKey}`);
      await deps.store.remove(`${STORAGE_KEYS.frameScriptPrefix}${videoKey}`);
      return result;
    }
  };
}
