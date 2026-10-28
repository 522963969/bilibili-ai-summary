import { AppError } from '@/core/errors/app-error';
import type { CapturedFrame, FrameCaptureProgress, FramePushResult, FrameStartResult } from '@/core/frames/types';
import type { ContentRequestMessage } from '@/core/messaging/contracts';
import type { SettingsRepositoryLike } from '@/core/storage/settings-repository';
import type { SummaryTaskSnapshot } from '@/core/summary/types';
import type { FrameService } from '../frame-service';
import { identityFromTab } from '../tab-identity';
import { normalizeTabTitle } from './video';
import type { HandlerRegistry } from '../router';

/**
 * 画面识别相关消息处理。
 *
 * `frames.start` 只负责「建任务 + 通知页面开始抽帧」并立刻返回；
 * 帧数据由内容脚本通过 `frames.push` 反向推送，抽完调 `frames.finish`。
 * 这样长耗时的工作不占用消息通道，也不会触发 8 秒超时。
 */

export interface FrameHandlerDeps {
  frames: FrameService;
  settings: SettingsRepositoryLike;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTabId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError('E_INVALID_PAYLOAD', { details: 'tabId 必须是非负整数' });
  }
  return value;
}

function assertVideoKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 80) {
    throw new AppError('E_INVALID_PAYLOAD', { details: 'videoKey 不合法' });
  }
  return value;
}

/** 只接受形如 data:image/jpeg;base64,... 的帧，避免把任意字符串当图片传给模型。 */
function assertFrames(value: unknown): CapturedFrame[] {
  if (!Array.isArray(value)) {
    throw new AppError('E_INVALID_PAYLOAD', { details: 'frames 必须是数组' });
  }
  const frames: CapturedFrame[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const tMs = item.tMs;
    const dataUrl = item.dataUrl;
    if (typeof tMs !== 'number' || !Number.isFinite(tMs) || tMs < 0) continue;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
    frames.push({
      tMs: Math.round(tMs),
      dataUrl,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : 0
    });
  }
  return frames;
}

function assertProgress(value: unknown): FrameCaptureProgress | null {
  if (!isPlainObject(value)) return null;
  const phase = value.phase === 'encoding' ? 'encoding' : 'selecting';
  const readNumber = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0;
  return {
    phase,
    sampledPoints: readNumber(value.sampledPoints),
    keptFrames: readNumber(value.keptFrames),
    totalSlots: readNumber(value.totalSlots),
    doneSlots: readNumber(value.doneSlots)
  };
}

/** 通知页面侧开始抽帧；页面脚本未注入时给出可执行的提示。 */
async function startCaptureOnPage(
  tabId: number,
  videoKey: string,
  options: { sampleFps: number; minGapSeconds: number; maxFrames: number; imageWidth: number },
  skipTimes: number[]
): Promise<FrameStartResult> {
  const message: ContentRequestMessage = {
    type: 'content.startFrames',
    payload: { videoKey, options, skipTimes }
  };
  try {
    const response = await chrome.tabs.sendMessage<ContentRequestMessage, FrameStartResult>(
      tabId,
      message
    );
    if (!response || typeof response !== 'object') {
      return { started: false, reason: 'no-video' };
    }
    return response;
  } catch {
    throw new AppError('E_CONTENT_SCRIPT_UNAVAILABLE', {
      message: '页面脚本没有响应，请刷新 B 站视频页后重试'
    });
  }
}

export function createFrameHandlers(
  deps: FrameHandlerDeps
): Pick<
  HandlerRegistry,
  'frames.start' | 'frames.push' | 'frames.finish' | 'frames.stop' | 'frames.getScript' | 'frames.clear'
> {
  return {
    'frames.start': async (payload, sender): Promise<SummaryTaskSnapshot> => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 tabId' });
      }
      const tabId = assertTabId(payload.tabId);
      const force = payload.force === true;
      const identity = await identityFromTab(tabId, sender);

      let videoTitle: string | null = null;
      if (sender.tab?.id === tabId && sender.tab.title) {
        videoTitle = normalizeTabTitle(sender.tab.title);
      } else {
        try {
          const tab = await chrome.tabs.get(tabId);
          videoTitle = normalizeTabTitle(tab.title);
        } catch {
          videoTitle = null;
        }
      }

      const outcome = await deps.frames.start(identity.key, videoTitle, force);
      if (!outcome.needsCapture) return outcome.snapshot;

      const { settings } = await deps.settings.read();
      const result = await startCaptureOnPage(
        tabId,
        identity.key,
        {
          sampleFps: settings.frames.sampleFps,
          minGapSeconds: settings.frames.minGapSeconds,
          maxFrames: settings.frames.maxFrames,
          imageWidth: settings.frames.imageWidth
        },
        outcome.skipTimes
      );

      if (!result.started) {
        const reason =
          result.reason === 'no-video-key'
            ? '视频标识缺失，请刷新 B 站页面后重试'
            : '页面上没有找到可抽帧的视频元素，请先让视频播放出画面';
        await deps.frames.finish(identity.key, null, reason);
        throw new AppError('E_FRAME_CAPTURE_UNAVAILABLE', { message: reason });
      }

      return outcome.snapshot;
    },

    'frames.push': async (payload): Promise<FramePushResult> => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      const frames = assertFrames(payload.frames);
      const progress = assertProgress(payload.progress);
      return deps.frames.push(videoKey, frames, progress);
    },

    'frames.finish': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      const error = typeof payload.error === 'string' && payload.error.length > 0 ? payload.error : null;
      const raw = isPlainObject(payload.capture) ? payload.capture : null;
      const capture =
        raw &&
        typeof raw.keptFrames === 'number' &&
        typeof raw.sampledPoints === 'number' &&
        typeof raw.durationMs === 'number' &&
        typeof raw.elapsedMs === 'number'
          ? {
              keptFrames: raw.keptFrames,
              sampledPoints: raw.sampledPoints,
              durationMs: raw.durationMs,
              elapsedMs: raw.elapsedMs,
              reusedFrames: typeof raw.reusedFrames === 'number' ? raw.reusedFrames : 0,
              videoKey
            }
          : null;
      return deps.frames.finish(videoKey, capture, error);
    },

    'frames.stop': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 tabId' });
      }
      const tabId = assertTabId(payload.tabId);
      const videoKey = assertVideoKey(payload.videoKey);
      const message: ContentRequestMessage = { type: 'content.stopFrames', payload: { videoKey } };
      try {
        const response = await chrome.tabs.sendMessage<ContentRequestMessage, { stopped: boolean }>(
          tabId,
          message
        );
        return { stopped: response?.stopped === true };
      } catch {
        // 页面已关闭或脚本未注入：抽帧本来也跑不下去，按已停止处理
        return { stopped: true };
      }
    },

    'frames.getScript': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      return { script: await deps.frames.getScript(videoKey) };
    },

    'frames.clear': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 videoKey' });
      }
      const videoKey = assertVideoKey(payload.videoKey);
      return deps.frames.clearScript(videoKey);
    }
  };
}
