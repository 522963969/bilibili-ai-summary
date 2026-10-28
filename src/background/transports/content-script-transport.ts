import type { BilibiliTransport, TransportResponse } from '@/core/bilibili/api';
import { AppError } from '@/core/errors/app-error';
import type { ContentFetchResult, ContentRequestMessage } from '@/core/messaging/contracts';
import { TimeoutError, withTimeout } from '@/core/utils/async';

function isFetchResult(value: unknown): value is ContentFetchResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === false) return typeof record.message === 'string';
  return record.ok === true && typeof record.status === 'number' && typeof record.text === 'string';
}

/**
 * 页面内同源通道。
 *
 * 由 B 站页面自己的 origin 发起请求，Cookie 天然按站点规则携带，
 * 用于 Service Worker 直连未拿到登录态时补位。
 * Content Script 侧对 URL 做同样的域名白名单校验，避免成为任意代理。
 */
export class ContentScriptTransport implements BilibiliTransport {
  constructor(private readonly tabId: number) {}

  async get(url: string, timeoutMs: number): Promise<TransportResponse> {
    const message: ContentRequestMessage = { type: 'content.fetchJson', payload: { url } };
    try {
      const response = await withTimeout(
        chrome.tabs.sendMessage<ContentRequestMessage, unknown>(this.tabId, message),
        timeoutMs + 1000,
        '页面内请求超时'
      );
      if (!isFetchResult(response)) {
        throw new AppError('E_CONTENT_SCRIPT_UNAVAILABLE', {
          message: '页面脚本返回了无效的响应'
        });
      }
      if (!response.ok) {
        throw new AppError('E_CONTENT_SCRIPT_UNAVAILABLE', {
          message: '页面内请求失败',
          details: response.message
        });
      }
      return { status: response.status, text: response.text, via: 'content-script' };
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new AppError('E_TIMEOUT', { message: '页面内请求超时', details: error.message });
      }
      if (AppError.isAppError(error)) throw error;
      throw new AppError('E_CONTENT_SCRIPT_UNAVAILABLE', {
        message: '页面脚本不可用，请刷新 B 站页面后重试',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
