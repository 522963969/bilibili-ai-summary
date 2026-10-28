/**
 * 设置数据模型。
 *
 * 设计约束：
 * - 所有字段都必须可序列化为 chrome.storage 能保存的 JSON 值。
 * - API Key 只保存在 chrome.storage.local（不同步、不写入源码、不打印日志）。
 * - 分块参数集中定义，避免在业务代码中散落魔法数字。
 */

export type ThemeMode = 'auto' | 'light' | 'dark';

/** OpenAI 兼容模型配置。 */
export interface ModelSettings {
  /** 形如 https://api.openai.com/v1，不含末尾斜杠。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 0 ~ 2 */
  temperature: number;
  /** 单次请求最大输出 token */
  maxOutputTokens: number;
  /** 单次请求超时时间（毫秒） */
  timeoutMs: number;
}

/** 长视频分块与执行策略。 */
export interface ChunkSettings {
  /** 目标块大小（token） */
  targetTokens: number;
  /** 单块硬上限（token） */
  maxTokens: number;
  /** 相邻块之间的上下文重叠（秒） */
  overlapSeconds: number;
  /** 分块总结并发数 */
  concurrency: number;
  /** 单块失败最大重试次数 */
  maxRetries: number;
}

/**
 * 视觉模型配置（用于「无字幕时按画面识别」）。
 *
 * 与主模型分开的原因：文本模型不一定支持图片输入，
 * 把这个能力混在 `model` 里会让用户在不知情的情况下把图片发到不支持的模型上。
 * `baseUrl` 与 `apiKey` 留空表示沿用主模型连接，`model` 为空表示该能力未启用。
 */
export interface VisionSettings {
  /** 留空则沿用主模型的 Base URL */
  baseUrl: string;
  /** 留空则沿用主模型的 API Key */
  apiKey: string;
  /** 视觉模型名；为空表示未启用画面识别 */
  model: string;
}

/**
 * 抽帧参数。
 *
 * 集中定义的原因与分块参数一致：采样密度直接决定总结完整度与调用成本，
 * 散落在实现里会导致「改了这里忘了那里」。
 */
export interface FrameSettings {
  /** 候选采样频率（帧/秒）。密集采样取 2，即每秒 2 帧 */
  sampleFps: number;
  /** 相邻两个保留帧的最小时间间隔（秒），防止静止画面被大量重复保留 */
  minGapSeconds: number;
  /** 单次任务保留帧数上限，同时也是抽帧耗时的主要约束 */
  maxFrames: number;
  /** 送模型的图片宽度（像素），高度按原始比例缩放 */
  imageWidth: number;
}

/** 界面偏好。 */
export interface GeneralSettings {
  theme: ThemeMode;
}

export interface ExtensionSettings {
  schemaVersion: number;
  model: ModelSettings;
  vision: VisionSettings;
  chunk: ChunkSettings;
  frames: FrameSettings;
  general: GeneralSettings;
  /** 最近一次保存时间，毫秒时间戳；0 表示从未保存过。 */
  updatedAt: number;
}

export interface SettingsPatch {
  model?: Partial<ModelSettings>;
  vision?: Partial<VisionSettings>;
  chunk?: Partial<ChunkSettings>;
  frames?: Partial<FrameSettings>;
  general?: Partial<GeneralSettings>;
}
