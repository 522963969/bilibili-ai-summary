import { AppError } from '@/core/errors/app-error';
import { parseBilibiliVideoUrl } from '@/core/video/parse-video-url';
import type { TabIdentity, VideoIdentity } from '@/core/video/types';

/**
 * 标签页身份解析。
 *
 * 关键点：Content Script 与页面内面板（iframe）发消息时带有 `sender.tab`，
 * 其中 `url` 一定可读（页面脚本本身就注入在该页上），因此这条路径
 * 不依赖 `activeTab` 权限。只有扩展弹窗（Popup）才需要回退到 query。
 */

/** 从 URL 解析并校验视频身份，失败时抛出带用户提示的错误。 */
export function assertVideoIdentity(url: string | null | undefined): VideoIdentity {
  if (!url) {
    throw new AppError('E_NOT_BILIBILI_PAGE', {
      message: '无法读取当前标签页地址，请在 B 站视频页使用，或重新点击扩展图标'
    });
  }
  const identity = parseBilibiliVideoUrl(url);
  if (!identity) {
    throw new AppError('E_NOT_BILIBILI_PAGE', {
      message: '当前标签页不是 B 站视频播放页，重试前请先切回视频页'
    });
  }
  if (identity.kind !== 'video') {
    throw new AppError('E_UNSUPPORTED_PAGE', { message: '番剧页面暂不支持字幕获取' });
  }
  return identity;
}

interface TabLike {
  id?: number;
  url?: string;
  title?: string;
}

function isSameTab(sender: chrome.runtime.MessageSender, tabId: number): boolean {
  return sender.tab?.id === tabId && typeof sender.tab.url === 'string' && sender.tab.url.length > 0;
}

/**
 * 以标签页真实地址为准解析视频身份，避免客户端传入伪造的 bvid。
 * 优先使用 sender.tab（无需额外权限），其次回退 chrome.tabs.get。
 */
export async function identityFromTab(
  tabId: number,
  sender?: chrome.runtime.MessageSender
): Promise<VideoIdentity> {
  if (sender && isSameTab(sender, tabId)) {
    return assertVideoIdentity(sender.tab?.url);
  }

  let tab: TabLike;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new AppError('E_NO_ACTIVE_TAB', { message: '目标标签页已关闭，请重新打开视频页' });
  }
  return assertVideoIdentity(tab.url);
}

/** 读取发起方标签页的基本信息，供 Content Script 自报身份使用。 */
export async function describeSenderTab(sender: chrome.runtime.MessageSender): Promise<TabIdentity> {
  const tab = sender.tab;
  const url = typeof tab?.url === 'string' ? tab.url : null;
  const title = typeof tab?.title === 'string' ? tab.title : null;
  const tabId = typeof tab?.id === 'number' ? tab.id : null;

  if (!url) {
    return {
      tabId,
      url: null,
      title,
      identity: null,
      reason: '无法读取页面地址，请刷新 B 站页面后重试'
    };
  }

  const identity = parseBilibiliVideoUrl(url);
  if (!identity) {
    return { tabId, url, title, identity: null, reason: '当前页面不是 B 站视频播放页' };
  }
  if (identity.kind !== 'video') {
    return { tabId, url, title, identity: null, reason: '番剧页面暂不支持' };
  }
  return { tabId, url, title, identity, reason: null };
}

/** 取发起方标签页，用于「以页面为准」的识别路径。url 可能为 null（无权限时）。 */
export async function senderTabOrActive(
  sender: chrome.runtime.MessageSender
): Promise<{ tabId: number; url: string | null; title: string } | null> {
  if (sender.tab?.id !== undefined) {
    return {
      tabId: sender.tab.id,
      url: typeof sender.tab.url === 'string' ? sender.tab.url : null,
      title: typeof sender.tab.title === 'string' ? sender.tab.title : ''
    };
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab?.id !== undefined) {
      return {
        tabId: tab.id,
        url: typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : null,
        title: tab.title ?? ''
      };
    }
  } catch {
    return null;
  }
  return null;
}
