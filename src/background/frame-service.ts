import { OpenAiVisionProvider } from '@/core/ai/vision-provider';
import type { FrameDescribeResult } from '@/core/ai/vision-provider';
import { AppError } from '@/core/errors/app-error';
import { STORAGE_KEYS } from '@/core/config/defaults';
import type {
  CapturedFrame,
  FrameCaptureProgress,
  FramePushResult,
  FrameScriptDocument,
  FrameScriptEntry
} from '@/core/frames/types';
import { resolveVisionConnection } from '@/core/settings/normalize';
import type { SettingsRepositoryLike } from '@/core/storage/settings-repository';
import type { KeyValueStore } from '@/core/storage/store';
import type { SummaryTaskSnapshot } from '@/core/summary/types';
import { buildFrameCues } from '@/core/frames/parse';
import type { SummaryService, TaskControl } from './summary-service';

/**
 * 画面识别的后台编排。
 *
 * 时序：
 * 1. `start` 建立任务并告诉调用方是否需要真的抽帧（已有完整讲稿就直接复用）
 * 2. `push` 每收到一批帧就调用一次视觉模型，结果累加到讲稿；
 *    返回的 accepted 同时充当背压信号——内容脚本据此决定是否继续抽帧
 * 3. `finish` 落盘讲稿并进入总结阶段
 *
 * 中断恢复策略：讲稿按时间点去重，重跑时只识别尚未解析的帧，
 * 因此失败一次不会让之前已经花掉的模型调用白费。
 */

export interface FrameServiceDeps {
  settings: SettingsRepositoryLike;
  summary: SummaryService;
  store: KeyValueStore;
  /**
   * 视觉模型工厂。默认就是真实的 `OpenAiVisionProvider`，
   * 单独抽出来是为了让「模型只回空内容」这类分支能被单元测试覆盖——
   * 否则要复现它就得真的有一台不看图的模型，而这恰恰是最常见的故障。
   */
  createVisionProvider?: (connection: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
  }) => FrameVisionProvider;
}

/** 只声明用到的那一个方法，避免测试里伪造整个 Provider。 */
export interface FrameVisionProvider {
  describeFrames(
    frames: CapturedFrame[],
    context: { videoTitle: string | null; startIndex: number },
    options: { temperature: number; maxTokens: number }
  ): Promise<FrameDescribeResult>;
}

interface FrameTask {
  control: TaskControl;
  videoTitle: string | null;
  entries: FrameScriptEntry[];
  /** 已解析过的时间点，用于断点去重 */
  seenTimes: Set<number>;
  nextIndex: number;
  model: string | null;
  durationMs: number;
  /** 本批累计跳过的帧数（模型没给出对应描述） */
  skippedFrames: number;
  /** 累计送去识别的帧数 */
  sentFrames: number;
  /** 连续多少批「一张都没解析出描述」 */
  emptyStreak: number;
}

export interface FrameStartOutcome {
  snapshot: SummaryTaskSnapshot;
  /** 是否需要通知页面侧抽帧 */
  needsCapture: boolean;
  /** 复用了已有讲稿（不需要再花抽帧时间） */
  reusedScript: boolean;
  /** 需要通知页面跳过的时间点（已识别过的帧，不重复抽、不重复花钱） */
  skipTimes: number[];
}

function isRunningStatus(status: SummaryTaskSnapshot['status'] | undefined): boolean {
  return status === 'preparing' || status === 'running' || status === 'merging';
}

export class FrameService {
  private readonly tasks = new Map<string, FrameTask>();

  constructor(private readonly deps: FrameServiceDeps) {}

