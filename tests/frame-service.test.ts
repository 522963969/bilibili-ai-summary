import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameService } from '@/background/frame-service';
import type { SummaryService } from '@/background/summary-service';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/core/config/defaults';
import type { CapturedFrame, FrameScriptDocument } from '@/core/frames/types';
import type { SettingsSnapshot } from '@/core/storage/settings-repository';
import type { SummaryTaskSnapshot } from '@/core/summary/types';

/**
 * 画面识别后台编排的测试。
 *
 * 这里刻意用真实的消息解析路径 + 伪造的 fetch：
 * 想验证的是「断点去重、取消、失败保全、来源标签」这些逻辑，
 * 而不是 OpenAI 协议本身（那部分由 chat-client 的单一实现保证）。
 */

function makeStore() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async <T,>(key: string): Promise<T | undefined> => map.get(key) as T | undefined,
    set: async (key: string, value: unknown): Promise<void> => {
      map.set(key, value);
    },
    remove: async (key: string): Promise<void> => {
      map.delete(key);
    }
  };
}

function makeSettings(patch: { visionModel?: string; apiKey?: string } = {}): SettingsSnapshot {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.model.apiKey = patch.apiKey ?? 'sk-test';
  settings.vision.model = patch.visionModel ?? 'qwen-vl';
  return { settings, modelConfigured: true, visionConfigured: Boolean(settings.vision.model) };
}

function makeSummaryFake() {
  const snapshots = new Map<string, SummaryTaskSnapshot>();
  const launched: { videoKey: string; cueCount: number; source: string }[] = [];
  const service = {
    begin: async (videoKey: string, source: 'subtitle' | 'frames', message: string) => {
      snapshots.set(videoKey, {
        videoKey,
        status: 'preparing',
        source,
        totalChunks: 0,
        doneChunks: 0,
        message,
        error: null,
        result: null,
        startedAt: 1,
        updatedAt: 1
      });
      return { cancelled: false };
    },
    patch: async (videoKey: string, patch: Record<string, unknown>) => {
      const current = snapshots.get(videoKey);
      if (!current) return null;
      const next = { ...current, ...patch, updatedAt: 2 } as SummaryTaskSnapshot;
      snapshots.set(videoKey, next);
      return next;
    },
    get: async (videoKey: string) => snapshots.get(videoKey) ?? null,
    launch: async (
      material: { videoKey: string; cues: unknown[]; source: string }
    ) => {
      launched.push({
        videoKey: material.videoKey,
        cueCount: material.cues.length,
        source: material.source
      });
    }
  };
  return { service, snapshots, launched };
}

function frame(tMs: number): CapturedFrame {
  return { tMs, dataUrl: 'data:image/jpeg;base64,AAAA', width: 64, height: 36 };
}

/** 伪造一次成功的视觉模型响应，按给定编号返回描述。 */
function mockVisionResponse(indices: number[]): void {
  const content = indices.map((index) => `${index} | 画面描述 ${index}`).join('\n');
  mockVisionContent(content);
}

