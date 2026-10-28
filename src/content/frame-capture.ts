import { selectFrameTimes, toGraySignature, withoutKnownTimes } from '@/core/frames/sampler';
import {
  FRAME_LIMITS,
  type CapturedFrame,
  type FrameCaptureSummary,
  type FrameSelectOptions,
  type GraySignature
} from '@/core/frames/types';

/**
 * 内容脚本侧的抽帧执行器。
 *
 * 职责边界：只做「操作页面里的 `<video>` 并产出图片」，不判断画面内容、
 * 不调用模型、不持有业务状态。画面识别与总结都在 Service Worker 侧完成。
 *
 * 之所以由内容脚本反过来「推」给后台，而不是后台发一条长消息等待结果：
 * 抽帧需要 30 秒以上，会超过扩展页面 8 秒的消息超时；
 * 分批推送还能形成背压——后台没处理完上一批，这里就不会继续抽。
 */

export interface FrameCapturePush {
  frames: CapturedFrame[];
  progress: {
    phase: 'selecting' | 'encoding';
    sampledPoints: number;
    keptFrames: number;
    totalSlots: number;
    doneSlots: number;
  } | null;
}

export interface FrameCaptureRequest {
  videoKey: string;
  options: FrameSelectOptions;
  /**
   * 已经识别过的时间点，抽取时直接跳过。
   *
   * 否则「上次跑到一半失败、再点一次」会把整段视频重新 seek + 编码一遍，
   * 用户看到的就是「重复提取、重复识别」，而模型调用其实一条都不会省。
   */
  skipTimes?: number[];
  /** 推送一批帧；返回 false 表示后台拒收（通常因为用户已取消），应立即中止 */
  push: (batch: FrameCapturePush) => Promise<boolean>;
  /** 每批之间检查一次是否已取消 */
  isCancelled: () => boolean;
}

export type FrameCaptureOutcome =
  | { ok: true; summary: FrameCaptureSummary }
  | { ok: false; reason: 'no-video' | 'not-ready' | 'cancelled' | 'rejected' };

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * 找到页面里真正在播放的视频。
 *
 * B 站会同时存在广告位、预览等 `<video>`，按「分辨率 × 是否有画面」挑主体，
 * 避免抽到广告或空白占位。
 */
export function findMainVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll('video'));
  if (videos.length === 0) return null;
  let best: HTMLVideoElement | null = null;
  let bestScore = -1;
  for (const video of videos) {
    const area = video.videoWidth * video.videoHeight;
    // 已经有解码画面的优先，其次比尺寸
    const score = area > 0 ? area : -1;
    if (score > bestScore) {
      best = video;
      bestScore = score;
    }
  }
  return best ?? videos[0] ?? null;
}

/** 等待视频具备「可以抽帧」的最小条件：有元数据、有解码尺寸。 */
async function waitVideoReady(video: HTMLVideoElement, timeoutMs = 15000): Promise<boolean> {
  if (video.readyState >= 2 && video.videoWidth > 0) return true;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      video.removeEventListener('loadedmetadata', finish);
      video.removeEventListener('loadeddata', finish);
      window.clearInterval(poll);
      resolve();
    };
    video.addEventListener('loadedmetadata', finish);
    video.addEventListener('loadeddata', finish);
    const poll = window.setInterval(() => {
      if (video.readyState >= 2 && video.videoWidth > 0) finish();
    }, 200);
    window.setTimeout(finish, timeoutMs);
  });

  return video.readyState >= 2 && video.videoWidth > 0;
}

/** 跳转到指定秒并等待解码完成；超时也返回，避免个别关键帧卡死整条流程。 */
async function seekAndWait(video: HTMLVideoElement, seconds: number, timeoutMs = 3000): Promise<void> {
  const target = Math.max(0, seconds);
  if (Math.abs(video.currentTime - target) < 0.04) {
    await nextPaint();
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = target;
    } catch {
      finish();
    }
  });
  await nextPaint();
}

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  return { canvas, ctx };
}

/** 抽一帧的低分辨率灰度签名，用于判断画面是否变化。 */
function captureSignature(video: HTMLVideoElement): GraySignature | null {
  const width = FRAME_LIMITS.signatureWidth;
  const height = FRAME_LIMITS.signatureHeight;
  const surface = createCanvas(width, height);
  if (!surface) return null;
  try {
    surface.ctx.drawImage(video, 0, 0, width, height);
    const data = surface.ctx.getImageData(0, 0, width, height).data;
    return toGraySignature(data, width, height);
  } catch {
    // 跨域污染时这里会抛 SecurityError；返回 null 让上层跳过该点而不是产出黑帧
    return null;
  }
}

/** 把当前帧编码成 JPEG data URL。 */
function captureJpeg(video: HTMLVideoElement, targetWidth: number): {
  dataUrl: string;
  width: number;
  height: number;
} | null {
  const ratio = video.videoHeight / video.videoWidth;
  const width = Math.max(64, Math.min(targetWidth, video.videoWidth || targetWidth));
  const height = Math.max(36, Math.round(width * ratio));
  const surface = createCanvas(width, height);
  if (!surface) return null;
  try {
    surface.ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = surface.canvas.toDataURL('image/jpeg', FRAME_LIMITS.jpegQuality);
    // 空帧的 dataURL 极短，明确判掉而不是把空白图送给模型
    if (!dataUrl.startsWith('data:image/jpeg') || dataUrl.length < 800) return null;
    return { dataUrl, width, height };
  } catch {
    return null;
  }
}

