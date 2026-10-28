import { describe, expect, it } from 'vitest';
import {
  grayDifference,
  normalizeSelectOptions,
  planFrameSlots,
  selectFrameTimes,
  toGraySignature,
  withoutKnownTimes
} from '@/core/frames/sampler';
import { FRAME_LIMITS, type GraySignature } from '@/core/frames/types';

const BASE = { sampleFps: 2, minGapSeconds: 3, maxFrames: 200, imageWidth: 512 };

/** 构造纯色灰度签名，用于可控的帧差测试。 */
function flatSignature(value: number): GraySignature {
  const size = FRAME_LIMITS.signatureWidth * FRAME_LIMITS.signatureHeight;
  return {
    values: new Array<number>(size).fill(value),
    width: FRAME_LIMITS.signatureWidth,
    height: FRAME_LIMITS.signatureHeight
  };
}

describe('normalizeSelectOptions', () => {
  it('短视屏沿用用户设定的保留间隔', () => {
    const result = normalizeSelectOptions(BASE, 213_000);
    expect(result.effectiveGapSeconds).toBe(3);
    expect(result.maxFrames).toBe(200);
  });

  it('长视频自动放宽保留间隔，避免尾部被整体丢弃', () => {
    // 1800 秒 / 200 帧 = 9 秒，应放宽到 9 而不是截断到前 600 秒
    const result = normalizeSelectOptions(BASE, 1_800_000);
    expect(result.effectiveGapSeconds).toBe(9);
  });

  it('非法参数收敛到合法范围', () => {
    const result = normalizeSelectOptions(
      { sampleFps: 99, minGapSeconds: -5, maxFrames: 0, imageWidth: 10 },
      60_000
    );
    expect(result.sampleFps).toBe(4);
    expect(result.minGapMs).toBeGreaterThan(0);
    expect(result.maxFrames).toBe(1);
    expect(result.imageWidth).toBe(256);
  });
});

describe('planFrameSlots', () => {
  it('零时长不产生槽位', () => {
    expect(planFrameSlots(0, BASE).slots).toHaveLength(0);
    expect(planFrameSlots(Number.NaN, BASE).slots).toHaveLength(0);
  });

  it('槽位覆盖整段视频且候选点落在槽内', () => {
    const { slots } = planFrameSlots(30_000, BASE);
    expect(slots.length).toBe(10);
    for (const slot of slots) {
      expect(slot.candidates.length).toBeGreaterThan(0);
      for (const t of slot.candidates) {
        expect(t).toBeGreaterThanOrEqual(slot.startMs);
        expect(t).toBeLessThan(slot.endMs);
      }
    }
  });

  it('候选总量受预算约束，不会随视频变长无限增长', () => {
    const short = planFrameSlots(60_000, BASE);
    const long = planFrameSlots(3_600_000, BASE);
    const totalCandidates = (plan: typeof short): number =>
      plan.slots.reduce((sum, slot) => sum + slot.candidates.length, 0);
    expect(totalCandidates(long)).toBeLessThanOrEqual(BASE.maxFrames * FRAME_LIMITS.samplesPerFrameBudget);
    expect(totalCandidates(short)).toBeLessThanOrEqual(BASE.maxFrames * FRAME_LIMITS.samplesPerFrameBudget);
  });

  it('候选点不超出视频范围', () => {
    const { slots } = planFrameSlots(9_500, BASE);
    for (const slot of slots) {
      for (const t of slot.candidates) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(9_500);
      }
    }
  });
});

