import type { HandlerRegistry } from '../router';
import { describeSenderTab } from '../tab-identity';

/**
 * Content Script 自报身份。
 * 返回的 tabId 与 url 来自 sender.tab，因此不依赖 activeTab 权限，
 * 页面内入口（行式按钮 / 就地展开面板）可以稳定拿到当前视频。
 */
export function createTabHandlers(): Pick<HandlerRegistry, 'tab.whoami'> {
  return {
    'tab.whoami': async (_payload, sender) => describeSenderTab(sender)
  };
}
