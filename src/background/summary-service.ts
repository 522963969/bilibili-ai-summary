import { OpenAiCompatibleProvider } from '@/core/ai/openai-provider';
import { STORAGE_KEYS } from '@/core/config/defaults';
import { AppError } from '@/core/errors/app-error';
import type { SettingsRepositoryLike } from '@/core/storage/settings-repository';
import type { KeyValueStore } from '@/core/storage/store';
import type { SubtitleRepository } from '@/core/storage/subtitle-repository';
import type { SubtitleCue } from '@/core/subtitle/types';
import { buildCueSignature } from '@/core/summary/chunk-planner';
import { runSummary } from '@/core/summary/orchestrator';
import type { SummaryProgress } from '@/core/summary/orchestrator';
import type {
  ChunkCacheDocument,
  ChunkSummary,
  SummarySource,
  SummaryTaskSnapshot
} from '@/core/summary/types';

/** 任务在 SW 中被中断后，超过该时长仍为运行态即视为已失效。 */
const STALE_TASK_MS = 5 * 60 * 1000;

/** 任务控制句柄。抽帧路径需要在总结开始前就拿到它，以便中途取消。 */
export interface TaskControl {
  cancelled: boolean;
}

/** 一次总结所依据的素材。字幕与画面讲稿都收敛成这个形状，从而共用同一条管线。 */
export interface SourceMaterial {
  videoKey: string;
  cues: SubtitleCue[];
  source: SummarySource;
}

/** 对任务快照的局部更新，用于抽帧阶段持续汇报进度。 */
export interface TaskPatch {
  status?: SummaryTaskSnapshot['status'];
  source?: SummarySource;
  totalChunks?: number;
  doneChunks?: number;
  message?: string;
  error?: string | null;
}

export interface SummaryServiceDeps {
  settings: SettingsRepositoryLike;
  subtitles: SubtitleRepository;
  store: KeyValueStore;
}

function isRunningStatus(status: SummaryTaskSnapshot['status'] | undefined): boolean {
  return status === 'preparing' || status === 'running' || status === 'merging';
}

/**
 * 总结任务编排。
 *
 * 任务状态持久化在 chrome.storage 中，Service Worker 被回收后仍能读到进度。
 * 消息只负责「启动」并立刻返回快照，实际执行为后台异步流程，
 * 面板通过 summary.get 轮询进度，避免长任务把消息通道拖到超时。
 *
 * 任务被拆成两个阶段供不同来源复用：
 * - `begin` 建立快照与控制句柄（画面识别在抽帧阶段就要有可取消的任务）
 * - `launch` 拿到素材后跑分块与归并
 * 字幕路径由 `start` 一步完成这两步。
 */
export class SummaryService {
  private readonly active = new Map<string, TaskControl>();

  constructor(private readonly deps: SummaryServiceDeps) {}

  /** 字幕路径：读取已缓存的字幕并立即开始总结。 */
  async start(videoKey: string, videoTitle: string | null): Promise<SummaryTaskSnapshot> {
    const existing = await this.get(videoKey);
    if (existing && isRunningStatus(existing.status)) return existing;

    const subtitle = await this.deps.subtitles.read(videoKey);
    if (!subtitle || subtitle.cues.length === 0) {
      throw new AppError('E_SUBTITLE_UNAVAILABLE', {
        message: '请先获取或导入字幕，再开始总结'
      });
    }

    const control = await this.begin(videoKey, 'subtitle', '正在准备字幕分块');
    void this.launch(
      { videoKey, cues: subtitle.cues, source: 'subtitle' },
      videoTitle,
      control
    );
    return (await this.get(videoKey)) ?? this.blankSnapshot(videoKey, 'subtitle', '正在准备字幕分块');
  }

  /**
   * 建立任务快照并返回控制句柄，但不立刻执行管线。
   * 调用方负责后续调用 `launch` 或把任务标记为失败。
   */
  async begin(
    videoKey: string,
    source: SummarySource,
    message: string
  ): Promise<TaskControl> {
    const control: TaskControl = { cancelled: false };
    this.active.set(videoKey, control);

    const now = Date.now();
    const snapshot: SummaryTaskSnapshot = {
      videoKey,
      status: 'preparing',
      source,
      totalChunks: 0,
      doneChunks: 0,
      message,
      error: null,
      result: null,
      startedAt: now,
      updatedAt: now
    };
    await this.save(snapshot);
    return control;
  }

