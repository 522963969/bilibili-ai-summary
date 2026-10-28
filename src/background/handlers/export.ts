import { CONTENT_SCRIPT_TIMEOUT_MS, MUBU_APP_URL } from '@/core/config/app';
import type { ContentRequestMessage } from '@/core/messaging/contracts';
import { withTimeout } from '@/core/utils/async';
import type { HandlerRegistry } from '../router';

/**
 * 导出相关消息。
 *
 * 生成 Markdown / 幕布大纲是纯函数，由面板直接完成，这里只承担两件必须经过
 * 扩展或页面能力的事情：
 * - 打开幕布工作台（chrome.tabs.create 不需要 tabs 权限）
 * - 让目标页面的顶层文档下载文件（跨源 iframe 里发起会被浏览器取消）
 *
 * 因此没有引入 downloads 之类的新权限。
 */
export function createExportHandlers(): Pick<
  HandlerRegistry,
  'export.openMubu' | 'export.download'
> {
  return {
    'export.openMubu': async () => {
      // active: true 让新标签页直接获得焦点，用户切过去就能粘贴，不用再找标签页
      const tab = await chrome.tabs.create({ url: MUBU_APP_URL, active: true });
      return { opened: typeof tab.id === 'number' };
    },

    'export.download': async ({ tabId, fileName, text, mime, encoding }) => {
      const message: ContentRequestMessage = {
        type: 'content.download',
        payload: { fileName, text, mime, encoding }
      };
      const response = await withTimeout(
        chrome.tabs.sendMessage<ContentRequestMessage, { started?: boolean }>(tabId, message),
        CONTENT_SCRIPT_TIMEOUT_MS,
        '页面脚本响应超时'
      );
      return { started: Boolean(response?.started) };
    }
  };
}