  /**
   * 开始（或继续）一次画面识别。
   *
   * @param force 为 true 时忽略已有讲稿，强制重新抽帧
   */
  async start(
    videoKey: string,
    videoTitle: string | null,
    force: boolean
  ): Promise<FrameStartOutcome> {
    const existing = await this.deps.summary.get(videoKey);
    if (existing && isRunningStatus(existing.status)) {
      return { snapshot: existing, needsCapture: false, reusedScript: false, skipTimes: [] };
    }

    const { visionConfigured } = await this.deps.settings.read();
    if (!visionConfigured) {
      throw new AppError('E_SETTINGS_INVALID', {
        message: '尚未配置视觉模型。请在设置页填写一个支持图片输入的模型名称后再使用画面识别'
      });
    }

    const cached = force ? null : await this.readScript(videoKey);
    const entries = cached?.entries ?? [];
    const seenTimes = new Set(entries.map((entry) => entry.tMs));

    const control = await this.deps.summary.begin(
      videoKey,
      'frames',
      cached && cached.complete ? '复用已识别的画面讲稿' : '正在抽取画面'
    );

    const task: FrameTask = {
      control,
      videoTitle,
      entries: [...entries],
      seenTimes,
      nextIndex: 1,
      model: cached?.model ?? null,
      durationMs: cached?.durationMs ?? 0,
      skippedFrames: 0,
      sentFrames: 0,
      emptyStreak: 0
    };

    // 讲稿已完整时不再抽帧，直接进入总结，省掉数十秒
    if (cached && cached.complete && entries.length > 0) {
      void this.deps.summary.launch(
        { videoKey, cues: buildFrameCues(entries, cached.durationMs), source: 'frames' },
        videoTitle,
        control
      );
      const launched = await this.deps.summary.get(videoKey);
      if (!launched) throw new AppError('E_INTERNAL', { message: '任务快照读取失败' });
      return { snapshot: launched, needsCapture: false, reusedScript: true, skipTimes: [] };
    }

    this.tasks.set(videoKey, task);
    // 断点续跑：把已解析的条目先写回快照，界面上能立刻看到已有进度
    const patched = await this.deps.summary.patch(videoKey, {
      message:
        entries.length > 0
          ? `正在抽取画面（已有 ${entries.length} 条画面描述将复用）`
          : '正在抽取画面'
    });
    const snapshot = patched ?? (await this.deps.summary.get(videoKey));
    if (!snapshot) throw new AppError('E_INTERNAL', { message: '任务快照写入失败' });

    return { snapshot, needsCapture: true, reusedScript: false, skipTimes: [...seenTimes] };
  }

