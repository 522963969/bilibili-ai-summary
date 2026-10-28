import { CONTENT_SCRIPT_TIMEOUT_MS } from '@/core/config/app';
import type { ContentRequestMessage } from '@/core/messaging/contracts';
import type { VideoPageContext } from '@/core/video/types';
import { withTimeout } from '@/core/utils/async';

function isVideoPageContext(value: unknown): value is VideoPageContext {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.title === 'string' && typeof record.collectedAt === 'number';
}

/**
 * 向目标标签页的 Content Script 请求页面上下文。
 * Content Script 未注入或页面刚刷新时可能失败，此时返回 null 由上层降级处理。
 */
export async function requestPageContext(tabId: number): Promise<VideoPageContext | null> {
  const message: ContentRequestMessage = {
    type: 'content.collectPageContext',
    payload: undefined
  };
  try {
    const response = await withTimeout(
      chrome.tabs.sendMessage<ContentRequestMessage, unknown>(tabId, message),
      CONTENT_SCRIPT_TIMEOUT_MS,
      '页面脚本响应超时'
    );
    return isVideoPageContext(response) ? response : null;
  } catch {
    return null;
  }
}