  /** 局部更新任务快照。抽帧阶段用它持续汇报「已识别 N 帧」。 */
  async patch(videoKey: string, patch: TaskPatch): Promise<SummaryTaskSnapshot | null> {
    const current = await this.get(videoKey);
    if (!current) return null;
    const next: SummaryTaskSnapshot = {
      ...current,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.totalChunks !== undefined ? { totalChunks: patch.totalChunks } : {}),
      ...(patch.doneChunks !== undefined ? { doneChunks: patch.doneChunks } : {}),
      ...(patch.message !== undefined ? { message: patch.message } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      updatedAt: Date.now()
    };
    await this.save(next);
    // 抽帧阶段由 FrameService 直接写终态，这里同步释放控制句柄，
    // 否则 active 会一直留着该 key，使「任务已中断」的失效判定失效。
    if (next.status === 'failed' || next.status === 'cancelled' || next.status === 'done') {
      this.active.delete(videoKey);
    }
    return next;
  }

  /** 拿到素材后执行分块与归并。调用方需先通过 `begin` 获得控制句柄。 */
  async launch(
    material: SourceMaterial,
    videoTitle: string | null,
    control: TaskControl
  ): Promise<void> {
    await this.execute(material, videoTitle, control);
  }

  /** 判断某个视频是否还有任务在本进程内执行。 */
  isActive(videoKey: string): boolean {
    return this.active.has(videoKey);
  }

  async get(videoKey: string): Promise<SummaryTaskSnapshot | null> {
    const stored = await this.deps.store.get<SummaryTaskSnapshot>(
      `${STORAGE_KEYS.summaryPrefix}${videoKey}`
    );
    if (!stored) return null;
    // 后台被回收导致状态卡在运行态时，按失效处理而不是让界面一直转圈
    if (
      isRunningStatus(stored.status) &&
      Date.now() - stored.updatedAt > STALE_TASK_MS &&
      !this.active.has(videoKey)
    ) {
      const stale: SummaryTaskSnapshot = {
        ...stored,
        status: 'failed',
        message: '任务已中断',
        error: '扩展后台在任务执行期间被浏览器回收，请重新开始总结',
        updatedAt: Date.now()
      };
      await this.save(stale);
      return stale;
    }
    return stored;
  }

  async cancel(videoKey: string): Promise<{ cancelled: boolean }> {
    const control = this.active.get(videoKey);
    if (control) control.cancelled = true;
    const current = await this.get(videoKey);
    if (current && isRunningStatus(current.status)) {
      await this.save({
        ...current,
        status: 'cancelled',
        message: '已取消',
        error: null,
        updatedAt: Date.now()
      });
      return { cancelled: true };
    }
    return { cancelled: Boolean(control) };
  }

  private blankSnapshot(
    videoKey: string,
    source: SummarySource,
    message: string
  ): SummaryTaskSnapshot {
    const now = Date.now();
    return {
      videoKey,
      status: 'preparing',
      source,
      totalChunks: 0,
      doneChunks: 0,
      message,
      error: null,
      result: null,
      startedAt: now,
      updatedAt: now
    };
  }