/**
 * 执行一次完整抽帧。
 *
 * 两轮 seek：
 * 1. 探索轮：密集取样、算帧差，挑出「画面确有变化」的时间点
 * 2. 编码轮：只对留下的时间点重新 seek 并编码成 JPEG
 *
 * 之所以分成两轮，是为了避免把每个候选点都编码一次——
 * 编码开销远大于 32x18 的签名采样，而候选点里绝大多数最终会被丢掉。
 */
export async function runFrameCapture(request: FrameCaptureRequest): Promise<FrameCaptureOutcome> {
  const video = findMainVideo();
  if (!video) return { ok: false, reason: 'no-video' };
  if (!(await waitVideoReady(video))) return { ok: false, reason: 'not-ready' };

  const durationMs = Math.max(0, Math.round(video.duration * 1000));
  // 直播流 / 分片未就绪时 duration 可能是 Infinity 或 NaN：两者都会让
  // 「槽位数量」算成 NaN，循环一次都不跑，最后报「没有抽到画面」，必须单独判掉
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { ok: false, reason: 'not-ready' };

  const startedAt = Date.now();
  const restore = { currentTime: video.currentTime, paused: video.paused };
  const frames: CapturedFrame[] = [];
  let sampledPoints = 0;
  /**
   * 后台拒收过任何一条推送就整体停下。
   *
   * 拒收意味着任务已经结束（用户取消、或后台判定模型给不出描述），
   * 继续 seek 只是让页面白白抖动几分钟。
   */
  let backendStopped = false;
  const isStopped = (): boolean => backendStopped || request.isCancelled();

  // 抽帧期间必须暂停，否则播放会让 seek 位置不断漂移，也影响用户观看
  try {
    video.pause();
  } catch {
    // 暂停失败不影响抽帧，只是位置可能偏移
  }

  try {
    let lastReportAt = 0;
    const selection = await selectFrameTimes(
      durationMs,
      request.options,
      async (tMs) => {
        await seekAndWait(video, tMs / 1000);
        return captureSignature(video);
      },
      {
        isCancelled: isStopped,
        onProgress: (progress) => {
          sampledPoints = progress.sampledPoints;
          // 探索轮的耗时可能长达数十秒，期间必须给界面一个可见的进度，
          // 但每探索一个点就发一条消息会淹没通道，因此按时间节流
          const now = Date.now();
          if (now - lastReportAt < 2000) return;
          lastReportAt = now;
          void request
            .push({
              frames: [],
              progress: {
                phase: 'selecting',
                sampledPoints: progress.sampledPoints,
                keptFrames: progress.keptFrames,
                totalSlots: progress.totalSlots,
                doneSlots: progress.doneSlots
              }
            })
            .then((accepted) => {
              if (!accepted) backendStopped = true;
            })
            .catch(() => {
              // 通道断了同样视为停止，避免在无后台的情况下继续抽帧
              backendStopped = true;
            });
        }
      }
    );

    sampledPoints = selection.sampledPoints;
    if (isStopped()) return { ok: false, reason: 'cancelled' };

    // 续跑：已经识别过的时间点不再重新编码，直接跳过
    const targets = withoutKnownTimes(selection.keptTimes, request.skipTimes ?? []);
    const reused = selection.keptTimes.length - targets.length;

    for (const tMs of targets) {
      if (isStopped()) return { ok: false, reason: 'cancelled' };
      await seekAndWait(video, tMs / 1000);
      const jpeg = captureJpeg(video, request.options.imageWidth);
      if (!jpeg) continue;
      frames.push({ tMs, dataUrl: jpeg.dataUrl, width: jpeg.width, height: jpeg.height });

      if (frames.length % FRAME_LIMITS.batchSize === 0) {
        const batch = frames.splice(0, frames.length);
        const accepted = await request.push({
          frames: batch,
          progress: {
            phase: 'encoding',
            sampledPoints,
            keptFrames: targets.length,
            totalSlots: targets.length,
            doneSlots: targets.length
          }
        });
        if (!accepted) return { ok: false, reason: 'rejected' };
      }
    }

    if (frames.length > 0) {
      const accepted = await request.push({
        frames: frames.splice(0, frames.length),
        progress: null
      });
      if (!accepted) return { ok: false, reason: 'rejected' };
    }

    return {
      ok: true,
      summary: {
        videoKey: request.videoKey,
        keptFrames: targets.length,
        sampledPoints,
        durationMs,
        elapsedMs: Date.now() - startedAt,
        reusedFrames: reused
      }
    };
  } finally {
    // 恢复用户的观看位置与播放状态
    try {
      video.currentTime = restore.currentTime;
      if (!restore.paused) void video.play().catch(() => undefined);
    } catch {
      // 播放器已销毁时忽略
    }
  }
}
