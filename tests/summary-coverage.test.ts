import { describe, expect, it } from 'vitest';
import type { AiProvider, CompletionRequest, CompletionResult } from '@/core/ai/types';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { buildCoverageHint, measureChapterCoverage } from '@/core/summary/coverage';
import { runSummary } from '@/core/summary/orchestrator';
import type { SummaryChapter } from '@/core/summary/types';
import type { ExtensionSettings } from '@/core/settings/types';
import type { SubtitleCue } from '@/core/subtitle/types';

/**
 * 章节覆盖度回归测试。
 *
 * 背景（真实案例）：24 分 34 秒的视频只输出 4 个章节、最晚到 07:30。
 * 原因是单块也走「先压成 200 字摘要再归并」，后半段的时间点在那一步就没了。
 * 这里锁住两件事：单块必须直出；覆盖不足必须补一次。
 */

function makeCues(count: number, stepMs = 60_000, text = '这是一句用于测试覆盖度的字幕'): SubtitleCue[] {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    startMs: index * stepMs,
    endMs: index * stepMs + stepMs - 500,
    text
  }));
}

function makeSettings(): ExtensionSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    model: { ...DEFAULT_SETTINGS.model, apiKey: 'sk-test' },
    chunk: {
      targetTokens: 6000,
      maxTokens: 8000,
      overlapSeconds: 30,
      concurrency: 2,
      maxRetries: 0
    }
  };
}

const SHORT_JSON = JSON.stringify({
  overview: '只覆盖开头的概述',
  highlights: ['要点一'],
  chapters: [{ title: '开场', start: '00:00', points: ['介绍'] }]
});

const FULL_JSON = JSON.stringify({
  overview: '覆盖全片的概述',
  highlights: ['要点一'],
  chapters: [
    { title: '开场', start: '00:00', points: ['介绍'] },
    { title: '中段', start: '12:00', points: ['展开'] },
    { title: '结论', start: '24:00', points: ['收尾'] }
  ]
});

class ScriptedProvider implements AiProvider {
  readonly requests: CompletionRequest[] = [];
  private mergeIndex = 0;

  constructor(private readonly mergeScript: Array<string | Error>) {}

  async testConnection(): Promise<never> {
    throw new Error('不应在总结流程中调用');
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    if (!request.json) {
      return { content: '分段摘要', usage: null, model: 'fake', latencyMs: 1 };
    }
    const script = this.mergeScript[Math.min(this.mergeIndex, this.mergeScript.length - 1)];
    this.mergeIndex += 1;
    if (script instanceof Error) throw script;
    return { content: script ?? SHORT_JSON, usage: null, model: 'fake', latencyMs: 1 };
  }

  get mergeRequests(): CompletionRequest[] {
    return this.requests.filter((request) => request.json === true);
  }
}

const isCancelled = (): boolean => false;

describe('measureChapterCoverage', () => {
  it('章节铺到结尾附近时不算不足', () => {
    const chapters: SummaryChapter[] = [
      { title: '开场', startMs: 0, endMs: null, points: [] },
      { title: '收尾', startMs: 1_400_000, endMs: null, points: [] }
    ];
    const coverage = measureChapterCoverage(chapters, 1_500_000);
    expect(coverage.ratio).toBeCloseTo(0.933, 3);
    expect(coverage.insufficient).toBe(false);
  });

  it('只覆盖前段时判为不足', () => {
    const chapters: SummaryChapter[] = [{ title: '开场', startMs: 450_000, endMs: null, points: [] }];
    const coverage = measureChapterCoverage(chapters, 1_474_000);
    expect(coverage.insufficient).toBe(true);
  });

  it('素材不足 5 分钟时不做判定，避免短视频被误判', () => {
    const chapters: SummaryChapter[] = [{ title: '开场', startMs: 0, endMs: null, points: [] }];
    expect(measureChapterCoverage(chapters, 120_000).insufficient).toBe(false);
  });

  it('没有章节时视为完全没覆盖', () => {
    const coverage = measureChapterCoverage([], 1_500_000);
    expect(coverage.lastStartMs).toBe(0);
    expect(coverage.insufficient).toBe(true);
  });

  it('素材终点未知时不做判定', () => {
    const coverage = measureChapterCoverage([{ title: 'a', startMs: 0, endMs: null, points: [] }], 0);
    expect(coverage.ratio).toBe(0);
    expect(coverage.insufficient).toBe(false);
  });
});

describe('buildCoverageHint', () => {
  it('明确指出上次覆盖到哪、素材到哪', () => {
    const hint = buildCoverageHint(measureChapterCoverage([], 1_474_000));
    expect(hint).toContain('00:00');
    expect(hint).toContain('24:34');
    expect(hint).toContain('落在素材结尾附近');
  });
});

