import { isAllowedBilibiliUrl } from '@/core/bilibili/api';
import type {
  ContentFetchResult,
  ContentRequestMessage,
  RequestMessage,
  ResponseEnvelope
} from '@/core/messaging/contracts';
import type {
  CapturedFrame,
  FrameCaptureProgress,
  FrameCaptureSummary,
  FramePushResult,
  FrameStartResult
} from '@/core/frames/types';
import { openPanel, startEntry } from './banner';
import { findMainVideo, runFrameCapture } from './frame-capture';
import { collectPageContext } from './page-context';

/**
 * Content Script：只承担四件事
 * 1. 采集页面上下文（只读 DOM）
 * 2. 在页面同源环境下执行受限取数（域名白名单 + 仅 GET）
 * 3. 注入页面内入口（右侧行内按钮 + 按钮下方就地展开的面板）
 * 4. 无字幕时按指令抽帧，并把帧分批推给后台
 * 字幕解析、缓存、模型调用与任务编排全部在 Service Worker 侧完成。
 */

/** 是否已有抽帧任务在跑，避免重复点击叠加多条流水线。 */
let capturing = false;
/**
 * 是否已被要求停止抽帧。
 *
 * 抽帧是页面里的长循环，后台的 `frames.push` 只在「下一批」才知道任务已被取消；
 * 探索阶段可能几十秒不推批次，所以取消必须能直接打断 seek 循环。
 */
let stopRequested = false;

function isContentRequest(message: unknown): message is ContentRequestMessage {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return (
    type === 'content.collectPageContext' ||
    type === 'content.fetchJson' ||
    type === 'content.openPanel' ||
    type === 'content.startFrames' ||
    type === 'content.stopFrames' ||
    type === 'content.download'
  );
}

/**
 * 在页面顶层文档里触发一次文件下载。
 *
 * 面板是跨源 iframe，浏览器会把它发起的 blob 下载直接取消（实测 downloadWillBegin
 * 后立刻 canceled，文件不落盘），所以下载必须回到顶层文档来发起。
 *
 * `encoding === 'base64'` 用于 PNG 这类二进制：消息通道只能传 JSON，
 * 面板先把 Blob 读成 base64，这里再还原成字节数组，不能按 UTF-8 写回字符串。
 */
function downloadFile(payload: {
  fileName: string;
  text: string;
  mime: string;
  encoding?: 'utf8' | 'base64';
}): { started: boolean } {
  try {
    let body: BlobPart = payload.text;
    if (payload.encoding === 'base64') {
      const binary = atob(payload.text);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      body = bytes;
    }

    const blob = new Blob([body], { type: payload.mime });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = payload.fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // 立即 revoke 会让部分浏览器的下载中断，等下载启动后再释放
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    return { started: true };
  } catch {
    return { started: false };
  }
}

async function fetchJson(rawUrl: unknown): Promise<ContentFetchResult> {
  if (typeof rawUrl !== 'string' || !isAllowedBilibiliUrl(rawUrl)) {
    return { ok: false, message: '该地址不在允许的 B 站域名范围内' };
  }
  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
    return { ok: true, status: response.status, text: await response.text() };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/** 向后台发送一条消息并解包结果；通道断开时按「未被接收」处理。 */
async function sendToBackground<K extends RequestMessage['type']>(
  message: Extract<RequestMessage, { type: K }>
): Promise<ResponseEnvelope<unknown> | null> {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return (response as ResponseEnvelope<unknown> | undefined) ?? null;
  } catch {
    return null;
  }
}

async function pushFrames(
  videoKey: string,
  frames: CapturedFrame[],
  progress: FrameCaptureProgress | null
): Promise<FramePushResult> {
  const response = await sendToBackground({
    type: 'frames.push',
    payload: { videoKey, frames, progress }
  } as RequestMessage);
  if (!response || !response.ok) return { accepted: false, analyzed: 0 };
  return response.data as FramePushResult;
}

async function reportFinish(
  videoKey: string,
  capture: FrameCaptureSummary | null,
  error: string | null
): Promise<void> {
  await sendToBackground({
    type: 'frames.finish',
    payload: { videoKey, capture, error }
  } as RequestMessage);
}

/** 启动抽帧：同步检查后立刻返回，其余进展通过 frames.push / frames.finish 汇报。 */
function startFrames(message: Extract<ContentRequestMessage, { type: 'content.startFrames' }>): FrameStartResult {
  const { videoKey, options, skipTimes } = message.payload;
  if (typeof videoKey !== 'string' || videoKey.length === 0) {
    return { started: false, reason: 'no-video-key' };
  }
  if (!findMainVideo()) {
    return { started: false, reason: 'no-video' };
  }
  if (capturing) {
    // 已经在跑时不叠加第二条流水线，直接当作已启动（界面上是同一个任务）
    return { started: true };
  }

  capturing = true;
  stopRequested = false;
  void runFrameCapture({
    videoKey,
    options,
    skipTimes: Array.isArray(skipTimes) ? skipTimes : [],
    push: async (batch) => {
      // 后台的 accepted 同时是背压信号：拒收 = 任务已结束（取消或失败），立刻停
      const result = await pushFrames(videoKey, batch.frames, batch.progress);
      if (!result.accepted) stopRequested = true;
      return result.accepted;
    },
    isCancelled: () => stopRequested
  })
    .then(async (outcome) => {
      if (outcome.ok) {
        await reportFinish(videoKey, outcome.summary, null);
        return;
      }
      const errorMap: Record<typeof outcome.reason, string> = {
        'no-video': '页面上没有找到可抽帧的视频元素',
        'not-ready': '视频尚未加载出画面，请先播放几秒再重试',
        cancelled: '已取消抽帧',
        rejected: '后台未接收抽帧结果，任务可能已被取消'
      };
      await reportFinish(videoKey, null, errorMap[outcome.reason]);
    })
    .catch(async (error: unknown) => {
      await reportFinish(videoKey, null, error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      capturing = false;
      stopRequested = false;
    });

  return { started: true };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isContentRequest(message)) return false;

  if (message.type === 'content.collectPageContext') {
    sendResponse(collectPageContext());
    return false;
  }

  if (message.type === 'content.startFrames') {
    sendResponse(startFrames(message));
    return false;
  }

  if (message.type === 'content.stopFrames') {
    // 只置标志位：真正的退出发生在下一个候选点/下一批之前，不做强杀
    stopRequested = true;
    sendResponse({ stopped: true });
    return false;
  }

  if (message.type === 'content.download') {
    sendResponse(downloadFile(message.payload));
    return false;
  }

  if (message.type === 'content.openPanel') {
    void openPanel().then((result) => {
      sendResponse(result);
    });
    return true;
  }

  void fetchJson(message.payload.url).then((result) => {
    sendResponse(result);
  });
  return true;
});

// 页面内入口在 DOM 就绪后挂载；失败不影响内容脚本的取数与上下文能力
try {
  startEntry();
} catch (error) {
  console.warn('[bili-ai-summary] 页面入口挂载失败', error);
}
