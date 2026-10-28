import type { BilibiliTransport, TransportResponse } from '@/core/bilibili/api';
import { AppError } from '@/core/errors/app-error';

/**
 * Service Worker 直连通道。
 *
 * 使用 credentials: 'include' 复用浏览器会话。扩展对目标域名持有 host 权限时，
 * 响应不受 CORS 限制，因此可以读取 api.bilibili.com 的 JSON。
 * 若浏览器因 SameSite 策略未携带 Cookie，上层会通过页面内通道补位。
 */
export class FetchTransport implements BilibiliTransport {
  async get(url: string, timeoutMs: number): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      });
      const text = await response.text();
      return { status: response.status, text, via: 'background' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AppError('E_TIMEOUT', {
          message: 'B 站接口响应超时',
          details: `${timeoutMs}ms`
        });
      }
      throw new AppError('E_NETWORK_FAILED', {
        message: '无法连接 B 站接口，请检查网络',
        details: error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
