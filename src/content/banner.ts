import { messageClient } from '@/core/messaging/client';
import type { OpenPanelResult } from '@/core/messaging/contracts';
import type { TabIdentity } from '@/core/video/types';

/**
 * 页面内入口：右侧信息栏的「AI 总结视频」按钮 + 按钮下方就地展开的面板。
 *
 * 设计要点：
 * 1. 用 Shadow DOM 隔离样式，避免与 B 站自身 CSS 互相污染。
 * 2. 身份来自 `tab.whoami`（sender.tab），因此不需要 activeTab 权限。
 * 3. 展开区域是**普通文档流**（不是 fixed 抽屉），宽度跟随右侧栏，
 *    不遮挡播放器与评论区，收起时高度归零、不占空间。
 * 4. B 站是 SPA，切视频不刷新页面，这里轮询 location.href 做重建。
 */

const HOST_ID = 'bili-ai-summary-host';
const PANEL_PATH = 'src/panel/index.html';
/** 展开区域的目标高度，同时受视口高度约束（见 computePanelHeight）。 */
const PANEL_HEIGHT = 640;
const PANEL_MIN_HEIGHT = 380;
const PANEL_VIEWPORT_RESERVE = 150;
/** 浮层吸顶时与页头（B 站顶部导航 64px）保持的距离。 */
const HEADER_CLEARANCE = 76;

/** 右侧信息栏候选容器，按优先级从「最贴近用户预期位置」到兜底排列。 */

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let iframe: HTMLIFrameElement | null = null;
let entryButton: HTMLButtonElement | null = null;
let expandBox: HTMLDivElement | null = null;
let currentIdentity: TabIdentity | null = null;
let drawerOpen = false;
let lastHref = '';

const STYLE = `
  :host { all: initial; display: block; width: 100%; }
  * { box-sizing: border-box; }

  /* 入口：与 B 站右侧栏内的行式横幅同一形态（单行、40px、圆角 6px） */
  .entry {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 40px;
    padding: 0 12px;
    border: 1px solid var(--bd, #e3e5e7);
    border-radius: 6px;
    background: var(--bg, #fff);
    color: var(--fg, #18191c);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1;
    text-align: left;
    cursor: pointer;
    transition: border-color .18s, background .18s;
  }
  /* 强调色与扩展其它界面统一为 B 站粉 #fb7299 */
  .entry:hover { border-color: #fb7299; background: var(--bg-hover, #fffafc); }
  .entry:focus-visible { outline: 2px solid #fb7299; outline-offset: 1px; }

  .entry-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--icon-tile, #fff1f5);
  }
  .entry-icon svg { display: block; }

  .entry-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 500;
  }

  .entry-arrow {
    flex: none;
    color: var(--fg-sub, #9499a0);
    font-size: 14px;
    transition: transform .24s;
  }
  .entry[aria-expanded="true"] .entry-arrow { transform: rotate(90deg); }

  /* 展开区：文档流内，宽度跟随右侧栏；收起时高度为 0 且不占位 */
  .expand {
    height: 0;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 8px;
    transition: height .28s cubic-bezier(.4, 0, .2, 1), margin-top .28s, border-color .28s;
  }
  .expand[data-open="true"] {
    margin-top: 8px;
    border-color: var(--bd, #e3e5e7);
  }
  .expand iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
    background: var(--bg, #fff);
  }

  @media (prefers-color-scheme: dark) {
    :host {
      --bg: #1f2126;
      --bg-hover: #26282e;
      --bd: #33363d;
      --fg: #e6e8eb;
      --fg-sub: #8b919b;
      --icon-tile: #3a2630;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .expand, .entry, .entry-arrow { transition: none; }
  }
`;

/**
 * 把浮层对齐到右栏：横向贴住视频信息栏，纵向吸顶在页头下方。
 *
 * 入口不再参与页面布局（插在 Vue 管理的容器里会破坏评论区），所以位置要自己算：
 * 右栏还在视口内时与它顶部对齐，滚过去之后固定在页头下方，
 * 否则浮层会跟着页面滚出屏幕。
 */