  /** 处理一批帧：调用视觉模型并把描述累加到讲稿。 */
  async push(
    videoKey: string,
    frames: CapturedFrame[],
    progress: FrameCaptureProgress | null
  ): Promise<FramePushResult> {
    const task = this.tasks.get(videoKey);
    if (!task) return { accepted: false, analyzed: 0 };
    if (task.control.cancelled) return { accepted: false, analyzed: task.entries.length };

    if (frames.length === 0) {
      if (progress) await this.reportProgress(videoKey, task, progress);
      return { accepted: true, analyzed: task.entries.length };
    }

    // 断点去重：只识别尚未解析过的时间点
    const fresh = frames.filter((frame) => !task.seenTimes.has(frame.tMs));
    if (fresh.length === 0) {
      if (progress) await this.reportProgress(videoKey, task, progress);
      return { accepted: true, analyzed: task.entries.length };
    }

    const { settings } = await this.deps.settings.read();
    const connection = resolveVisionConnection(settings);
    if (!connection) {
      throw new AppError('E_SETTINGS_INVALID', {
        message: '视觉模型配置已失效，请到设置页重新检查后重试'
      });
    }

    const provider = this.createProvider(connection, settings.model.timeoutMs);

    const attempts = Math.max(1, settings.chunk.maxRetries + 1);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (task.control.cancelled) return { accepted: false, analyzed: task.entries.length };
      try {
        const result = await provider.describeFrames(
          fresh,
          { videoTitle: task.videoTitle, startIndex: task.nextIndex },
          { temperature: Math.min(settings.model.temperature, 0.3), maxTokens: 900 }
        );

        // 标记为已解析，避免重跑时重复调用（即使本批没解析出内容也算处理过）
        for (const frame of fresh) task.seenTimes.add(frame.tMs);
        task.nextIndex += fresh.length;
        task.sentFrames += fresh.length;
        task.model = result.model ?? task.model;
        task.entries.push(...result.entries);
        task.entries.sort((a, b) => a.tMs - b.tMs);

        if (result.entries.length === 0) {
          task.skippedFrames += fresh.length;
          task.emptyStreak += 1;
          /*
           * 关键分支：一帧都没描述出来时，**不能继续把整段视频抽完**。
           *
           * 这里的两种情形都必须立刻停：
           * - 模型返回空串：它根本没看图（图片部分被中转站丢弃是常见现象），
           *   继续抽剩下的帧只会把同一件事重复 N 遍，最后一无所获；
           * - 连续两批都解析不出：格式不对，不是靠多抽几帧能救的。
           * 用户看到的就是「跑完整段视频还是没有任何产出」，所以在这里就断掉。
           *
           * 但「已经有描述、偶尔一批空」不算：此时停下来反而浪费已花掉的调用，
           * 让流程走完、用它已有的部分生成总结更有价值。
           */
          const nothingYet = task.entries.length === 0;
          const emptyReply = result.rawText.trim().length === 0;
          if (nothingYet && (emptyReply || task.emptyStreak >= 2)) {
            return await this.failEmptyOutput(videoKey, task, result);
          }
        } else {
          task.emptyStreak = 0;
        }

        await this.deps.summary.patch(videoKey, {
          message: `已识别 ${task.entries.length} 条画面描述（共看过 ${task.sentFrames} 帧）`
        });
        return { accepted: true, analyzed: task.entries.length };
      } catch (error) {
        lastError = error;
        const appError = AppError.from(error);
        if (appError.code === 'E_TASK_CANCELLED') {
          return { accepted: false, analyzed: task.entries.length };
        }
        if (!appError.retryable || attempt >= attempts) break;
      }
    }

