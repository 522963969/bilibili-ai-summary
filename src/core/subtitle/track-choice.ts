/**
 * 字幕轨道选择与覆盖率判定。
 *
 * 为什么需要它：`player/v2` 对一个视频可能返回多条字幕轨道（自动生成、机翻、UP 主上传…），
 * 而面板此前直接取「第一条非锁定且有地址」的那条，没有任何选择入口。
 * 一旦第一条是占位/推广字幕（实测见过只有 1 条、时长 10 秒的轨道），用户拿到的就是
 * 「24 分钟视频只有 1 条字幕」，而且界面上看不出还有别的轨道可以换。
 *
 * 这里把两件事拆成纯函数：怎么挑一条看起来可用的、以及怎么判断它明显不够用。
 */

import type { SubtitleStats, SubtitleTrack } from './types';

export const TRACK_COVERAGE = {
  /** 视频短于该秒数时不做覆盖率判定：几分钟的视频字幕稀疏是正常的 */
  minVideoSeconds: 120,
  /** 字幕总长低于视频时长的该比例，判定为「明显没覆盖到」 */
  minRatio: 0.3,
  /**
   * 字幕总长高于视频时长的该比例，判定为「这条字幕不是这个视频的」。
   *
   * 真实反馈：3:04 的视频拿到了 6:32 的字幕，内容完全是另一个视频（讲沃尔玛和山姆的）。
   * 字幕比视频还长，只可能是别处的素材——留着它做总结，出来的结论必然跑题。
   * 允许 15% 余量，是因为片尾字幕、最后一句话拖过画面结束很常见。
   */
  maxRatio: 1.15,
  /** 条数不超过该值的字幕，无论时长如何都不足以支撑总结 */
  minUsefulCues: 3,
  /** 自动切换轨道时最多尝试几条，避免在多轨道视频上反复拉取 */
  maxAutoAttempts: 3
} as const;

/** 轨道是否真的能取到内容。 */
export function isFetchableTrack(track: SubtitleTrack): boolean {
  return !track.locked && track.url !== null && track.url.trim().length > 0;
}

/** 可获取的轨道，保持接口返回的原始顺序。 */
export function listFetchableTracks(tracks: readonly SubtitleTrack[]): SubtitleTrack[] {
  return tracks.filter(isFetchableTrack);
}

/**
 * 默认选哪条：优先中文自动生成，其次任意中文，最后退回第一条可用轨道。
 *
 * 不按「条数最多」之类的指标猜——轨道元信息里没有这些字段，硬猜只会让默认行为不可解释。
 */
export function pickDefaultTrack(tracks: readonly SubtitleTrack[]): SubtitleTrack | null {
  const usable = listFetchableTracks(tracks);
  if (usable.length === 0) return null;

  const aiChinese = usable.find(
    (track) => track.isAiGenerated && (track.lang.startsWith('ai-zh') || track.lang.startsWith('zh'))
  );
  if (aiChinese) return aiChinese;

  const chinese = usable.find((track) => track.lang.startsWith('zh') || track.lang.startsWith('ai-zh'));
  return chinese ?? usable[0] ?? null;
}

export interface SubtitleCoverage {
  /** 字幕总长 / 视频时长，视频时长未知时为 null */
  ratio: number | null;
  /** 是否明显不够用（覆盖不到前段） */
  insufficient: boolean;
  /** 是否明显超出视频时长（多半是别的视频的字幕） */
  overflows: boolean;
  /** 判定原因，用于生成可读提示 */
  reason: 'few-cues' | 'short-coverage' | 'too-long' | 'ok' | 'unknown';
}

/**
 * 这条字幕能不能拿来用。
 *
 * 与 `insufficient` 分开写，是因为两者语义不同：不够用是「缺内容」，
 * 超出时长是「内容不属于这个视频」。前者还能勉强总结，后者必须直接拒绝。
 */
export function isUsableCoverage(coverage: SubtitleCoverage): boolean {
  return !coverage.insufficient && !coverage.overflows;
}

/**
 * 这条字幕能不能支撑一次总结。
 *
 * 判据只有两条，都来自可以复算的数字：条数、字幕总长与视频时长的比例。
 * 不做「内容质量」判断——那不在这层能做主的范围里。
 */
export function measureSubtitleCoverage(
  stats: Pick<SubtitleStats, 'cueCount' | 'totalDurationMs'>,
  videoDurationSeconds: number | null
): SubtitleCoverage {
  if (stats.cueCount < TRACK_COVERAGE.minUsefulCues) {
    return { ratio: null, insufficient: true, overflows: false, reason: 'few-cues' };
  }

  const videoSeconds = videoDurationSeconds ?? null;
  if (videoSeconds === null || videoSeconds < TRACK_COVERAGE.minVideoSeconds) {
    return { ratio: null, insufficient: false, overflows: false, reason: 'unknown' };
  }

  const subtitleSeconds = Math.max(0, stats.totalDurationMs) / 1000;
  const ratio = subtitleSeconds / videoSeconds;
  const overflows = ratio > TRACK_COVERAGE.maxRatio;
  const insufficient = ratio < TRACK_COVERAGE.minRatio;
  const reason = overflows ? 'too-long' : insufficient ? 'short-coverage' : 'ok';
  return { ratio, insufficient, overflows, reason };
}

function clock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * 覆盖率提示文案。
 *
 * 只陈述两个数字（字幕到哪、视频多长），不猜原因——是不是轨道选错、视频本身没字幕、
 * 还是 UP 主传了占位字幕，用户看界面上的轨道名比看我们猜测更有用。
 * 只有一种例外：字幕比视频还长时，可以确定「这不是这个视频的字幕」，就直说。
 */
export function buildCoverageHint(
  coverage: SubtitleCoverage,
  stats: Pick<SubtitleStats, 'cueCount' | 'totalDurationMs'>,
  videoDurationSeconds: number | null
): string | null {
  if (coverage.reason === 'too-long') {
    const videoMs = (videoDurationSeconds ?? 0) * 1000;
    return `这条字幕到 ${clock(stats.totalDurationMs)} 才结束，而视频只有 ${clock(videoMs)}：长出来的部分不可能是这个视频的内容。换一条轨道，或先点「重新识别当前视频」确认面板认的是不是正在播放的这个视频。`;
  }

  if (!coverage.insufficient) return null;

  if (coverage.reason === 'few-cues') {
    const tail =
      videoDurationSeconds && videoDurationSeconds > 0
        ? `，而这个视频有 ${clock(videoDurationSeconds * 1000)}`
        : '';
    return `这条字幕只有 ${stats.cueCount} 条${tail}。如果视频本身有别的字幕轨道，换一条再试；也可能是 UP 主上传了占位字幕。`;
  }

  const videoMs = (videoDurationSeconds ?? 0) * 1000;
  return `这条字幕到 ${clock(stats.totalDurationMs)} 就结束了，视频时长 ${clock(videoMs)}，只覆盖前段。换一条轨道，或导入完整字幕。`;
}