describe('runSummary 单块直出', () => {
  it('只有一块时不调用分块摘要，直接把带时间戳的字幕交给模型', async () => {
    const cues = makeCues(25);
    const provider = new ScriptedProvider([FULL_JSON]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BVtest#p1',
      cues,
      source: 'subtitle',
      isCancelled
    });

    expect(provider.requests).toHaveLength(1);
    const request = provider.requests[0];
    expect(request?.json).toBe(true);
    const userMessage = request?.messages.find((message) => message.role === 'user')?.content ?? '';
    // 直出的证据：拿到的是原始字幕行，而不是「以下是各段落摘要」
    expect(userMessage).toContain('[00:00] 这是一句用于测试覆盖度的字幕');
    expect(userMessage).toContain('[23:00]');
    expect(userMessage).not.toContain('以下是各段落摘要');
    expect(userMessage).toContain('素材范围：00:00 - 24:59');

    expect(result.chapters).toHaveLength(3);
    expect(result.materialEndMs).toBe(1_499_500);
    expect(result.chunkCount).toBe(1);
  });

  it('结果写入素材指纹，用于核对总结与视频是否对应', async () => {
    const cues = makeCues(3, 10_000, '第一句话');
    const provider = new ScriptedProvider([FULL_JSON]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BV1xx411c7mD#p2',
      cues,
      source: 'subtitle',
      isCancelled
    });

    // 指纹必须能回答三件事：属于哪个视频、依据多少条、覆盖到哪
    expect(result.material).toBeDefined();
    expect(result.material?.videoKey).toBe('BV1xx411c7mD#p2');
    expect(result.material?.videoTitle).toBe('测试视频');
    expect(result.material?.cueCount).toBe(3);
    expect(result.material?.startMs).toBe(0);
    expect(result.material?.endMs).toBe(result.materialEndMs);
    expect(result.material?.firstText).toBe('第一句话');
  });

  it('素材首句过长时截断，避免把整条字幕塞进脚注', async () => {
    const longText = '这是一句非常长的字幕'.repeat(10);
    const cues = makeCues(2, 10_000, longText);
    const provider = new ScriptedProvider([FULL_JSON]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: null,
      videoKey: 'BVtest#p1',
      cues,
      source: 'subtitle',
      isCancelled
    });

    expect(result.material?.firstText.length).toBe(40);
    expect(result.material?.videoTitle).toBeNull();
  });

  it('章节只覆盖前段时补问一次，并采用覆盖更好的结果', async () => {
    const cues = makeCues(25);
    const provider = new ScriptedProvider([SHORT_JSON, FULL_JSON]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BVtest#p1',
      cues,
      source: 'subtitle',
      isCancelled
    });

    expect(provider.mergeRequests).toHaveLength(2);
    const retryMessage = provider.mergeRequests[1]?.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(retryMessage).toContain('只覆盖到 00:00');
    expect(retryMessage).toContain('24:59');
    expect(result.chapters).toHaveLength(3);
    expect(result.overview).toBe('覆盖全片的概述');
  });

  it('补问失败时保留第一份结果，不丢弃已拿到的总结', async () => {
    const cues = makeCues(25);
    const provider = new ScriptedProvider([SHORT_JSON, new Error('补问超时')]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BVtest#p1',
      cues,
      source: 'subtitle',
      isCancelled
    });

    expect(provider.mergeRequests).toHaveLength(2);
    expect(result.overview).toBe('只覆盖开头的概述');
    expect(result.chapters).toHaveLength(1);
  });

  it('补问结果更差时不采用第二份', async () => {
    const cues = makeCues(25);
    const provider = new ScriptedProvider([FULL_JSON, SHORT_JSON]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BVtest#p1',
      cues,
      source: 'subtitle',
      isCancelled
    });

    // 第一份已覆盖到结尾，不会触发补问
    expect(provider.mergeRequests).toHaveLength(1);
    expect(result.chapters).toHaveLength(3);
  });

  it('短视频不触发补问', async () => {
    const cues = makeCues(4, 15_000);
    const provider = new ScriptedProvider([SHORT_JSON]);
    const result = await runSummary({
      settings: makeSettings(),
      provider,
      videoTitle: '测试视频',
      videoKey: 'BVtest#p1',
      cues,
      source: 'subtitle',
      isCancelled
    });

    expect(provider.mergeRequests).toHaveLength(1);
    expect(result.materialEndMs).toBe(59_500);
  });
});
