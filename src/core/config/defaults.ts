import type { ExtensionSettings } from '@/core/settings/types';

export const SETTINGS_SCHEMA_VERSION = 2;

/** 设置取值范围，同时作为 UI 控件与规范化逻辑的唯一来源。 */
export const SETTINGS_LIMITS = {
  temperature: { min: 0, max: 2, step: 0.1 },
  maxOutputTokens: { min: 256, max: 32000, step: 128 },
  timeoutMs: { min: 5000, max: 300000, step: 1000 },
  targetTokens: { min: 500, max: 60000, step: 500 },
  maxTokens: { min: 1000, max: 64000, step: 500 },
  overlapSeconds: { min: 0, max: 120, step: 5 },
  concurrency: { min: 1, max: 6, step: 1 },
  maxRetries: { min: 0, max: 6, step: 1 },
  sampleFps: { min: 0.5, max: 4, step: 0.5 },
  minGapSeconds: { min: 1, max: 60, step: 1 },
  maxFrames: { min: 20, max: 600, step: 10 },
  imageWidth: { min: 256, max: 1280, step: 64 }
} as const;

/**
 * 默认值。
 * 分块参数的初始取值来自需求约定：目标 6000 tokens、上限 8000 tokens、
 * 重叠 30 秒（落在 20~40 秒区间内）、并发 2、最大重试 3。
 *
 * 抽帧默认取「密集采样」：每秒 2 帧作为候选，保留间隔 3 秒。
 * 实测 B 站视频 seek 一次约 80ms，200 帧上限对应约 16 秒抽帧耗时。
 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  model: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxOutputTokens: 3000,
    timeoutMs: 120000
  },
  vision: {
    baseUrl: '',
    apiKey: '',
    model: ''
  },
  chunk: {
    targetTokens: 6000,
    maxTokens: 8000,
    overlapSeconds: 30,
    concurrency: 2,
    maxRetries: 3
  },
  frames: {
    sampleFps: 2,
    minGapSeconds: 3,
    maxFrames: 200,
    imageWidth: 512
  },
  general: {
    theme: 'auto'
  },
  updatedAt: 0
};

/** 存储键。集中管理，避免字符串散落。 */
export const STORAGE_KEYS = {
  settings: 'settings/v1',
  /** 字幕按视频键存储，键名形如 subtitle/v1/BV1xx411c7mD#p2 */
  subtitlePrefix: 'subtitle/v1/',
  /** 总结任务与结果，键名形如 summary/v1/BV1xx411c7mD#p2 */
  summaryPrefix: 'summary/v1/',
  /** 分块摘要缓存（断点续跑），键名形如 summary-chunk/v1/BV1xx411c7mD#p2 */
  summaryChunkPrefix: 'summary-chunk/v1/',
  /** 画面讲稿（抽帧识别产物），键名形如 framescript/v1/BV1xx411c7mD#p2 */
  frameScriptPrefix: 'framescript/v1/'
} as const;