describe('toGraySignature', () => {
  it('按亮度权重合成灰度', () => {
    // 纯白 255 -> 255；纯黑 0 -> 0；纯红 -> 约 76
    const white = toGraySignature([255, 255, 255, 255], 1, 1);
    expect(white.values[0]).toBe(255);
    const black = toGraySignature([0, 0, 0, 255], 1, 1);
    expect(black.values[0]).toBe(0);
    const red = toGraySignature([255, 0, 0, 255], 1, 1);
    expect(red.values[0]).toBe(76);
  });

  it('像素不足时按 0 补齐而不是产生 NaN', () => {
    const signature = toGraySignature([10, 10, 10, 255], 2, 2);
    expect(signature.values).toHaveLength(4);
    expect(signature.values.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('grayDifference', () => {
  it('完全相同的画面差值为 0', () => {
    expect(grayDifference(flatSignature(100), flatSignature(100))).toBe(0);
  });

  it('整体亮度差即平均绝对差', () => {
    expect(grayDifference(flatSignature(100), flatSignature(50))).toBe(50);
  });

  it('长度不一致返回 -1 表示不可比较', () => {
    const short = { values: [1, 2, 3], width: 3, height: 1 };
    expect(grayDifference(short, flatSignature(10))).toBe(-1);
  });
});

describe('selectFrameTimes', () => {
  it('画面完全静止时只保留首帧以外的空集，不产生无效帧', async () => {
    // 首帧差异为 Infinity 会保留；之后所有帧完全相同，差异 0 < 阈值，全部跳过
    const result = await selectFrameTimes(30_000, BASE, async () => flatSignature(120));
    expect(result.keptTimes).toHaveLength(1);
    expect(result.keptTimes[0] ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('持续变化时每个槽位保留一帧，且满足最小间隔', async () => {
    let counter = 0;
    const result = await selectFrameTimes(30_000, BASE, async () => {
      counter += 1;
      return flatSignature((counter * 40) % 256);
    });
    expect(result.keptTimes.length).toBe(10);
    for (let i = 1; i < result.keptTimes.length; i += 1) {
      const gap = (result.keptTimes[i] ?? 0) - (result.keptTimes[i - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(2_000);
    }
  });

  it('取不到画面的候选点被跳过而不是当成黑帧', async () => {
    const result = await selectFrameTimes(12_000, BASE, async () => null);
    expect(result.keptTimes).toHaveLength(0);
    expect(result.sampledPoints).toBeGreaterThan(0);
  });

  it('候选点全部取不到时不会把样本计为有效帧', async () => {
    const result = await selectFrameTimes(6_000, { ...BASE, maxFrames: 20 }, async () => null);
    expect(result.keptTimes).toHaveLength(0);
  });

  it('取消后立即停止并返回已完成的部分', async () => {
    let calls = 0;
    const result = await selectFrameTimes(
      60_000,
      BASE,
      async () => {
        calls += 1;
        return flatSignature((calls * 30) % 256);
      },
      { isCancelled: () => calls >= 4 }
    );
    expect(calls).toBeLessThanOrEqual(5);
    expect(result.keptTimes.length).toBeLessThan(20);
  });

  it('进度回调覆盖全部槽位且保留数单调不减', async () => {
    const seen: number[] = [];
    await selectFrameTimes(
      30_000,
      BASE,
      async () => flatSignature(Math.floor(Math.random() * 256)),
      { onProgress: (progress) => seen.push(progress.keptFrames) }
    );
    expect(seen).toHaveLength(10);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i] ?? 0).toBeGreaterThanOrEqual(seen[i - 1] ?? 0);
    }
  });
});

describe('withoutKnownTimes', () => {
  it('去掉已识别的时间点，顺序不变', () => {
    expect(withoutKnownTimes([0, 3000, 6000, 9000], [3000, 9000])).toEqual([0, 6000]);
  });

  it('没有已识别记录时原样返回（且不复用入参数组）', () => {
    const times = [0, 3000];
    const result = withoutKnownTimes(times, []);
    expect(result).toEqual(times);
    expect(result).not.toBe(times);
  });

  it('全部命中时返回空数组——续跑不再重复编码任何帧', () => {
    expect(withoutKnownTimes([0, 3000], [3000, 0])).toEqual([]);
  });
});
