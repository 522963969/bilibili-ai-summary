import { FRAME_LIMITS, type FrameSelectOptions, type GraySignature } from './types';

/**
 * 抽帧决策逻辑。
 *
 * 这一层刻意不接触 DOM 与 canvas：采样点的规划、帧差计算、「哪些帧值得送模型」
 * 都是纯函数，可以用 Vitest 直接覆盖；真正的 seek 与 drawImage 由注入的
 * `sampleGray` 回调完成，从而把「耗时且不可测」的部分隔离在内容脚本里。
 */

export interface FrameSlot {
  index: number;
  /** 该槽位的起始时间（毫秒，含） */
  startMs: number;
  /** 该槽位的结束时间（毫秒，不含） */
  endMs: number;
  /** 槽位内的候选采样时间点（毫秒） */
  candidates: number[];
}

/** 灰度采样回调：给定时间点，返回该点的帧差签名；返回 null 表示该点取不到画面。 */
export type GraySampler = (tMs: number) => Promise<GraySignature | null>;

export interface FrameSelectResult {
  /** 判定为「画面有变化」而保留的时间点，升序 */
  keptTimes: number[];
  /** 探索过的候选点总数 */
  sampledPoints: number;
  /** 因视频较长而被放宽后的实际保留间隔（秒） */
  effectiveGapSeconds: number;
  /** 候选采样预算 */
  sampleBudget: number;
}

export interface FrameSelectProgress {
  sampledPoints: number;
  keptFrames: number;
  /** 已完成的槽位数 */
  doneSlots: number;
  totalSlots: number;
}

/** 归一化抽帧参数：把非法或互相矛盾的取值收敛为可用值。 */
export function normalizeSelectOptions(
  options: FrameSelectOptions,
  durationMs: number
): {
  sampleFps: number;
  minGapMs: number;
  maxFrames: number;
  imageWidth: number;
  effectiveGapSeconds: number;
} {
  const sampleFps = Math.min(4, Math.max(0.5, Number.isFinite(options.sampleFps) ? options.sampleFps : 2));
  const maxFrames = Math.min(600, Math.max(1, Math.round(options.maxFrames) || 1));
  const imageWidth = Math.min(1280, Math.max(256, Math.round(options.imageWidth) || 512));
  const baseGapSeconds = Math.max(1, Math.round(options.minGapSeconds) || 3);

  const durationSeconds = Math.max(0, durationMs / 1000);
  // 视频越长，固定间隔会产出过多帧。这里把间隔放宽到「刚好不超过帧上限」，
  // 而不是硬截断尾部——截断会让后半段视频完全没有画面信息。
  const requiredGap = durationSeconds > 0 ? durationSeconds / maxFrames : baseGapSeconds;
  const effectiveGapSeconds = Math.max(baseGapSeconds, Math.ceil(requiredGap));

  return {
    sampleFps,
    minGapMs: effectiveGapSeconds * 1000,
    maxFrames,
    imageWidth,
    effectiveGapSeconds
  };
}

/**
 * 规划采样槽位与槽内候选点。
 *
 * 思路：按「保留间隔」切片，每个槽位内密集探索若干候选点，
 * 最终每个槽位最多保留一帧。这样既能捕捉镜头变化，又天然满足最小间隔约束。
 */
export function planFrameSlots(durationMs: number, options: FrameSelectOptions): {
  slots: FrameSlot[];
  sampleBudget: number;
  effectiveGapSeconds: number;
} {
  const normalized = normalizeSelectOptions(options, durationMs);
  const duration = Math.max(0, Math.floor(durationMs));
  if (duration <= 0) {
    return { slots: [], sampleBudget: 0, effectiveGapSeconds: normalized.effectiveGapSeconds };
  }

  const gapMs = normalized.minGapMs;
  const slotCount = Math.max(1, Math.min(normalized.maxFrames, Math.floor(duration / gapMs)));

  // 候选预算封顶：抽帧耗时与 Seek 次数成正比，必须限制在可接受范围内
  const sampleBudget = Math.max(slotCount, normalized.maxFrames * FRAME_LIMITS.samplesPerFrameBudget);
  const perSlotCap = Math.max(1, Math.ceil(gapMs / (1000 / normalized.sampleFps)));
  const perSlot = Math.max(1, Math.min(perSlotCap, Math.round(sampleBudget / slotCount)));

  const actualGapMs = duration / slotCount;
  const slots: FrameSlot[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const startMs = Math.floor(index * actualGapMs);
    const endMs = index === slotCount - 1 ? duration : Math.floor((index + 1) * actualGapMs);
    const candidates: number[] = [];
    for (let step = 0; step < perSlot; step += 1) {
      const offset = perSlot === 1 ? 0 : Math.floor(((step + 0.5) / perSlot) * (endMs - startMs));
      const t = startMs + (perSlot === 1 ? Math.floor((endMs - startMs) / 2) : offset);
      candidates.push(Math.min(duration - 1, Math.max(0, t)));
    }
    slots.push({ index, startMs, endMs, candidates });
  }

  return { slots, sampleBudget, effectiveGapSeconds: normalized.effectiveGapSeconds };
}

