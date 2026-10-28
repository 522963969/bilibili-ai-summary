import { AppError } from '@/core/errors/app-error';
import type { SummaryTaskSnapshot } from '@/core/summary/types';
import type { SummaryService } from '../summary-service';
import { identityFromTab } from '../tab-identity';
import { normalizeTabTitle } from './video';
import type { HandlerRegistry } from '../router';

export interface SummaryHandlerDeps {
  summary: SummaryService;
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

export function createSummaryHandlers(
  deps: SummaryHandlerDeps
): Pick<HandlerRegistry, 'summary.start' | 'summary.get' | 'summary.cancel'> {
  return {
    'summary.start': async (payload, sender): Promise<SummaryTaskSnapshot> => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 tabId' });
      }
      const tabId = assertTabId(payload.tabId);
      // 身份以标签页真实地址为准，避免调用方伪造 videoKey 读取他人缓存
      const identity = await identityFromTab(tabId, sender);

      let videoTitle: string | null = null;
      if (sender.tab?.id === tabId && sender.tab.title) {
        videoTitle = normalizeTabTitle(sender.tab.title);
      } else {
        try {
          const tab = await chrome.tabs.get(tabId);
          videoTitle = normalizeTabTitle(tab.title);
        } catch {
          videoTitle = null;
        }
      }

      return deps.summary.start(identity.key, videoTitle);
    },

    'summary.get': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      return { task: await deps.summary.get(videoKey) };
    },

    'summary.cancel': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      return deps.summary.cancel(videoKey);
    }
  };
}