/** 直接指定模型返回的文本，用于覆盖「空返回」「格式不对」两类真实故障。 */
function mockVisionContent(content: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: 'qwen-vl',
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 10 }
        })
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FrameService.start', () => {
  it('没有缓存时建任务并要求抽帧', async () => {
    const store = makeStore();
    const summary = makeSummaryFake();
    const service = new FrameService({
      settings: { read: async () => makeSettings(), update: vi.fn(), reset: vi.fn() } as never,
      summary: summary.service as unknown as SummaryService,
      store: store as never
    });

    const outcome = await service.start('BV1xx#p1', '标题', false);
    expect(outcome.needsCapture).toBe(true);
    expect(outcome.snapshot.source).toBe('frames');
    expect(outcome.snapshot.status).toBe('preparing');
  });

  it('视觉模型未配置时拒绝启动，而不是等到抽完帧才发现', async () => {
    const summary = makeSummaryFake();
    const service = new FrameService({
      settings: {
        read: async () => makeSettings({ visionModel: '' })
      } as never,
      summary: summary.service as unknown as SummaryService,
      store: makeStore() as never
    });

    await expect(service.start('BV1xx#p1', null, false)).rejects.toMatchObject({
      code: 'E_SETTINGS_INVALID'
    });
  });

  it('已有完整讲稿时跳过抽帧直接进入总结', async () => {
    const store = makeStore();
    const doc: FrameScriptDocument = {
      videoKey: 'BV1xx#p1',
      entries: [
        { tMs: 0, text: '开场' },
        { tMs: 10_000, text: '中间' }
      ],
      frameCount: 2,
      durationMs: 60_000,
      complete: true,
      model: 'qwen-vl',
      createdAt: 1
    };
    store.map.set(`${STORAGE_KEYS.frameScriptPrefix}BV1xx#p1`, doc);
    const summary = makeSummaryFake();

    const service = new FrameService({
      settings: { read: async () => makeSettings() } as never,
      summary: summary.service as unknown as SummaryService,
      store: store as never
    });

    const outcome = await service.start('BV1xx#p1', null, false);
    expect(outcome.needsCapture).toBe(false);
    expect(outcome.reusedScript).toBe(true);
    expect(summary.launched).toEqual([{ videoKey: 'BV1xx#p1', cueCount: 2, source: 'frames' }]);
  });

  it('讲稿不完整时把已识别的时间点交给页面跳过，避免从头重抽', async () => {
    const store = makeStore();
    store.map.set(`${STORAGE_KEYS.frameScriptPrefix}BV1xx#p1`, {
      videoKey: 'BV1xx#p1',
      entries: [
        { tMs: 0, text: '开场' },
        { tMs: 12_000, text: '路口' }
      ],
      frameCount: 2,
      durationMs: 60_000,
      complete: false,
      model: 'qwen-vl',
      createdAt: 1
    } satisfies FrameScriptDocument);
    const summary = makeSummaryFake();

    const service = new FrameService({
      settings: { read: async () => makeSettings() } as never,
      summary: summary.service as unknown as SummaryService,
      store: store as never
    });

    const outcome = await service.start('BV1xx#p1', null, false);
    expect(outcome.needsCapture).toBe(true);
    expect([...outcome.skipTimes].sort((a, b) => a - b)).toEqual([0, 12_000]);
    expect(summary.launched).toHaveLength(0);
  });
});