  private async execute(
    material: SourceMaterial,
    videoTitle: string | null,
    control: TaskControl
  ): Promise<void> {
    const { videoKey, cues, source } = material;
    let lastWriteAt = 0;
    let snapshot: SummaryTaskSnapshot = {
      videoKey,
      status: 'running',
      source,
      totalChunks: 0,
      doneChunks: 0,
      message: '正在生成分段摘要',
      error: null,
      result: null,
      startedAt: Date.now(),
      updatedAt: Date.now()
    };

    const flush = async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastWriteAt < 350) return;
      lastWriteAt = now;
      snapshot = { ...snapshot, updatedAt: now };
      await this.save(snapshot);
    };

    const applyProgress = (progress: SummaryProgress): void => {
      if (control.cancelled) return;
      snapshot = {
        ...snapshot,
        status: progress.status ?? snapshot.status,
        doneChunks: progress.doneChunks ?? snapshot.doneChunks,
        totalChunks: progress.totalChunks ?? snapshot.totalChunks,
        message: progress.message ?? snapshot.message
      };
      void flush();
    };

    // 分块缓存的写入句柄放在 try 之外，失败分支才能补写最后一次节流遗漏的块
    let flushChunks: (force?: boolean) => Promise<void> = async () => {};

    try {
      const { settings, modelConfigured } = await this.deps.settings.read();
      if (!modelConfigured) {
        throw new AppError('E_SETTINGS_INVALID', {
          message: '请先在设置页填写 Base URL、API Key 与模型名称'
        });
      }

      // 断点续跑：只复用指纹一致的分块摘要，缺多少补多少
      const planOptions = {
        targetTokens: settings.chunk.targetTokens,
        maxTokens: settings.chunk.maxTokens,
        overlapSeconds: settings.chunk.overlapSeconds
      };
      const signature = buildCueSignature(cues, planOptions);
      const cachedChunks = await this.readChunkCache(videoKey, signature);

      const completed: ChunkSummary[] = [...cachedChunks];
      let lastChunkWriteAt = 0;
      flushChunks = async (force = false): Promise<void> => {
        const now = Date.now();
        if (!force && now - lastChunkWriteAt < 500) return;
        lastChunkWriteAt = now;
        const doc: ChunkCacheDocument = { signature, chunks: completed, updatedAt: now };
        await this.deps.store.set(this.chunkKey(videoKey), doc);
      };

      const provider = new OpenAiCompatibleProvider(settings);
      const result = await runSummary({
        settings,
        provider,
        videoTitle,
        videoKey,
        cues,
        source,
        cachedChunks,
        onChunkDone: (chunk) => {
          const existing = completed.findIndex((item) => item.index === chunk.index);
          if (existing >= 0) completed[existing] = chunk;
          else completed.push(chunk);
          void flushChunks();
        },
        isCancelled: () => control.cancelled,
        onProgress: applyProgress
      });

      snapshot = {
        ...snapshot,
        status: 'done',
        doneChunks: result.chunkCount,
        totalChunks: result.chunkCount,
        message: `总结完成，共 ${result.chunkCount} 段`,
        result,
        error: null
      };
      await flush(true);
      // 归并结果已完整保存，分块缓存没有保留价值
      await this.clearChunkCache(videoKey);
    } catch (error) {
      const appError = AppError.from(error);
      if (appError.code === 'E_TASK_CANCELLED' || control.cancelled) {
        snapshot = { ...snapshot, status: 'cancelled', message: '已取消', error: null };
      } else {
        snapshot = {
          ...snapshot,
          status: 'failed',
          message: '总结失败',
          error: appError.message
        };
      }
      // 失败时保留已完成的分块，重试时无需重新消耗这部分 token
      try {
        await flushChunks(true);
      } catch {
        // 断点数据丢失只会让下次重跑变慢，不改变任务结论
      }
      await flush(true);
    } finally {
      this.active.delete(videoKey);
    }
  }

  private chunkKey(videoKey: string): string {
    return `${STORAGE_KEYS.summaryChunkPrefix}${videoKey}`;
  }

  private async readChunkCache(videoKey: string, signature: string): Promise<ChunkSummary[]> {
    const doc = await this.deps.store.get<ChunkCacheDocument>(this.chunkKey(videoKey));
    if (!doc || doc.signature !== signature) return [];
    return doc.chunks.filter(
      (item) => item && typeof item.summary === 'string' && item.summary.length > 0
    );
  }

  private async clearChunkCache(videoKey: string): Promise<void> {
    try {
      await this.deps.store.remove(this.chunkKey(videoKey));
    } catch {
      // 清理失败不影响已完成的总结
    }
  }

  private async save(snapshot: SummaryTaskSnapshot): Promise<void> {
    await this.deps.store.set(`${STORAGE_KEYS.summaryPrefix}${snapshot.videoKey}`, snapshot);
  }
}
