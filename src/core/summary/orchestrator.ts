import type { AiProvider, ChatMessage } from '@/core/ai/types';
import { AppError } from '@/core/errors/app-error';
import type { ExtensionSettings } from '@/core/settings/types';
import type { SubtitleCue } from '@/core/subtitle/types';
import { estimateTokens, planChunks } from './chunk-planner';
import { buildCoverageHint, measureChapterCoverage, type ChapterCoverage } from './coverage';
import { parseMergeOutput, type ParsedMergeOutput } from './parse';
import { buildChunkMessages, buildDirectMessages, buildMergeMessages } from './prompts';
import {
  SUMMARY_LIMITS,
  type ChunkSummary,
  type SummaryResult,
  type SummarySource,
  type SummaryTaskStatus
} from './types';

export interface SummaryProgress {
  status?: SummaryTaskStatus;
  doneChunks?: number;
  totalChunks?: number;
  message?: string;
}

export interface SummaryRunOptions {
  settings: ExtensionSettings;
  provider: AiProvider;
  videoTitle: string | null;
  /** 素材所属视频键，随结果落盘，用于核对总结与视频是否对应 */
  videoKey: string;
  cues: SubtitleCue[];
  /** 素材来源，决定使用哪套提示词以及结果上的来源标签 */
  source: SummarySource;
  /**
   * 上次失败时留存的分块摘要。仅当块的时间范围与当前分块计划完全一致才会复用，
   * 因此参数或字幕变化不会用到过期结论。
   */
  cachedChunks?: ChunkSummary[];
  /** 每块摘要完成后立即回调，用于落盘实现断点续跑。 */
  onChunkDone?: (chunk: ChunkSummary) => void;
  /** 用户取消检查。每次发起请求前都会调用，已取消则抛 E_TASK_CANCELLED。 */
  isCancelled: () => boolean;
  onProgress?: (progress: SummaryProgress) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 把文本按 token 预算截断，用于归并输入超限时保护上下文长度。 */
export function truncateToTokens(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (estimateTokens(text) <= budget) return text;
  let ascii = 0;
  let wide = 0;
  let result = '';
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii += 1;
    else wide += 1;
    if (Math.ceil(ascii / 4) + wide > budget) break;
    result += char;
  }
  return `${result}…`;
}

/**
 * 执行一次完整的视频总结。
 *
 * 流程：分块 → 各块摘要（并发 + 重试）→ 归并成概述与章节。
 * 任一块在重试耗尽后失败，整个任务失败并抛出该错误，不返回不完整的结果。
 */
