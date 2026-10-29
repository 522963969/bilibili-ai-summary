/**
 * 「面板认的视频」与「页面正在播的视频」是否同一个。
 *
 * 为什么需要：面板的视频身份来自标签页 URL（`sender.tab.url`），而页面信息
 * （标题、时长）来自 content script 读的 DOM，两者是两次独立取值。B 站是 SPA，
 * 站内切视频时实测 URL 会**先**变、DOM 后变（采样到过 path 已是新视频而 `h1`
 * 还是旧的中间帧），反过来也可能发生。只要面板恰好在窗口里挂载，就会拿着一半
 * 新一半旧的证据去取字幕——用户看到的就是「3 分钟的视频拿到了 6 分半的字幕，
 * 内容完全是另一支视频」。
 *
 * 这里只做一件事：拿两个来源的可复算字段对账，对不上就明确说出来。
 * 判据以**时长**为主（标题会被改、会被截断、分P 名还会覆盖它），标题只在
 * 时长不可用时兜底。
 */

export interface VideoSnapshot {
  /** 标题；null 表示这个来源没拿到 */
  title: string | null;
  /** 时长（秒）；null 表示这个来源没拿到 */
  durationSeconds: number | null;
}

export type IdentityMismatchBasis = 'duration' | 'title';

export interface IdentityVerdict {
  /** ok = 两边对得上，mismatch = 明显不是同一个视频，unknown = 证据不足 */
  kind: 'ok' | 'mismatch' | 'unknown';
  basis: IdentityMismatchBasis | null;
  /** 面向用户的一句话，`kind === 'mismatch'` 时可用 */
  message: string | null;
}

export const IDENTITY_TOLERANCE = {
  /** 短视频不做判定：广告、预告片的时长本来就对不齐 */
  minDurationSeconds: 120,
  /** 允许的绝对误差（秒） */
  absSeconds: 5,
  /** 允许的相对误差 */
  ratio: 0.05
} as const;

function clock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 标题归一化：去空白与标点，统一小写，用于「是否互相包含」这种宽松比对。 */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[【】[\]（）()《》「」『』“”"'‘’·:：,，.。、!！?？|/\\\-—_~～]/g, '');
}

/**
 * 两个标题是不是同一个（允许一边是另一边的截断）。
 *
 * 不要求相等：B 站会把长标题截断显示，也会在标题前加「【】」这类前缀。
 * 只要求一边包含另一边，且被包含的那边至少 6 个字——否则「视频」两个字
 * 能包含在几乎所有标题里，等于没判。
 */
export function isSameTitle(a: string | null, b: string | null): boolean {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;
  const [shortSide, longSide] = left.length <= right.length ? [left, right] : [right, left];
  return shortSide.length >= 6 && longSide.includes(shortSide);
}

function durationAllows(apiSeconds: number, pageSeconds: number): boolean {
  const allowance = Math.max(IDENTITY_TOLERANCE.absSeconds, pageSeconds * IDENTITY_TOLERANCE.ratio);
  return Math.abs(apiSeconds - pageSeconds) <= allowance;
}

/**
 * 对账。
 *
 * @param api  从 B 站接口读到的视频信息（`/x/web-interface/view`）
 * @param page 页面 DOM 上正在播放的视频信息
 */
export function checkVideoIdentity(api: VideoSnapshot, page: VideoSnapshot): IdentityVerdict {
  const apiDuration = api.durationSeconds;
  const pageDuration = page.durationSeconds;
  const bothDurations =
    apiDuration !== null &&
    pageDuration !== null &&
    apiDuration >= IDENTITY_TOLERANCE.minDurationSeconds &&
    pageDuration >= IDENTITY_TOLERANCE.minDurationSeconds;

  if (bothDurations && !durationAllows(apiDuration, pageDuration)) {
    return {
      kind: 'mismatch',
      basis: 'duration',
      message: `面板拿到的视频是 ${clock(apiDuration)}，页面上正在播放的是 ${clock(pageDuration)}——不是同一个视频。这通常发生在站内刚切换过视频、地址和页面还没对齐的时候。`
    };
  }

  if (!bothDurations) {
    // 时长不足以下判断时退回标题兜底，但仍然要求两边都有标题
    const apiTitle = api.title;
    const pageTitle = page.title;
    if (apiTitle && pageTitle && normalizeTitle(apiTitle).length > 0 && normalizeTitle(pageTitle).length > 0) {
      if (!isSameTitle(apiTitle, pageTitle)) {
        return {
          kind: 'mismatch',
          basis: 'title',
          message: `面板拿到的视频标题是「${apiTitle}」，页面上是「${pageTitle}」——不是同一个视频。`
        };
      }
      return { kind: 'ok', basis: null, message: null };
    }
    return { kind: 'unknown', basis: null, message: null };
  }

  return { kind: 'ok', basis: null, message: null };
}