function syncHostPosition(): void {
  if (!host) return;
  const anchor =
    document.querySelector('.up-panel-container') ??
    document.querySelector('.right-container-inner') ??
    document.querySelector('.right-container');

  if (!anchor) {
    host.style.left = 'auto';
    host.style.right = '20px';
    host.style.top = `${HEADER_CLEARANCE}px`;
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const width = Math.round(rect.width);
  const usableWidth = width >= 280 ? Math.min(width, 352) : 350;
  const top = Math.max(HEADER_CLEARANCE, Math.round(rect.top));

  host.style.right = 'auto';
  host.style.width = `${usableWidth}px`;
  host.style.left = `${Math.round(rect.left)}px`;
  host.style.top = `${top}px`;
}

let syncPending = false;

/** 滚动/尺寸变化高频触发，用 rAF 合并成每帧最多一次布局读取。 */
function scheduleSync(): void {
  if (syncPending) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    syncHostPosition();
  });
}

/** 面板高度取「目标高度」与「浮层下方可用高度」的较小值，避免超出屏幕。 */
function computePanelHeight(): number {
  const top = host ? Number.parseInt(host.style.top, 10) || HEADER_CLEARANCE : HEADER_CLEARANCE;
  const available = window.innerHeight - top - PANEL_VIEWPORT_RESERVE;
  return Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_HEIGHT, available));
}

function buildHost(): void {
  host = document.createElement('div');
  host.id = HOST_ID;
  /**
   * 必须挂在 body 上、用固定定位，不能插进 B 站的右栏容器。
   *
   * 实测（Edge 156，同一视频页各跑 3 次）：把入口插进 .right-container-inner 之后，
   * 该页面懒加载的评论组件 bili-comments 3/3 次都没有被创建，#commentapp 变成空节点，
   * 页面还多抛一条 Vue 的 HierarchyRequestError；不装扩展时 3/3 次评论组件都在。
   * 原因是右栏整棵子树由 #app 这一个 Vue 实例渲染，往里插外来节点会打乱它的
   * 子节点 diff，后续组件挂载随之失败。改成 body + fixed 之后评论区恢复。
   */
  host.style.cssText =
    'position:fixed;left:auto;right:20px;top:88px;width:350px;z-index:2147483000;display:block;';
  shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;

  entryButton = document.createElement('button');
  entryButton.className = 'entry';
  entryButton.type = 'button';
  entryButton.setAttribute('aria-label', '展开 AI 视频总结');
  entryButton.setAttribute('aria-expanded', 'false');
  entryButton.innerHTML = `
    <span class="entry-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 512 512" fill="#FB7299">
        <path d="M96 182 L236 256 L96 330 Z" stroke="#FB7299" stroke-width="20" stroke-linejoin="round" />
        <rect x="276" y="172" width="150" height="64" rx="32" />
        <rect x="276" y="276" width="94" height="64" rx="32" />
      </svg>
    </span>
    <span class="entry-title">AI 总结视频</span>
    <span class="entry-arrow">›</span>
  `;
  entryButton.addEventListener('click', () => {
    void togglePanel();
  });

  expandBox = document.createElement('div');
  expandBox.className = 'expand';
  expandBox.dataset.open = 'false';

  iframe = document.createElement('iframe');
  iframe.title = 'AI 视频总结面板';
  iframe.setAttribute('allow', 'clipboard-write');
  expandBox.append(iframe);

  shadow.append(style, entryButton, expandBox);
}

function panelUrl(): string {
  const params = new URLSearchParams();
  if (currentIdentity?.tabId !== undefined && currentIdentity?.tabId !== null) {
    params.set('tabId', String(currentIdentity.tabId));
  }
  if (currentIdentity?.identity) {
    params.set('videoKey', currentIdentity.identity.key);
  }
  return `${chrome.runtime.getURL(PANEL_PATH)}?${params.toString()}`;
}

/**
 * 设置展开区域的高度。
 *
 * 标签页处于后台时浏览器不推进 CSS 过渡，height 会一直停在起始值 0，
 * 表现为「点了没反应」。因此后台场景直接关掉过渡、立即生效；
 * 前台才走动画。
 */
function applyExpandHeight(px: number): void {
  if (!expandBox) return;
  if (document.visibilityState === 'visible') {
    expandBox.style.height = `${px}px`;
    return;
  }
  expandBox.style.transition = 'none';
  expandBox.style.height = `${px}px`;
  // 强制同步布局，让高度立刻提交，避免之后恢复过渡时又从头动画一次
  void expandBox.offsetHeight;
  expandBox.style.transition = '';
}

