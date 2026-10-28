/**
 * 总结任务领域类型。
 * 任务状态使用字符串联合而非枚举，便于直接写入 chrome.storage。
 */

export interface TranscriptChunk {
  /** 从 0 开始 */
  index: number;
  startMs: number;
  endMs: number;
  /** 已带时间戳标记的正文，直接喂给模型 */
  text: string;
  estimatedTokens: number;
  cueCount: number;
}

export interface ChunkPlan {
  chunks: TranscriptChunk[];
  estimatedTotalTokens: number;
  /** 因重叠被重复计入的 cue 数量，用于诊断分块是否过碎 */
  overlappedCues: number;
}

export interface ChunkSummary {
  index: number;
  startMs: number;
  endMs: number;
  summary: string;
}

export interface SummaryChapter {
  title: string;
  startMs: number;
  /** 归并阶段可能拿不到可靠结束时间，允许为 null */
  endMs: number | null;
  points: string[];
}

/**
 * 总结所依据的素材来源。
 *
 * 界面必须能区分「这句话是视频里说过的」还是「画面上看到的」——
 * 两者可信度与遗漏方式完全不同，混在一起会让用户误判总结的可靠程度。
 */
export type SummarySource = 'subtitle' | 'frames';

export const SUMMARY_SOURCE_LABELS: Record<SummarySource, string> = {
  subtitle: '字幕',
  frames: '画面识别'
};

/**
 * 本次总结实际依据的素材身份。
 *
 * 为什么必须随结果一起落盘：`SummaryResult` 里的概述、要点、章节都是模型输出的自由文本，
 * 本身不带任何身份信息。一旦上游（字幕接口 / 分P 映射 / 导入文件）给错了素材，
 * 结果看起来仍然「很像那么回事」，用户只能凭记忆判断它对不对。
 * 把素材的**可核对特征**存进结果，界面就能直接展示「这份总结是依据哪条视频的哪几句话写的」，
 * 让「内容不属于这个视频」变成一眼可见的事实，而不是需要猜测的问题。
 */
export interface SummaryMaterial {
  /** 素材所属视频键，必须与快照的 videoKey 一致 */
  videoKey: string;
  /** 生成时页面上的视频标题，用于人工比对 */
  videoTitle: string | null;
  cueCount: number;
  /** 素材起点（第一条字幕的开始时间） */
  startMs: number;
  /** 素材终点（最后一条字幕的结束时间） */
  endMs: number;
  /** 素材第一句原文，截断到可读长度 */
  firstText: string;
}

export interface SummaryResult {
  overview: string;
  highlights: string[];
  chapters: SummaryChapter[];
  /** 本次总结依据的素材来源 */
  source: SummarySource;
  generatedAt: number;
  model: string | null;
  chunkCount: number;
  cueCount: number;
  /**
   * 素材终点（最后一条字幕的结束时间，毫秒）。
   * 界面用它判断章节是否铺到了结尾；旧快照没有该字段，按「未知」处理。
   */
  materialEndMs?: number;
  /**
   * 素材身份指纹。旧快照没有该字段，界面按「未知」处理。
   * 新版结果一律写入，用于核对「这份总结是不是这个视频的」。
   */
  material?: SummaryMaterial;
  /** 总耗时（毫秒） */
  elapsedMs: number;
}

export type SummaryTaskStatus =
  | 'preparing'
  | 'running'
  | 'merging'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface SummaryTaskSnapshot {
  videoKey: string;
  status: SummaryTaskStatus;
  /** 任务正在使用的素材来源；开始前为 null */
  source: SummarySource | null;
  totalChunks: number;
  doneChunks: number;
  /** 面向用户的进度说明 */
  message: string;
  error: string | null;
  result: SummaryResult | null;
  startedAt: number;
  updatedAt: number;
}

export const SUMMARY_LIMITS = {
  /** 单次归并输入的最大 token，超出则先做二级归并 */
  mergeInputTokens: 12000,
  /** 分块数量上限，防止超长视频导致无限切块 */
  maxChunks: 200,
  /** 单块至少包含的 cue 数，避免重叠导致块过碎 */
  minCuesPerChunk: 3
} as const;

/**
 * 分块摘要缓存。
 *
 * 每块摘要完成即落盘，任务失败后重跑只会补齐缺失的块，不会重复消耗 token。
 * `signature` 由 cue 序列与分块参数推导，不匹配说明字幕或参数已变，整份缓存作废。
 */
export interface ChunkCacheDocument {
  signature: string;
  chunks: ChunkSummary[];
  updatedAt: number;
}
