import { defineManifest } from '@crxjs/vite-plugin';
import {
  APP_DESCRIPTION,
  APP_NAME,
  APP_SHORT_NAME,
  APP_VERSION,
  BILIBILI_HOST_MATCH,
  BILIBILI_VIDEO_MATCHES
} from './core/config/app';

/**
 * Manifest V3 配置。
 *
 * 权限策略（最小权限）：
 * - storage      : 保存设置、历史与任务状态
 * - activeTab    : 点击扩展图标后读取当前标签页地址，用于识别视频
 * - content_scripts 仅注入 B 站视频播放页
 * - 自定义模型域名走 optional_host_permissions，由用户在设置页显式授权
 * - host_permissions 仅覆盖 B 站接口与字幕 CDN（阶段 2 起用于复用用户会话获取字幕）
 * 未申请 cookies / webRequest / debugger / tabs 等宽泛权限。
 */
export default defineManifest({
  manifest_version: 3,
  name: APP_NAME,
  short_name: APP_SHORT_NAME,
  description: APP_DESCRIPTION,
  version: APP_VERSION,
  // Chrome 100 起 MV3 的 Promise 版扩展 API 与 ESM Service Worker 均已稳定。
  // 门槛高于此值会让仍然支持 MV3 的浏览器（部分国产 Chromium 内核）直接拒绝加载。
  minimum_chrome_version: '100',
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  },
  action: {
    default_title: APP_NAME,
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png'
    }
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: [...BILIBILI_VIDEO_MATCHES],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ],
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true
  },
  /**
   * 面板页面需要被 Content Script 以 iframe 嵌入 B 站页面，
   * 因此必须列入 web_accessible_resources。
   * matches 只能是宿主级通配，写 `/video/*` 会让整个扩展被拒绝加载。
   */
  web_accessible_resources: [
    {
      resources: ['src/panel/index.html'],
      matches: [BILIBILI_HOST_MATCH]
    }
  ],
  permissions: ['storage', 'activeTab'],
  host_permissions: ['https://api.bilibili.com/*', 'https://*.hdslb.com/*'],
  optional_host_permissions: ['https://*/*', 'http://*/*']
});
