/**
 * 视频领域模型。
 * 与具体平台解耦：VideoIdentity 描述“这是哪一个视频”，
 * VideoPageContext 描述“页面上还能读到哪些信息”。
 */

export type VideoPlatform = 'bilibili';
export type BilibiliPageKind = 'video' | 'bangumi';

export interface VideoIdentity {
  platform: VideoPlatform;
  kind: BilibiliPageKind;
  /** 普通投稿的 BV 号，番剧为 null */
  bvid: string | null;
  /** 普通投稿的 av 号，未知为 null */
  aid: number | null;
  /** 番剧 ep 号 */
  epId: string | null;
  /** 番剧 ss 号 */
  seasonId: string | null;
  /** 分 P，从 1 开始 */
  page: number;
  /** 用于缓存与去重的稳定键，例如 BV1xx411c7mD#p2 */
  key: string;
  /** 去除跟踪参数的规范链接 */
  canonicalUrl: string;
}

export interface VideoPageContext {
  /** 页面标题（取自 DOM 或 og:title） */
  title: string;
  /** UP 主名称，无法读取时为 null */
  author: string | null;
  /** 视频时长（秒），无法读取时为 null */
  durationSeconds: number | null;
  /** 采集时间 */
  collectedAt: number;
}

export interface ResolvedVideo {
  identity: VideoIdentity;
  tabId: number;
  tabUrl: string;
  /** 标签页标题（已清理 B 站后缀），作为页面上下文缺失时的展示兜底 */
  fallbackTitle: string;
  /** 来自 Content Script 的页面上下文，未连接时为 null */
  pageContext: VideoPageContext | null;
  /** Content Script 是否已在该页面注入并响应 */
  contentScriptAvailable: boolean;
  /** 标题是否只能退化使用标签页标题 */
  degraded: boolean;
}

/**
 * 当前标签页视频识别结果。
 * 使用可判别联合，调用方必须显式处理非视频页面。
 */
export type ActiveVideoResolution =
  | { status: 'ready'; video: ResolvedVideo }
  | { status: 'unsupported-page'; reason: string; tabUrl: string | null }
  | { status: 'no-active-tab' };

/**
 * Content Script 自报身份的结果。
 *
 * 为什么需要它：`activeTab` 只在用户点击扩展图标时授予，Popup 以普通标签页或
 * iframe 形式打开时读不到 `tab.url`。而 Content Script 发消息时，
 * `sender.tab.url` 一定可读（因为它本来就注入在该页面上）。
 * 因此页面内入口通过这条消息拿到真实的 tabId 与视频身份，不依赖 activeTab。
 */
export interface TabIdentity {
  tabId: number | null;
  url: string | null;
  title: string | null;
  /** 从 url 解析出的视频身份，非视频页为 null */
  identity: VideoIdentity | null;
  /** identity 为 null 时说明原因 */
  reason: string | null;
}
