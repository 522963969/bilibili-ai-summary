/**
 * 画面抽帧领域类型。
 *
 * 抽帧发生在内容脚本（能直接访问页面里的 `<video>`），
 * 识别与总结发生在 Service Worker（API Key 不进入页面上下文）。
 * 这里定义两者之间的数据形状，避免任一侧自行发明字段。
 */

/** 一帧已编码的画面。dataUrl 形如 `data:image/jpeg;base64,...`。 */
export interface CapturedFrame {
  /** 该帧在视频中的时间位置（毫秒），用于回溯到真实片段 */
  tMs: number;
  dataUrl: string;
  width: number;
  height: number;
}

/** 帧差签名，用于判断两帧画面是否「讲的是同一件事」。 */
export interface GraySignature {
  /** 行优先的灰度值，长度 = signatureWidth * signatureHeight */
  values: number[];
  width: number;
  height: number;
}

export interface FrameSelectOptions {
  /** 候选采样频率（帧/秒） */
  sampleFps: number;
  /** 相邻两个保留帧的最小间隔（秒），视频过长时会自动放宽 */
  minGapSeconds: number;
  /** 保留帧数上限 */
  maxFrames: number;
  /** 送模型的图片宽度 */
  imageWidth: number;
}

/** 抽帧参数上限，集中定义避免魔法数字散落。 */
export const FRAME_LIMITS = {
  /** 帧差签名的分辨率：32x18 足以区分镜头变化，且计算量可忽略 */
  signatureWidth: 32,
  signatureHeight: 18,
  /** JPEG 质量。实测 512 宽 + 0.6 时单帧约 13~18 KB */
  jpegQuality: 0.6,
  /** 单次送模型的帧数，过大容易超出上下文且不利于定位时间点 */
  batchSize: 6,
  /**
   * 帧差阈值（32x18 灰度平均绝对差）。
   * 实测同一镜头内相邻 0.5 秒约 1~5，切镜/大幅运动约 15~60，
   * 取 8 可以把「静止画面」挡掉而保留真实的画面变化。
   */
  changeThreshold: 8,
  /**
   * 候选采样预算系数：总候选数 = maxFrames * 该值。
   * 每次 seek 约 80ms，预算决定了抽帧总耗时，因此必须封顶。
   */
  samplesPerFrameBudget: 2,
  /** 单条画面描述的长度上限，防止模型输出长段落撑爆分块 */
  maxEntryChars: 160
} as const;

export interface FrameCaptureSummary {
  videoKey: string;
  /** 本次实际送识别的帧数（不含续跑时跳过的那部分） */
  keptFrames: number;
  /** 探索过的候选点数，用于说明「抽了多少、留了多少」 */
  sampledPoints: number;
  durationMs: number;
  elapsedMs: number;
  /** 因为上次已识别而跳过的帧数，用于向用户解释「这次为什么更快」 */
  reusedFrames: number;
}

/** 抽帧进度，经 frames.push 上报给后台并写入任务快照。 */
export interface FrameCaptureProgress {
  phase: 'selecting' | 'encoding';
  sampledPoints: number;
  keptFrames: number;
  totalSlots: number;
  doneSlots: number;
}

/**
 * 启动抽帧的结果。
 *
 * 抽帧本身是长任务，这里只做「能不能开始」的同步判断并立刻返回，
 * 真正结果通过 frames.push / frames.finish 反向汇报，避免消息通道超时。
 */
export type FrameStartResult =
  | { started: true }
  | { started: false; reason: 'no-video' | 'no-video-key' };

/** 一批帧被后台接收的结果；accepted 为 false 表示应停止继续抽帧。 */
export interface FramePushResult {
  accepted: boolean;
  /** 已被识别累计的帧数，用于界面显示「已识别 N 帧」 */
  analyzed: number;
}

/** 画面讲稿中的一条：某个时间点的画面描述。 */
export interface FrameScriptEntry {
  tMs: number;
  text: string;
}

/**
 * 画面讲稿文档。
 *
 * 它是「抽帧识别的产物」，与字幕结构对齐（时间点 + 文本），
 * 因此可以直接复用分块与总结管线，不需要第二套提示词体系。
 *
 * `complete` 用于断点续跑：中断的讲稿会保留下来，
 * 重新开始时按时间点去重，只识别尚未解析的帧，不重复消耗模型调用。
 */
export interface FrameScriptDocument {
  videoKey: string;
  entries: FrameScriptEntry[];
  frameCount: number;
  /** 抽帧时记录的视频时长，用于给最后一条画面描述补齐区间 */
  durationMs: number;
  /** 抽帧与识别是否完整走完 */
  complete: boolean;
  model: string | null;
  createdAt: number;
}
