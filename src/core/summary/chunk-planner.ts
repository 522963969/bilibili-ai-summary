import type { SubtitleCue } from '@/core/subtitle/types';
import { formatCueClock } from '@/core/subtitle/timestamp';
import { SUMMARY_LIMITS, type ChunkPlan, type TranscriptChunk } from './types';

/**
 * 分块规划。
 *
 * 参数来自设置：目标 6000 tokens、上限 8000 tokens、重叠 20~40 秒。
 * 不引入 tokenizer 依赖，用「ASCII 按 4 字符 / 非 ASCII 按 1 字符」估算，
 * 对中文内容偏保守，宁可多切一块也不让单次请求超限。
 */

/** 估算一段文本的 token 数（中文按字计，英文按 4 字符计）。 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / 4) + wide;
}

/** 时间戳标记本身也会占用 token，按固定开销计入。 */
const CUE_OVERHEAD_TOKENS = 6;

function cueTokens(cue: SubtitleCue): number {
  return estimateTokens(cue.text) + CUE_OVERHEAD_TOKENS;
}

/** 把一组 cue 渲染成带 `[mm:ss]` 前缀的正文，供模型定位时间。 */
export function renderCues(cues: SubtitleCue[]): string {
  return cues.map((cue) => `[${formatCueClock(cue.startMs)}] ${cue.text}`).join('\n');
}

export interface PlanOptions {
  targetTokens: number;
  maxTokens: number;
  overlapSeconds: number;
}

/**
 * 分块指纹：cue 序列 + 分块参数的组合。
 *
 * 分块结果缓存用它做失效判断——同一视频重新导入字幕后 cue 数量或起止时间
 * 会变化，指纹随之改变，缓存摘要不会被错误复用。
 */
export function buildCueSignature(cues: SubtitleCue[], options: PlanOptions): string {
  if (cues.length === 0) return 'empty';
  const first = cues[0];
  const last = cues[cues.length - 1];
  return [
    `n${cues.length}`,
    `s${first?.startMs ?? 0}`,
    `e${last?.endMs ?? 0}`,
    `t${options.targetTokens}`,
    `m${options.maxTokens}`,
    `o${options.overlapSeconds}`
  ].join('|');
}

export function planChunks(cues: SubtitleCue[], options: PlanOptions): ChunkPlan {
  const target = Math.max(200, Math.floor(options.targetTokens));
  const max = Math.max(target, Math.floor(options.maxTokens));
  const overlapMs = Math.max(0, options.overlapSeconds) * 1000;
  const chunks: TranscriptChunk[] = [];
  let overlappedCues = 0;
  let cursor = 0;

  while (cursor < cues.length && chunks.length < SUMMARY_LIMITS.maxChunks) {
    const startIndex = cursor;
    let tokens = 0;
    let end = cursor;

    while (end < cues.length) {
      const current = cues[end];
      if (!current) break;
      const cost = cueTokens(current);
      // 至少保留一条，避免单条超长时切出空块
      if (end > startIndex && tokens + cost > max) break;
      tokens += cost;
      end += 1;
      if (tokens >= target) break;
    }
    if (end === startIndex) end = startIndex + 1;

    const first = cues[startIndex];
    const last = cues[end - 1];
    if (!first || !last) break;

    chunks.push({
      index: chunks.length,
      startMs: first.startMs,
      endMs: last.endMs,
      text: renderCues(cues.slice(startIndex, end)),
      estimatedTokens: tokens,
      cueCount: end - startIndex
    });

    if (end >= cues.length) break;

    // 下一块起点：从本块结束向前回退 overlapSeconds，但必须严格前进
    let next = end;
    if (overlapMs > 0) {
      const overlapFrom = last.endMs - overlapMs;
      let candidate = end;
      while (
        candidate > startIndex + SUMMARY_LIMITS.minCuesPerChunk &&
        (cues[candidate - 1]?.startMs ?? 0) >= overlapFrom
      ) {
        candidate -= 1;
      }
      if (candidate > startIndex && candidate < end) {
        next = candidate;
        overlappedCues += end - candidate;
      }
    }
    if (next <= startIndex) next = end;
    cursor = next;
  }

  return {
    chunks,
    estimatedTotalTokens: chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0),
    overlappedCues
  };
}
