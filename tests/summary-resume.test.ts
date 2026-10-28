import { describe, expect, it } from 'vitest';
import type { AiProvider, CompletionRequest, CompletionResult } from '@/core/ai/types';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { buildCueSignature, planChunks } from '@/core/summary/chunk-planner';
import { runSummary } from '@/core/summary/orchestrator';
import type { ChunkSummary } from '@/core/summary/types';
import type { ExtensionSettings } from '@/core/settings/types';
import type { SubtitleCue } from '@/core/subtitle/types';

/**
 * 断点续跑回归测试。
 * 目标：已完成的块不再请求模型，缺失的块补齐，时间范围对不上的缓存一律作废。
 */

function makeCues(count: number, stepMs = 3000, text = '这是一句用于测试分块的字幕内容'): SubtitleCue[] {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    startMs: index * stepMs,
    endMs: index * stepMs + stepMs - 500,
    text
  }));
}

const CHUNK_OPTIONS = { targetTokens: 600, maxTokens: 800, overlapSeconds: 10 };

function makeSettings(): ExtensionSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    model: { ...DEFAULT_SETTINGS.model, apiKey: 'sk-test' },
    chunk: {
      targetTokens: CHUNK_OPTIONS.targetTokens,
      maxTokens: CHUNK_OPTIONS.maxTokens,
      overlapSeconds: CHUNK_OPTIONS.overlapSeconds,
      concurrency: 2,
      maxRetries: 0
    }
  };
}

const MERGE_JSON = JSON.stringify({
  overview: '这是一段整体概述',
  highlights: ['要点一'],
  chapters: [{ title: '开场', start: '00:00', points: ['介绍'] }]
});

class FakeProvider implements AiProvider {
  chunkCalls = 0;
  mergeCalls = 0;
  constructor(private readonly failChunkAt: number | null = null) {}

  async testConnection(): Promise<never> {
    throw new Error('不应在总结流程中调用');
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (request.json) {
      this.mergeCalls += 1;
      return { content: MERGE_JSON, usage: null, model: 'fake', latencyMs: 1 };
    }
    this.chunkCalls += 1;
    if (this.failChunkAt !== null && this.chunkCalls === this.failChunkAt) {
      throw new Error('模拟分块失败');
    }
    return { content: `分段摘要 ${this.chunkCalls}`, usage: null, model: 'fake', latencyMs: 1 };
  }
}

function plannedChunks(cues: SubtitleCue[]) {
  return planChunks(cues, CHUNK_OPTIONS).chunks;
}

describe('buildCueSignature', () => {
  it('字幕或分块参数变化时指纹不同', () => {
    const cues = makeCues(10);
    const base = buildCueSignature(cues, CHUNK_OPTIONS);

    expect(buildCueSignature(cues, CHUNK_OPTIONS)).toBe(base);
    // 同一批 cue、不同参数 → 必须失效
    expect(buildCueSignature(cues, { ...CHUNK_OPTIONS, targetTokens: 900 })).not.toBe(base);
    // 字幕后延 → 必须失效
    expect(buildCueSignature(makeCues(11), CHUNK_OPTIONS)).not.toBe(base);
    expect(buildCueSignature([], CHUNK_OPTIONS)).toBe('empty');
  });
});

describe('runSummary 断点续跑', () => {
  it('全部块命中缓存时不再请求模型生成分段摘要', async () => {
    const cues = makeCues(60);
    const chunks = plannedChunks(cues);
    expect(chunks.length).toBeGreaterThan(1);

    const cached: ChunkSummary[] = chunks.map((chunk, index) => ({
      index,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      summary: `缓存摘要 ${index}`
    }));

    const provider = new FakeProvider();
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BVtest#p1',
    source: 'subtitle',
      cues,
      cachedChunks: cached,
      isCancelled: () => false
    });

    expect(provider.chunkCalls).toBe(0);
    expect(provider.mergeCalls).toBe(1);
    expect(result.chunkCount).toBe(chunks.length);
    expect(result.overview).toBe('这是一段整体概述');
  });

  it('只有缺失的块会请求模型', async () => {
    const cues = makeCues(60);
    const chunks = plannedChunks(cues);
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    const cached: ChunkSummary[] = chunks.slice(0, 2).map((chunk, index) => ({
      index,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      summary: `缓存摘要 ${index}`
    }));

    const provider = new FakeProvider();
    const progress: number[] = [];
    await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: null,
      videoKey: 'BVtest#p1',
    source: 'subtitle',
      cues,
      cachedChunks: cached,
      isCancelled: () => false,
      onProgress: (item) => {
        if (item.doneChunks !== undefined) progress.push(item.doneChunks);
      }
    });

    expect(provider.chunkCalls).toBe(chunks.length - 2);
    // 进度从已复用的段数起算，而不是从 0 开始
    expect(progress[0]).toBe(2);
  });

  it('时间范围不匹配的缓存不会被复用', async () => {
    const cues = makeCues(60);
    const chunks = plannedChunks(cues);
    const shifted: ChunkSummary[] = chunks.map((chunk, index) => ({
      index,
      startMs: chunk.startMs + 1,
      endMs: chunk.endMs + 1,
      summary: `错位摘要 ${index}`
    }));

    const provider = new FakeProvider();
    const captured: string[] = [];
    await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: null,
      videoKey: 'BVtest#p1',
    source: 'subtitle',
      cues,
      cachedChunks: shifted,
      onChunkDone: (chunk) => captured.push(chunk.summary),
      isCancelled: () => false
    });

    expect(provider.chunkCalls).toBe(chunks.length);
    expect(captured.length).toBe(chunks.length);
    expect(captured.some((item) => item.startsWith('错位摘要'))).toBe(false);
  });

  it('每块完成后立即回调，可用于落盘', async () => {
    const cues = makeCues(30);
    const chunks = plannedChunks(cues);
    const provider = new FakeProvider();
    const doneIndexes: number[] = [];

    await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: null,
      videoKey: 'BVtest#p1',
    source: 'subtitle',
      cues,
      onChunkDone: (chunk) => doneIndexes.push(chunk.index),
      isCancelled: () => false
    });

    expect(doneIndexes).toHaveLength(chunks.length);
    expect([...new Set(doneIndexes)].sort((a, b) => a - b)).toEqual(
      chunks.map((_, index) => index)
    );
  });

  it('分块失败时终止归并，已完成块仍通过回调留存', async () => {
    const cues = makeCues(60);
    const chunks = plannedChunks(cues);
    const provider = new FakeProvider(1);
    const saved: ChunkSummary[] = [];

    await expect(
      runSummary({
        settings: makeSettings(),
        provider,
        videoTitle: null,
        videoKey: 'BVtest#p1',
        source: 'subtitle',
        cues,
        onChunkDone: (chunk) => saved.push(chunk),
        isCancelled: () => false
      })
    ).rejects.toThrow();

    // 失败即终止：绝不带着残缺的分块去归并
    expect(provider.mergeCalls).toBe(0);
    // 并发为 2，失败的第 0 块不会进入留存，其余成功块可用于下次续跑
    expect(saved.every((chunk) => chunk.index !== 0)).toBe(true);
    expect(saved.length).toBeLessThan(chunks.length);
  });
});
