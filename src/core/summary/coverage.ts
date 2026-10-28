/**
 * 章节覆盖度判定。
 *
 * 为什么需要它：模型生成的章节可能只覆盖素材前段。真实案例是一个 24 分 34 秒的视频
 * 只输出了 4 个章节、最晚到 07:30——用户点章节只能跳到前三分之一，后半段等于没有导航。
 * 这里用纯函数量出「章节最晚到哪」，由编排层决定是否补全一次。
 */

import type { SummaryChapter } from './types';

export const COVERAGE_LIMITS = {
  /** 最后一章起点占素材终点的比例低于该值，视为没有覆盖到结尾 */
  minRatio: 0.6,
  /** 素材短于该时长时不做覆盖度校验：几分钟的视频章节少是正常的 */
  minMaterialMs: 5 * 60 * 1000
} as const;

export interface ChapterCoverage {
  /** 最后一章的起点（毫秒）；没有章节时为 0 */
  lastStartMs: number;
  /** 素材终点（最后一条字幕的结束时间） */
  materialEndMs: number;
  /** lastStartMs / materialEndMs，0~1 */
  ratio: number;
  /** 是否明显没有覆盖到结尾 */
  insufficient: boolean;
}

export function measureChapterCoverage(
  chapters: readonly SummaryChapter[],
  materialEndMs: number
): ChapterCoverage {
  const lastStartMs = chapters.reduce((max, chapter) => Math.max(max, chapter.startMs), 0);
  const safeEnd = Number.isFinite(materialEndMs) && materialEndMs > 0 ? materialEndMs : 0;
  const ratio = safeEnd > 0 ? Math.min(1, lastStartMs / safeEnd) : 0;

  const insufficient =
    safeEnd >= COVERAGE_LIMITS.minMaterialMs && ratio < COVERAGE_LIMITS.minRatio;

  return { lastStartMs, materialEndMs: safeEnd, ratio, insufficient };
}

/**
 * 生成补全指令。
 *
 * 明确给出「上次到哪、素材到哪」，让重试有具体目标；
 * 只说「请覆盖完整」模型往往会原样再输出一遍。
 */
export function buildCoverageHint(coverage: ChapterCoverage): string {
  return [
    `上一次输出只覆盖到 ${clock(coverage.lastStartMs)}，而这段素材一直到 ${clock(coverage.materialEndMs)}。`,
    `请补全 ${clock(coverage.lastStartMs)} 之后的内容，并让最后一个章节落在素材结尾附近。`,
    '不要重复上一次已覆盖的章节，直接输出完整的章节列表。'
  ].join('');
}

function clock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
