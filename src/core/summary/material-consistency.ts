/**
 * 总结结果与「当前素材」的一致性校验。
 *
 * 为什么必须要有：结果里的概述、要点、章节都是模型输出的自由文本，本身不带任何身份信息。
 * 一旦上游给错了素材（导入了别的视频的字幕、面板换片后还留着旧字幕、缓存键配错），
 * 界面上的总结看起来完全正常——文字通顺、结构完整——用户只能靠记忆发现
 * 「这讲的根本不是这个视频」。这是最难自查的一类错误。
 *
 * 这里把能机械核对的三件事做成纯函数，任一不成立就在结果区直接告警：
 *   1. 结果记录的视频键 == 当前视频键
 *   2. 结果声称依据的首句字幕，确实出现在当前字幕里
 *   3. 字幕总长与视频时长不冲突
 *
 * 全部用「证据」说话，不做猜测：只报能复算的事实（条数、时长、原文），
 * 让用户自己一眼判断，而不是替用户下结论。
 */

import type { SummaryMaterial, SummarySource } from './types';
import type { SubtitleSource } from '../subtitle/types';

export type MaterialIssueKind =
  /** 结果记录的视频键与当前视频不一致 */
  | 'key-mismatch'
  /** 结果声称依据的首句字幕，在当前字幕里找不到 */
  | 'text-not-found'
  /** 字幕条数与生成时差异过大 */
  | 'cue-count-drift'
  /** 字幕总长超过视频时长 */
  | 'duration-overflow'
  /** 字幕只覆盖视频前段 */
  | 'duration-partial'
  /** 素材来自本地导入文件 */
  | 'imported-source';

export type MaterialIssueLevel = 'error' | 'warn' | 'info';

/** 告警附带的可执行动作，界面据此渲染按钮。 */
export type MaterialIssueAction = 'refetch-subtitle';

export interface MaterialIssue {
  kind: MaterialIssueKind;
  level: MaterialIssueLevel;
  /** 一行结论，直接展示，必须包含可核对的数字或原文 */
  message: string;
  /** 可执行动作；没有则为 null */
  action: MaterialIssueAction | null;
}

/** 当前面板持有的素材，字段只取校验需要的部分，便于测试构造。 */
export interface CurrentMaterial {
  source: SubtitleSource;
  cueCount: number;
  totalDurationMs: number;
  /** 导入时的原始文件名 */
  importedFileName?: string;
  /** 按顺序排列的字幕文本，用于核对结果声称的首句 */
  texts: readonly string[];
}

export interface MaterialCheckInput {
  /** 结果里落盘的素材指纹；旧快照没有该字段 */
  material: SummaryMaterial | null | undefined;
  /** 当前视频键 */
  currentVideoKey: string | null;
  /** 结果来源：画面识别不做字幕正文与时长比对 */
  source: SummarySource;
  /** 当前面板里的字幕；未加载时为 null，此时只能核对视频键 */
  current: CurrentMaterial | null;
  /** 页面 video 元素的时长（秒），未知为 null */
  videoDurationSeconds: number | null;
}