/**
 * 去掉「已经识别过」的时间点。
 *
 * 断点续跑的关键一环：不在这里过滤，重试会把整段视频重新 seek + 编码一遍，
 * 用户看到的就是「重复提取、重复识别」，而模型调用一条也省不下来。
 */
export function withoutKnownTimes(times: number[], known: readonly number[]): number[] {
  if (known.length === 0) return [...times];
  const skip = new Set(known);
  return times.filter((tMs) => !skip.has(tMs));
}

/** 两个灰度签名的平均绝对差；长度不一致时返回 -1（调用方按「不可比较」处理）。 */export function grayDifference(a: GraySignature, b: GraySignature): number {
  if (a.values.length === 0 || a.values.length !== b.values.length) return -1;
  let sum = 0;
  for (let i = 0; i < a.values.length; i += 1) {
    sum += Math.abs((a.values[i] ?? 0) - (b.values[i] ?? 0));
  }
  return sum / a.values.length;
}

/** 把 RGBA 像素压成灰度签名。纯函数，便于在测试里构造确定性的输入。 */
export function toGraySignature(
  rgba: ArrayLike<number>,
  width: number = FRAME_LIMITS.signatureWidth,
  height: number = FRAME_LIMITS.signatureHeight
): GraySignature {
  const count = width * height;
  const values: number[] = new Array<number>(count);
  for (let i = 0; i < count; i += 1) {
    const base = i * 4;
    const r = rgba[base] ?? 0;
    const g = rgba[base + 1] ?? 0;
    const b = rgba[base + 2] ?? 0;
    values[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return { values, width, height };
}

/**
 * 逐个槽位挑选代表帧。
 *
 * 每个槽位内取「与上一保留帧差异最大」的候选点：
 * - 差异超过阈值 → 保留，并把该帧设为新的参照
 * - 不超过阈值 → 说明整段时间画面基本没变，直接跳过，不浪费模型调用
 *
 * 注意：槽位本身是最小间隔切片，但槽内挑中的时间点可能紧贴上一槽的末尾，
 * 因此候选点还需再按 `minGapMs` 过滤一次，否则会出现两帧只差几百毫秒、
 * 却各消耗一次模型调用的浪费。
 */
export async function selectFrameTimes(
  durationMs: number,
  options: FrameSelectOptions,
  sampleGray: GraySampler,
  hooks: {
    onProgress?: (progress: FrameSelectProgress) => void;
    /** 用户取消检查，每个候选点前调用 */
    isCancelled?: () => boolean;
  } = {}
): Promise<FrameSelectResult> {
  const plan = planFrameSlots(durationMs, options);
  const { minGapMs } = normalizeSelectOptions(options, durationMs);
  const keptTimes: number[] = [];
  let sampledPoints = 0;
  let reference: GraySignature | null = null;
  let lastKeptMs: number | null = null;

  for (const slot of plan.slots) {
    if (hooks.isCancelled?.()) break;

    let best: { tMs: number; signature: GraySignature; difference: number } | null = null;
    for (const tMs of slot.candidates) {
      if (hooks.isCancelled?.()) break;
      if (lastKeptMs !== null && Math.abs(tMs - lastKeptMs) < minGapMs) continue;
      const signature = await sampleGray(tMs);
      sampledPoints += 1;
      if (!signature) continue;
      const difference: number = reference
        ? grayDifference(signature, reference)
        : Number.POSITIVE_INFINITY;
      // 差异为 -1 表示签名不可比较，视为「拿不到有效画面」，不参与挑选
      if (difference < 0) continue;
      if (!best || difference > best.difference) best = { tMs, signature, difference };
    }

    if (best && best.difference >= FRAME_LIMITS.changeThreshold) {
      keptTimes.push(best.tMs);
      reference = best.signature;
      lastKeptMs = best.tMs;
    }

    hooks.onProgress?.({
      sampledPoints,
      keptFrames: keptTimes.length,
      doneSlots: slot.index + 1,
      totalSlots: plan.slots.length
    });
  }

  keptTimes.sort((a, b) => a - b);
  return {
    keptTimes,
    sampledPoints,
    effectiveGapSeconds: plan.effectiveGapSeconds,
    sampleBudget: plan.sampleBudget
  };
}