    const appError = AppError.from(lastError ?? new AppError('E_INTERNAL'));
    // 先保住已经识别出来的部分，再让任务失败
    await this.saveScript(videoKey, task, false);
    await this.deps.summary.patch(videoKey, {
      status: 'failed',
      message: '画面识别失败',
      error: `画面识别失败：${appError.message}（已识别的 ${task.entries.length} 条会保留，重试时无需重新识别）`
    });
    this.tasks.delete(videoKey);
    return { accepted: false, analyzed: task.entries.length };
  }

  /** 抽帧结束：落盘讲稿并进入总结阶段。 */
  async finish(
    videoKey: string,
    capture: { keptFrames: number; sampledPoints: number; durationMs: number; elapsedMs: number } | null,
    error: string | null
  ): Promise<{ accepted: boolean }> {
    const task = this.tasks.get(videoKey);
    if (!task) return { accepted: false };

    if (task.control.cancelled) {
      // 用户主动取消：保留已识别部分，下次继续
      await this.saveScript(videoKey, task, false);
      this.tasks.delete(videoKey);
      return { accepted: false };
    }

    if (error) {
      await this.saveScript(videoKey, task, false);
      await this.deps.summary.patch(videoKey, {
        status: 'failed',
        message: '抽帧失败',
        error
      });
      this.tasks.delete(videoKey);
      return { accepted: false };
    }

    if (capture) task.durationMs = capture.durationMs;

    if (task.entries.length === 0) {
      await this.deps.summary.patch(videoKey, {
        status: 'failed',
        message: '未识别到有效画面',
        error:
          task.skippedFrames > 0
            ? `抽帧成功但模型没有返回可用的画面描述（${task.skippedFrames} 帧无描述）。请确认所选模型支持图片输入`
            : '没有抽到可用于识别的画面，请确认视频已加载出画面后重试'
      });
      this.tasks.delete(videoKey);
      return { accepted: false };
    }

    await this.saveScript(videoKey, task, true);
    const cues = buildFrameCues(task.entries, task.durationMs);
    this.tasks.delete(videoKey);
    await this.deps.summary.launch({ videoKey, cues, source: 'frames' }, task.videoTitle, task.control);
    return { accepted: true };
  }

  async getScript(videoKey: string): Promise<FrameScriptDocument | null> {
    return this.readScript(videoKey);
  }

  async clearScript(videoKey: string): Promise<{ cleared: boolean }> {
    try {
      await this.deps.store.remove(this.scriptKey(videoKey));
      return { cleared: true };
    } catch {
      return { cleared: false };
    }
  }

  private async reportProgress(
    videoKey: string,
    task: FrameTask,
    progress: FrameCaptureProgress
  ): Promise<void> {
    /*
     * 进度必须带分母。
     *
     * 只有「已采样 N 点」时，N 一直涨却不知道要涨到多少，
     * 用户会以为在死循环——这正是「重复提取、没有产出」这种反馈的来源之一。
     */
    const message =
      progress.phase === 'selecting'
        ? progress.totalSlots > 0
          ? `正在挑选画面：已完成 ${progress.doneSlots}/${progress.totalSlots} 段，保留 ${progress.keptFrames} 帧`
          : `正在挑选画面：已采样 ${progress.sampledPoints} 点，保留 ${progress.keptFrames} 帧`
        : `正在识别画面：已看 ${task.sentFrames} 帧，得到 ${task.entries.length} 条描述`;
    await this.deps.summary.patch(videoKey, { message });
  }

  /** 视觉模型给不出任何可用描述：立刻失败，并把模型的原始返回原样带出来。 */
  private async failEmptyOutput(
    videoKey: string,
    task: FrameTask,
    result: FrameDescribeResult
  ): Promise<FramePushResult> {
    const model = result.model ?? task.model ?? '当前视觉模型';
    const reason =
      result.rawText.trim().length === 0
        ? `视觉模型「${model}」看了 ${task.sentFrames} 帧画面，一个字都没有返回——它很可能不支持图片输入（只吃文字）。请到设置页把「视觉模型」换成能看图的模型（例如 qwen3.5-flash、gpt-4o）后重试。`
        : `视觉模型「${model}」返回了内容，但 ${task.sentFrames} 帧里没有一条能对上画面编号，拿不到可用的画面描述。它这一批的原始返回是：${shorten(result.rawText)}`;

    // 已识别到的部分先保住，重试时不用重新识别
    await this.saveScript(videoKey, task, false);
    await this.deps.summary.patch(videoKey, {
      status: 'failed',
      message: '画面识别没有拿到可用描述',
      error: reason
    });
    this.tasks.delete(videoKey);
    return { accepted: false, analyzed: task.entries.length };
  }

  private createProvider(
    connection: { baseUrl: string; apiKey: string; model: string },
    timeoutMs: number
  ): FrameVisionProvider {
    const factory = this.deps.createVisionProvider;
    if (factory) return factory({ ...connection, timeoutMs });
    return new OpenAiVisionProvider({ ...connection, timeoutMs });
  }

  private scriptKey(videoKey: string): string {
    return `${STORAGE_KEYS.frameScriptPrefix}${videoKey}`;
  }

  private async readScript(videoKey: string): Promise<FrameScriptDocument | null> {
    const doc = await this.deps.store.get<FrameScriptDocument>(this.scriptKey(videoKey));
    if (!doc || !Array.isArray(doc.entries)) return null;
    return doc;
  }

  private async saveScript(videoKey: string, task: FrameTask, complete: boolean): Promise<void> {
    const doc: FrameScriptDocument = {
      videoKey,
      entries: task.entries,
      frameCount: task.entries.length,
      durationMs: task.durationMs,
      complete,
      model: task.model,
      createdAt: Date.now()
    };
    try {
      await this.deps.store.set(this.scriptKey(videoKey), doc);
    } catch {
      // 讲稿写入失败只影响断点续跑，不影响本次结论
    }
  }
}

/** 把模型原始返回压成一行，写进错误信息里供用户判断格式问题。 */
function shorten(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}
