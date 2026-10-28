import { parseBilibiliVideoUrl } from '@/core/video/parse-video-url';
import type { ActiveVideoResolution, ResolvedVideo } from '@/core/video/types';
import { requestPageContext } from '../page-context';
import { senderTabOrActive } from '../tab-identity';
import type { HandlerRegistry } from '../router';

const BILIBILI_TITLE_SUFFIX = /[_\-–—\s]*哔哩哔哩[_\-–—\s]*bilibili\s*$/i;

/** 清理标签页标题中的站点后缀，避免展示“标题_哔哩哔哩_bilibili”。 */
export function normalizeTabTitle(raw: string | undefined): string {
  const source = raw?.trim() ?? '';
  if (source.length === 0) return '未命名视频';
  const cleaned = source.replace(BILIBILI_TITLE_SUFFIX, '').trim();
  return cleaned.length > 0 ? cleaned : source;
}

interface TabDescriptor {
  tabId: number;
  url: string | null;
  title: string;
}

async function queryActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const current = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current[0]) return current[0];
    const lastFocused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return lastFocused[0] ?? null;
  } catch {
    return null;
  }
}

/** 把标签页描述解析成可用的视频信息。所有分支都返回可判别联合，不抛异常。 */
async function resolveFromDescriptor(tab: TabDescriptor): Promise<ActiveVideoResolution> {
  const tabUrl = tab.url ?? '';
  if (tabUrl.length === 0) {
    return {
      status: 'unsupported-page',
      reason: '无法读取当前标签页地址，请在 B 站视频页重新打开本面板',
      tabUrl: null
    };
  }

  const identity = parseBilibiliVideoUrl(tabUrl);
  if (!identity) {
    return {
      status: 'unsupported-page',
      reason: '当前标签页不是 B 站视频播放页',
      tabUrl
    };
  }

  if (identity.kind === 'bangumi') {
    return {
      status: 'unsupported-page',
      reason: '番剧页面结构与普通投稿不同，第一版暂不支持',
      tabUrl
    };
  }

  const pageContext = await requestPageContext(tab.tabId);
  const video: ResolvedVideo = {
    identity,
    tabId: tab.tabId,
    tabUrl,
    fallbackTitle: normalizeTabTitle(tab.title),
    pageContext,
    contentScriptAvailable: pageContext !== null,
    degraded: pageContext === null
  };
  return { status: 'ready', video };
}

export function createVideoHandlers(): Pick<
  HandlerRegistry,
  'video.resolveActive' | 'video.resolveFromTab'
> {
  return {
    'video.resolveActive': async (): Promise<ActiveVideoResolution> => {
      const tab = await queryActiveTab();
      if (!tab || tab.id === undefined) return { status: 'no-active-tab' };
      return resolveFromDescriptor({
        tabId: tab.id,
        url: typeof tab.url === 'string' ? tab.url : null,
        title: tab.title ?? ''
      });
    },

    /**
     * 以消息发起方所在标签页为准。
     * 页面内面板（iframe）与 Content Script 走这条路径时不需要 activeTab 权限。
     */
    'video.resolveFromTab': async (_payload, sender): Promise<ActiveVideoResolution> => {
      const tab = await senderTabOrActive(sender);
      if (!tab) return { status: 'no-active-tab' };
      return resolveFromDescriptor(tab);
    }
  };
}