export async function runSummary(options: SummaryRunOptions): Promise<SummaryResult> {
  const startedAt = Date.now();
  const { settings, provider, cues, source, videoKey, videoTitle } = options;
  if (cues.length === 0) {
    throw new AppError('E_SUBTITLE_UNAVAILABLE', { message: '没有可用于总结的字幕内容' });
  }

  const plan = planChunks(cues, {
    targetTokens: settings.chunk.targetTokens,
    maxTokens: settings.chunk.maxTokens,
    overlapSeconds: settings.chunk.overlapSeconds
  });
  if (plan.chunks.length === 0) {
    throw new AppError('E_SUBTITLE_UNAVAILABLE', { message: '字幕内容过短，无法分块' });
  }

  const total = plan.chunks.length;
  /**
   * 只有一个分块时跳过「先摘要再归并」。
   *
   * 两步走会把整段内容压成两百字，章节时间点只能从这两百字里挑，
   * 20 分钟以上的视频后半段会整段失去导航（实测：24 分钟视频的章节最晚只到 07:30）。
   * 素材本来就能一次装进上下文，直出即可，还省掉一次模型调用。
   */
  const singleChunk = total === 1;

  const summaries: ChunkSummary[] = new Array<ChunkSummary>(total);
  let done = 0;
  let firstError: unknown = null;
  let cursor = 0;

  if (!singleChunk) {
    // 复用上次已完成的块：以「下标 + 时间范围」为准，避免错位拼接
    const reuseKey = (index: number, startMs: number, endMs: number): string =>
      `${index}@${startMs}-${endMs}`;
    const reusable = new Map<string, ChunkSummary>();
    for (const item of options.cachedChunks ?? []) {
      if (!item) continue;
      reusable.set(reuseKey(item.index, item.startMs, item.endMs), item);
    }
    for (let index = 0; index < total; index += 1) {
      const chunk = plan.chunks[index];
      if (!chunk) continue;
      const hit = reusable.get(reuseKey(index, chunk.startMs, chunk.endMs));
      if (hit) {
        summaries[index] = hit;
        done += 1;
      }
    }
    const reused = done;
    options.onProgress?.({
      status: 'running',
      doneChunks: done,
      totalChunks: total,
      message: reused > 0 ? `复用已完成的 ${reused}/${total} 段` : '正在生成分段摘要'
    });

    const runOne = async (index: number): Promise<void> => {
      const chunk = plan.chunks[index];
      if (!chunk) return;
      if (summaries[index]) return;
      if (options.isCancelled()) throw new AppError('E_TASK_CANCELLED');

      const attempts = Math.max(1, settings.chunk.maxRetries + 1);
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (options.isCancelled()) throw new AppError('E_TASK_CANCELLED');
        try {
          const result = await provider.complete({
            messages: buildChunkMessages(chunk, { videoTitle: options.videoTitle, source }),
            temperature: settings.model.temperature,
            maxTokens: Math.min(settings.model.maxOutputTokens, 1200)
          });
          const summary: ChunkSummary = {
            index,
            startMs: chunk.startMs,
            endMs: chunk.endMs,
            summary: result.content.trim()
          };
          summaries[index] = summary;
          done += 1;
          options.onChunkDone?.(summary);
          options.onProgress?.({
            doneChunks: done,
            totalChunks: total,
            message: `已完成 ${done}/${total} 段`
          });
          return;
        } catch (error) {
          lastError = error;
          const appError = AppError.from(error);
          if (appError.code === 'E_TASK_CANCELLED') throw error;
          const canRetry = appError.retryable && attempt < attempts;
          if (!canRetry) throw error;
          await sleep(400 * attempt);
        }
      }
      throw lastError ?? new AppError('E_INTERNAL');
    };

    const workerCount = Math.min(Math.max(1, settings.chunk.concurrency), total);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        if (firstError) return;
        const index = cursor;
        cursor += 1;
        if (index >= total) return;
        try {
          await runOne(index);
        } catch (error) {
          if (!firstError) firstError = error;
          return;
        }
      }
    });

    await Promise.all(workers);
    if (firstError) throw firstError;
    if (options.isCancelled()) throw new AppError('E_TASK_CANCELLED');
  }

  options.onProgress?.({
    status: 'merging',
    message: singleChunk ? '正在生成结构化总结' : '正在合并为整体结构与章节'
  });

  /** 素材终点：最后一条字幕的结束时间。章节是否铺到结尾以它为准，比视频时长更可靠（字幕可能不全）。 */
  const materialEndMs = cues.reduce((max, cue) => Math.max(max, cue.endMs), 0);
  /** 素材起点与首句原文，与 videoKey 一起构成可核对的素材指纹。 */
  const materialStartMs = cues.reduce((min, cue) => Math.min(min, cue.startMs), Number.POSITIVE_INFINITY);
  const firstCueText = (cues[0]?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

  const ordered = summaries.filter((item): item is ChunkSummary => Boolean(item));
  const rawSummaries = ordered.map((item) => ({
    startMs: item.startMs,
    endMs: item.endMs,
    summary: item.summary
  }));

  // 归并输入超限时按段落均分预算截断，保证每段都保留部分信息
  const totalTokens = rawSummaries.reduce((sum, item) => sum + estimateTokens(item.summary), 0);
  const limited =
    totalTokens <= SUMMARY_LIMITS.mergeInputTokens
      ? rawSummaries
      : (() => {
          const budget = Math.max(
            80,
            Math.floor(SUMMARY_LIMITS.mergeInputTokens / Math.max(1, rawSummaries.length))
          );
          return rawSummaries.map((item) => ({
            ...item,
            summary: truncateToTokens(item.summary, budget)
          }));
        })();

  interface MergeOutcome {
    parsed: ParsedMergeOutput;
    model: string | null;
    coverage: ChapterCoverage;
  }

  /**
   * 归并 + 覆盖度保护。
   *
   * 模型经常只总结前段（真实案例：24 分钟视频的章节最晚到 07:30）。这里先量一次覆盖率，
   * 明显不足时带上「上次到哪、素材到哪」再要一次；补全失败则保留第一份结果，
   * 不会因为「想更好」而把已经拿到的总结丢掉。
   */
  const runMerge = async (
    build: (retryHint: string | null) => ChatMessage[]
  ): Promise<MergeOutcome> => {
    const request = (retryHint: string | null) => ({
      messages: build(retryHint),
      temperature: Math.min(settings.model.temperature, 0.3),
      maxTokens: settings.model.maxOutputTokens,
      json: true
    });

    const first = await provider.complete(request(null));
    const firstParsed = parseMergeOutput(first.content);
    const firstCoverage = measureChapterCoverage(firstParsed.chapters, materialEndMs);
    if (!firstCoverage.insufficient) {
      return { parsed: firstParsed, model: first.model, coverage: firstCoverage };
    }

    if (options.isCancelled()) throw new AppError('E_TASK_CANCELLED');
    options.onProgress?.({
      message: `章节只覆盖到 ${Math.floor(firstCoverage.lastStartMs / 1000)} 秒处，正在补全后半段`
    });

    try {
      const second = await provider.complete(request(buildCoverageHint(firstCoverage)));
      const secondParsed = parseMergeOutput(second.content);
      const secondCoverage = measureChapterCoverage(secondParsed.chapters, materialEndMs);
      const improved =
        secondCoverage.ratio > firstCoverage.ratio ||
        (secondCoverage.ratio === firstCoverage.ratio &&
          secondParsed.chapters.length > firstParsed.chapters.length);
      return improved
        ? { parsed: secondParsed, model: second.model, coverage: secondCoverage }
        : { parsed: firstParsed, model: first.model, coverage: firstCoverage };
    } catch {
      // 补全这一步失败不影响已有结果，界面会通过 materialEndMs 如实提示覆盖范围
      return { parsed: firstParsed, model: first.model, coverage: firstCoverage };
    }
  };

  // 只有一个分块时直接拿原始字幕出结构化结果：先压成 200 字再归并会把后半段的时间点整段丢掉
  const outcome =
    singleChunk
      ? await runMerge((retryHint) =>
          buildDirectMessages(cues, {
            videoTitle: options.videoTitle,
            source,
            materialEndMs,
            retryHint
          })
        )
      : await runMerge((retryHint) =>
          buildMergeMessages(limited, {
            videoTitle: options.videoTitle,
            source,
            materialEndMs,
            retryHint
          })
        );

  return {
    overview: outcome.parsed.overview,
    highlights: outcome.parsed.highlights,
    chapters: outcome.parsed.chapters,
    source,
    generatedAt: Date.now(),
    model: outcome.model,
    chunkCount: total,
    cueCount: cues.length,
    materialEndMs,
    material: {
      videoKey,
      videoTitle,
      cueCount: cues.length,
      startMs: Number.isFinite(materialStartMs) ? materialStartMs : 0,
      endMs: materialEndMs,
      firstText: firstCueText
    },
    elapsedMs: Date.now() - startedAt
  };
}