export const MATERIAL_CHECK_LIMITS = {
  /** 视频短于该秒数时不做时长校验：几分钟的视频字幕不全很常见 */
  minVideoSeconds: 120,
  /**
   * 「字幕只覆盖前段」的判定门槛更高。
   * 纯音乐/MV 类视频可能整片只有几十秒对白，用 2 分钟门槛会频繁误报；
   * 5 分钟以上还只覆盖不到三成才值得提醒。
   */
  minVideoSecondsForPartial: 300,
  /** 字幕总长超过视频时长的该倍数，判定为不是同一个视频 */
  overflowRatio: 1.15,
  /** 字幕总长低于视频时长的该比例，判定为只覆盖了前段 */
  partialRatio: 0.3,
  /** 字幕条数相对偏差超过该比例才提示，避免重取字幕时轻微变化就报警 */
  cueCountTolerance: 0.15,
  /** 首句比对时需要忽略的标点，避免导入文件的标点习惯造成误判 */
  ignoredPunctuation: /[\s，。、？！…—～：；·「」『』“”‘’（）《》〈〉,.\-?!:;"'\[\]()<>]/g
} as const;

/** 去掉空白与标点，用于首句比对：两种来源的标点习惯不同，逐字符比对会误判。 */
export function normalizeForCompare(text: string): string {
  return text.replace(MATERIAL_CHECK_LIMITS.ignoredPunctuation, '').toLowerCase();
}

/**
 * 结果声称依据的首句，是否确实出现在当前字幕里。
 *
 * `firstText` 是生成时第一条字幕截断到 40 字的结果，因此当前字幕里应当有某一条
 * 以它开头（或包含它）。用「包含」而不是「相等」，是为了容忍截断点落在句中的情况。
 */
function findFirstText(firstText: string, texts: readonly string[]): boolean {
  const needle = normalizeForCompare(firstText);
  if (needle.length === 0) return true;
  for (const text of texts) {
    if (normalizeForCompare(text).includes(needle)) return true;
  }
  return false;
}

function clock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * 逐项核对，返回需要展示的告警。
 *
 * 顺序即严重度：错误在前，提示在后，界面按返回顺序渲染即可。
 */
export function checkMaterialConsistency(input: MaterialCheckInput): MaterialIssue[] {
  const { material, currentVideoKey, source, current, videoDurationSeconds } = input;
  const issues: MaterialIssue[] = [];

  if (material && currentVideoKey && material.videoKey !== currentVideoKey) {
    issues.push({
      kind: 'key-mismatch',
      level: 'error',
      message: `这份总结记录的视频是 ${material.videoKey}，当前视频是 ${currentVideoKey}`,
      action: null
    });
  }

  // 画面识别的素材是「画面描述」而不是字幕，比对字幕正文与时长没有意义
  if (source === 'frames') return issues;

  if (current?.source === 'import') {
    const name = current.importedFileName ? `「${current.importedFileName}」` : '';
    issues.push({
      kind: 'imported-source',
      level: 'info',
      message: `素材来自本地导入文件${name}，不是 B 站字幕——请确认它确实是这个视频的字幕`,
      action: 'refetch-subtitle'
    });
  }

  if (!material || !current) return issues;

  const textNotFound =
    Boolean(material.firstText) &&
    current.texts.length > 0 &&
    !findFirstText(material.firstText, current.texts);

  if (textNotFound) {
    const head = material.firstText.length > 20 ? `${material.firstText.slice(0, 20)}…` : material.firstText;
    issues.push({
      kind: 'text-not-found',
      level: 'error',
      message: `这份总结依据的首句「${head}」在当前字幕里找不到，素材很可能已经换成别的视频的字幕`,
      action: 'refetch-subtitle'
    });
  }

  const drift = measureCueCountDrift(material.cueCount, current.cueCount);
  if (drift !== null) {
    issues.push({
      kind: 'cue-count-drift',
      level: 'warn',
      message: `总结依据 ${material.cueCount} 条字幕，当前是 ${current.cueCount} 条（差 ${percent(drift)}）`,
      action: null
    });
  }

  // 已经证明素材对不上时，再叠加时长类告警只是噪音：结论一样，还多了两行红字
  if (textNotFound) return issues;

  const videoSeconds = videoDurationSeconds ?? null;
  if (videoSeconds === null || current.totalDurationMs <= 0) return issues;

  const subtitleSeconds = current.totalDurationMs / 1000;
  const ratio = subtitleSeconds / videoSeconds;

  if (videoSeconds >= MATERIAL_CHECK_LIMITS.minVideoSeconds && ratio > MATERIAL_CHECK_LIMITS.overflowRatio) {
    issues.push({
      kind: 'duration-overflow',
      level: 'error',
      message: `字幕总长 ${clock(current.totalDurationMs)} 超过视频时长 ${clock(videoSeconds * 1000)}，这份字幕不可能是当前视频的`,
      action: 'refetch-subtitle'
    });
    return issues;
  }

  if (videoSeconds >= MATERIAL_CHECK_LIMITS.minVideoSecondsForPartial && ratio < MATERIAL_CHECK_LIMITS.partialRatio) {
    issues.push({
      kind: 'duration-partial',
      level: 'warn',
      message: `字幕到 ${clock(current.totalDurationMs)} 结束，视频时长 ${clock(videoSeconds * 1000)}（${percent(ratio)}），总结只覆盖前段`,
      action: null
    });
  }

  return issues;
}

/** 条数相对偏差，未超过容忍比例时返回 null。 */
function measureCueCountDrift(expected: number, actual: number): number | null {
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) return null;
  if (expected <= 0 || actual <= 0) return null;
  const drift = Math.abs(actual - expected) / expected;
  return drift > MATERIAL_CHECK_LIMITS.cueCountTolerance ? Math.min(1, drift) : null;
}