function setDrawerOpen(open: boolean): void {
  drawerOpen = open;
  if (!expandBox || !iframe) return;

  if (open) {
    const nextUrl = panelUrl();
    if (iframe.src !== nextUrl) iframe.src = nextUrl;
    applyExpandHeight(computePanelHeight());
    expandBox.dataset.open = 'true';
    // 浮层不参与页面布局，展开后只需确认位置仍然贴着右栏
    scheduleSync();
  } else {
    applyExpandHeight(0);
    expandBox.dataset.open = 'false';
  }
  entryButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

async function togglePanel(): Promise<void> {
  if (drawerOpen) {
    setDrawerOpen(false);
    return;
  }
  // 每次打开都刷新身份，避免长时间停留后分 P 已变化
  await refreshIdentity();
  setDrawerOpen(true);
}

async function refreshIdentity(): Promise<void> {
  try {
    currentIdentity = await messageClient.send('tab.whoami');
  } catch {
    currentIdentity = null;
  }
}

function isVideoPage(): boolean {
  return /^\/video\//.test(window.location.pathname);
}

async function mount(): Promise<void> {
  if (!isVideoPage()) {
    unmount();
    return;
  }

  if (host?.isConnected) return;

  await refreshIdentity();
  if (!currentIdentity?.identity) {
    // 解析不出视频身份时不注入，避免在非视频页留下空入口
    return;
  }

  if (!host) buildHost();
  if (!host) return;
  document.body.appendChild(host);
}

function unmount(): void {
  if (host?.isConnected) host.remove();
  drawerOpen = false;
}

/** 让 B 站播放器跳到指定秒数。找不到 video 元素时静默忽略。 */
function seekTo(seconds: number): void {
  const player = document.querySelector('video');
  if (!player || !Number.isFinite(seconds) || seconds < 0) return;
  try {
    player.currentTime = seconds;
    void player.play().catch(() => undefined);
  } catch {
    // 播放器尚未就绪时忽略，用户可稍后重试
  }
}

/** 监听面板内部发来的关闭与跳转请求。 */
function onMessage(event: MessageEvent): void {
  if (event.source !== iframe?.contentWindow) return;
  const data = event.data as { type?: unknown; seconds?: unknown } | null;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'bili-ai-summary:close') {
    setDrawerOpen(false);
    return;
  }
  if (data.type === 'bili-ai-summary:seek' && typeof data.seconds === 'number') {
    seekTo(data.seconds);
  }
}

/** 窗口尺寸变化时同步展开高度，避免小窗口下面板超出可视区域。 */
function onResize(): void {
  scheduleSync();
  if (drawerOpen) applyExpandHeight(computePanelHeight());
}

/** 从后台切回前台时再确认一次高度，防止过渡被暂停后停在中间态。 */
function onVisibilityChange(): void {
  if (drawerOpen) applyExpandHeight(computePanelHeight());
}

/**
 * 供 Popup 调用：把当前页面的面板直接展开。
 * 入口还没挂上时先补挂一次，避免用户因为标签页刚打开而看到「无反应」。
 */
export async function openPanel(): Promise<OpenPanelResult> {
  if (!isVideoPage()) return { opened: false, reason: 'not-video-page' };
  await mount();
  if (!host?.isConnected) return { opened: false, reason: 'entry-unavailable' };
  await refreshIdentity();
  if (!currentIdentity?.identity) return { opened: false, reason: 'identity-unresolved' };
  setDrawerOpen(true);
  return { opened: true, reason: null };
}

export function startEntry(): void {
  void mount().then(() => scheduleSync());
  window.addEventListener('message', onMessage);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  // capture: true 才能收到右栏这类内部滚动容器的 scroll
  window.addEventListener('scroll', scheduleSync, { capture: true, passive: true });

  // SPA 路由变化：URL 变了就重建入口与面板地址；
  // 未变化但宿主节点被 B 站重建掉时也要补回去。
  lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      void refreshIdentity().then(() => {
        if (!isVideoPage()) {
          unmount();
          return;
        }
        // 换视频后 iframe 里的 tabId / videoKey 已过期，强制重载面板
        if (drawerOpen && iframe) iframe.src = panelUrl();
        void mount().then(() => scheduleSync());
      });
      return;
    }
    if (isVideoPage() && (!host || !host.isConnected)) {
      void mount();
    }
  }, 1000);
}