describe('FrameService.push', () => {
  async function setup(initialEntries: FrameScriptDocument | null = null) {
    const store = makeStore();
    if (initialEntries) {
      store.map.set(`${STORAGE_KEYS.frameScriptPrefix}BV1xx#p1`, initialEntries);
    }
    const summary = makeSummaryFake();
    const service = new FrameService({
      settings: { read: async () => makeSettings() } as never,
      summary: summary.service as unknown as SummaryService,
      store: store as never
    });
    await service.start('BV1xx#p1', '演示视频', false);
    return { service, summary, store };
  }

  it('一批帧被识别后累加为带时间戳的画面描述', async () => {
    const { service } = await setup();
    mockVisionResponse([1, 2]);

    const result = await service.push('BV1xx#p1', [frame(0), frame(3000)], null);
    expect(result).toEqual({ accepted: true, analyzed: 2 });
  });

  it('已解析过的时间点不会重复送模型', async () => {
    const { service } = await setup();
    mockVisionResponse([1]);
    await service.push('BV1xx#p1', [frame(0)], null);

    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await service.push('BV1xx#p1', [frame(0)], null);
    expect(result).toEqual({ accepted: true, analyzed: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('进度帧不触发模型调用', async () => {
    const { service } = await setup();
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await service.push('BV1xx#p1', [], {
      phase: 'selecting',
      sampledPoints: 40,
      keptFrames: 8,
      totalSlots: 10,
      doneSlots: 4
    });
    expect(result.accepted).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('取消后返回 accepted=false，让页面侧停止继续抽帧', async () => {
    const { service, summary } = await setup();
    await service.finish('BV1xx#p1', null, '已取消');
    const result = await service.push('BV1xx#p1', [frame(0)], null);
    expect(result.accepted).toBe(false);
    expect(summary.launched).toHaveLength(0);
  });

  it('模型对图片没有任何输出时，第一批就停下并说清原因', async () => {
    const { service, summary } = await setup();
    mockVisionContent('');

    // 一批 6 帧，与真实 batchSize 一致
    const batch = [0, 3000, 6000, 9000, 12_000, 15_000].map(frame);
    const result = await service.push('BV1xx#p1', batch, null);

    expect(result.accepted).toBe(false);
    const snapshot = summary.snapshots.get('BV1xx#p1');
    expect(snapshot?.status).toBe('failed');
    expect(snapshot?.error).toContain('不支持图片输入');
    // 关键：不能把剩下的视频抽完再报错——任务已从内存里移除，后续推送一律拒收
    expect((await service.push('BV1xx#p1', [frame(18_000)], null)).accepted).toBe(false);
  });

  it('首次返回无法解析的内容还会再给一批机会，连续两批才失败', async () => {
    const { service, summary } = await setup();
    mockVisionContent('我看到了几帧画面，但没法逐帧描述。');

    const first = await service.push('BV1xx#p1', [frame(0), frame(3000)], null);
    expect(first.accepted).toBe(true);

    const second = await service.push('BV1xx#p1', [frame(6000), frame(9000)], null);
    expect(second.accepted).toBe(false);

    const snapshot = summary.snapshots.get('BV1xx#p1');
    expect(snapshot?.status).toBe('failed');
    // 原始返回必须带出来，否则用户无法判断是模型格式问题还是内容问题
    expect(snapshot?.error).toContain('我看到了几帧画面');
  });

  it('已识别出描述后，偶尔一批空返回不会让整个任务失败', async () => {
    const { service, summary } = await setup();
    mockVisionResponse([1, 2]);
    await service.push('BV1xx#p1', [frame(0), frame(3000)], null);

    // 换成一个「这次什么都没回」的响应
    mockVisionContent('');
    const result = await service.push('BV1xx#p1', [frame(6000), frame(9000)], null);

    expect(result.accepted).toBe(true);
    expect(summary.snapshots.get('BV1xx#p1')?.status).not.toBe('failed');
  });

  it('按行序兜底后不再是零产出', async () => {
    const { service } = await setup();
    // 没有编号，但一行一帧：兜底解析应当把它当成 3 条描述
    mockVisionContent('夜间骑行的第一视角\n路边停着一辆白色轿车\n路口亮着绿灯');

    const result = await service.push('BV1xx#p1', [frame(0), frame(3000), frame(6000)], null);
    expect(result).toEqual({ accepted: true, analyzed: 3 });
  });
});

describe('FrameService.finish', () => {
  async function setup() {
    const store = makeStore();
    const summary = makeSummaryFake();
    const service = new FrameService({
      settings: { read: async () => makeSettings() } as never,
      summary: summary.service as unknown as SummaryService,
      store: store as never
    });
    await service.start('BV1xx#p1', '演示视频', false);
    return { service, summary, store };
  }

  it('抽帧完成后把讲稿写成 cue 并交给总结管线', async () => {
    const { service, summary } = await setup();
    mockVisionResponse([1, 2]);
    await service.push('BV1xx#p1', [frame(0), frame(5000)], null);

    const result = await service.finish(
      'BV1xx#p1',
      { keptFrames: 2, sampledPoints: 20, durationMs: 60_000, elapsedMs: 1000 },
      null
    );

    expect(result.accepted).toBe(true);
    expect(summary.launched).toEqual([{ videoKey: 'BV1xx#p1', cueCount: 2, source: 'frames' }]);
  });

  it('讲稿落盘为 complete，下次可直接复用', async () => {
    const { service, store } = await setup();
    mockVisionResponse([1]);
    await service.push('BV1xx#p1', [frame(0)], null);
    await service.finish(
      'BV1xx#p1',
      { keptFrames: 1, sampledPoints: 10, durationMs: 30_000, elapsedMs: 500 },
      null
    );

    const doc = store.map.get(`${STORAGE_KEYS.frameScriptPrefix}BV1xx#p1`) as FrameScriptDocument;
    expect(doc.complete).toBe(true);
    expect(doc.durationMs).toBe(30_000);
    expect(doc.entries).toHaveLength(1);
  });

  it('抽帧报错时把任务标记为失败并保全已识别内容', async () => {
    const { service, summary, store } = await setup();
    mockVisionResponse([1]);
    await service.push('BV1xx#p1', [frame(0)], null);

    const result = await service.finish('BV1xx#p1', null, '视频尚未加载出画面');
    expect(result.accepted).toBe(false);
    expect(summary.launched).toHaveLength(0);
    const doc = store.map.get(`${STORAGE_KEYS.frameScriptPrefix}BV1xx#p1`) as FrameScriptDocument;
    expect(doc.complete).toBe(false);
    expect(doc.entries).toHaveLength(1);
    expect(summary.snapshots.get('BV1xx#p1')?.status).toBe('failed');
  });

  it('模型没给出任何描述时明确失败，而不是产出空总结', async () => {
    const { service, summary } = await setup();
    mockVisionResponse([]);
    await service.push('BV1xx#p1', [frame(0)], null);

    const result = await service.finish(
      'BV1xx#p1',
      { keptFrames: 1, sampledPoints: 10, durationMs: 30_000, elapsedMs: 500 },
      null
    );
    expect(result.accepted).toBe(false);
    expect(summary.launched).toHaveLength(0);
    expect(summary.snapshots.get('BV1xx#p1')?.status).toBe('failed');
  });
});
