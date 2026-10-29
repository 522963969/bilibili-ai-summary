/**
 * 字幕领域模型。
 *
 * 统一表示不同来源（B 站字幕接口 / 用户导入）的字幕，供后续分块与总结消费。
 * 时间统一为毫秒整数，文本为纯文本（已清理 HTML/ASS 标记）。
 */

export type SubtitleSource = 'bilibili' | 'import';
export type SubtitleFormat = 'bilibili-json' | 'srt' | 'vtt' | 'json';

export interface SubtitleCue {
  /** 从 1 开始，按起始时间排序后的序号 */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface SubtitleTrack {
  id: string;
  /** 语言代码，例如 zh-CN、ai-zh */
  lang: string;
  /** 界面展示名，例如「中文（自动生成）」 */
  label: string;
  /** 字幕文件地址，导入轨道为 null */
  url: string | null;
  isAiGenerated: boolean;
  /** 平台标记为需要解锁的字幕 */
  locked: boolean;
}

/** 字幕发现结果状态，用于界面给出可执行的原因说明。 */
export type SubtitleAvailability = 'ok' | 'empty' | 'login-required' | 'all-locked';

export interface SubtitleDiscovery {
  availability: SubtitleAvailability;
  tracks: SubtitleTrack[];
  /** 面向用户的中文说明 */
  message: string;
  /**
   * 是否因为当前浏览器会话「未登录」才拿不到字幕。
   * 仅在 `availability === 'login-required'` 时为 true；
   * 视频本身没有字幕（`empty`）时即便未登录也为 false，避免误导用户去登录。
   */
  loginRequired: boolean;
  cid: number | null;
  videoTitle: string | null;
  /**
   * 接口侧（`/x/web-interface/view`）返回的视频时长，秒。
   *
   * 面板有一份「页面 DOM 里的视频时长」，这里再带一份「接口认为的时长」，
   * 是为了在取字幕之前就能对账：两边差太多就说明地址与正在播放的视频脱钩了，
   * 此时取回来的字幕必然是别人的。
   */
  videoDurationSeconds: number | null;
  fetchedAt: number;
}

export interface SubtitleStats {
  cueCount: number;
  totalDurationMs: number;
  /** 结束时间早于起始时间、被修正的条数 */
  repairedCues: number;
  /** 文本为空、被丢弃的条数 */
  droppedCues: number;
}

export interface NormalizedSubtitle {
  videoKey: string;
  trackId: string;
  lang: string;
  label: string;
  source: SubtitleSource;
  format: SubtitleFormat;
  cues: SubtitleCue[];
  stats: SubtitleStats;
  /** 导入时的原始文件名 */
  importedFileName?: string;
  createdAt: number;
}

/** 解析器的中间产物，不含 index。 */
export interface RawCue {
  startMs: number;
  endMs: number;
  text: string;
}

/** 字幕规模上限，避免异常文件拖垮存储与后续分块。 */
export const SUBTITLE_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxCues: 20000,
  maxCueChars: 2000
} as const;
