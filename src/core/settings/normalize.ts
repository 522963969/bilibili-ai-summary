import { DEFAULT_SETTINGS, SETTINGS_LIMITS, SETTINGS_SCHEMA_VERSION } from '@/core/config/defaults';
import type {
  ChunkSettings,
  ExtensionSettings,
  FrameSettings,
  GeneralSettings,
  ModelSettings,
  ThemeMode,
  VisionSettings
} from './types';

export interface NormalizeResult {
  settings: ExtensionSettings;
  /** 规范化过程中被修正的字段说明，用于界面提示。 */
  issues: string[];
}

const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sectionOf(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  return isRecord(value) ? value : {};
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * @param format 数值在提示语里的呈现方式。默认直接写数字；
 *   存储在毫秒、界面用秒的字段可以传自定义格式化，避免提示里冒出 120000 这种原始量纲。
 */
function pickNumber(
  value: unknown,
  fallback: number,
  range: { min: number; max: number },
  label: string,
  issues: string[],
  integer = false,
  format: (value: number) => string = (value) => String(value)
): number {
  let parsed: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    parsed = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    parsed = Number.isFinite(numeric) ? numeric : null;
  }
  if (parsed === null) {
    if (value !== undefined && value !== null && value !== '') {
      issues.push(`${label} 不是有效数字，已回退为默认值`);
    }
    return fallback;
  }
  const rounded = integer ? Math.round(parsed) : parsed;
  if (rounded < range.min) {
    issues.push(`${label} 低于下限 ${format(range.min)}，已调整`);
    return range.min;
  }
  if (rounded > range.max) {
    issues.push(`${label} 高于上限 ${format(range.max)}，已调整`);
    return range.max;
  }
  return rounded;
}

/**
 * 规范化 Base URL：
 * - 仅接受 http/https
 * - 去掉末尾斜杠、查询串与 hash，避免拼接出错误路径
 */
export function normalizeBaseUrl(raw: string): { value: string; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { value: '', error: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { value: '', error: 'Base URL 不是合法地址' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { value: '', error: 'Base URL 仅支持 http 或 https' };
  }
  if (parsed.username || parsed.password) {
    return { value: '', error: 'Base URL 不能包含用户名或密码' };
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  return { value: `${parsed.origin}${path}`, error: null };
}

/** 将任意来源（存储、表单、旧版本）的数据收敛为合法设置对象。 */
export function normalizeSettings(input: unknown): NormalizeResult {
  const issues: string[] = [];
  const root = isRecord(input) ? input : {};
  const modelInput = sectionOf(root, 'model');
  const visionInput = sectionOf(root, 'vision');
  const chunkInput = sectionOf(root, 'chunk');
  const framesInput = sectionOf(root, 'frames');
  const generalInput = sectionOf(root, 'general');

  const rawBaseUrl = modelInput.baseUrl;
  const baseUrlResult =
    typeof rawBaseUrl === 'string'
      ? normalizeBaseUrl(rawBaseUrl)
      : { value: DEFAULT_SETTINGS.model.baseUrl, error: null };
  if (baseUrlResult.error) {
    issues.push(`${baseUrlResult.error}，模型服务地址已清空`);
  }

  const model: ModelSettings = {
    baseUrl: baseUrlResult.value,
    apiKey: pickString(modelInput.apiKey, ''),
    model: pickString(modelInput.model, DEFAULT_SETTINGS.model.model),
    temperature: Number(
      pickNumber(
        modelInput.temperature,
        DEFAULT_SETTINGS.model.temperature,
        SETTINGS_LIMITS.temperature,
        '回答灵活程度',
        issues
      ).toFixed(2)
    ),
    maxOutputTokens: pickNumber(
      modelInput.maxOutputTokens,
      DEFAULT_SETTINGS.model.maxOutputTokens,
      SETTINGS_LIMITS.maxOutputTokens,
      '单次回答长度上限',
      issues,
      true
    ),
    timeoutMs: pickNumber(
      modelInput.timeoutMs,
      DEFAULT_SETTINGS.model.timeoutMs,
      SETTINGS_LIMITS.timeoutMs,
      '等待回复的最长时间',
      issues,
      true,
      // 界面按秒展示，提示语也跟着用秒，避免用户看到 5000 / 300000 这种毫秒值
      (ms) => `${ms / 1000} 秒`
    )
  };

  const visionBaseUrl = pickString(visionInput.baseUrl, '');
  let visionBaseUrlValue = '';
  if (visionBaseUrl.length > 0) {
    const parsed = normalizeBaseUrl(visionBaseUrl);
    if (parsed.error) {
      issues.push(`视觉模型${parsed.error}，该字段已清空（将沿用主模型连接）`);
    } else {
      visionBaseUrlValue = parsed.value;
    }
  }

  const vision: VisionSettings = {
    baseUrl: visionBaseUrlValue,
    apiKey: pickString(visionInput.apiKey, ''),
    model: pickString(visionInput.model, '')
  };

  const chunk: ChunkSettings = {
    targetTokens: pickNumber(
      chunkInput.targetTokens,
      DEFAULT_SETTINGS.chunk.targetTokens,
      SETTINGS_LIMITS.targetTokens,
      '每段内容量',
      issues,
      true
    ),
    maxTokens: pickNumber(
      chunkInput.maxTokens,
      DEFAULT_SETTINGS.chunk.maxTokens,
      SETTINGS_LIMITS.maxTokens,
      '单段上限',
      issues,
      true
    ),
    overlapSeconds: pickNumber(
      chunkInput.overlapSeconds,
      DEFAULT_SETTINGS.chunk.overlapSeconds,
      SETTINGS_LIMITS.overlapSeconds,
      '相邻段重复',
      issues,
      true
    ),
    concurrency: pickNumber(
      chunkInput.concurrency,
      DEFAULT_SETTINGS.chunk.concurrency,
      SETTINGS_LIMITS.concurrency,
      '同时处理段数',
      issues,
      true
    ),
    maxRetries: pickNumber(
      chunkInput.maxRetries,
      DEFAULT_SETTINGS.chunk.maxRetries,
      SETTINGS_LIMITS.maxRetries,
      '失败重试次数',
      issues,
      true
    )
  };

  if (chunk.targetTokens > chunk.maxTokens) {
    issues.push('每段内容量超过单段上限，已按上限收敛');
    chunk.targetTokens = chunk.maxTokens;
  }

  const general: GeneralSettings = {
    theme: pickEnum<ThemeMode>(generalInput.theme, THEME_MODES, DEFAULT_SETTINGS.general.theme)
  };

  const frames: FrameSettings = {
    sampleFps: Number(
      pickNumber(
        framesInput.sampleFps,
        DEFAULT_SETTINGS.frames.sampleFps,
        SETTINGS_LIMITS.sampleFps,
        '抽帧密度',
        issues
      ).toFixed(1)
    ),
    minGapSeconds: pickNumber(
      framesInput.minGapSeconds,
      DEFAULT_SETTINGS.frames.minGapSeconds,
      SETTINGS_LIMITS.minGapSeconds,
      '两张图的间隔',
      issues,
      true
    ),
    maxFrames: pickNumber(
      framesInput.maxFrames,
      DEFAULT_SETTINGS.frames.maxFrames,
      SETTINGS_LIMITS.maxFrames,
      '最多看几张图',
      issues,
      true
    ),
    imageWidth: pickNumber(
      framesInput.imageWidth,
      DEFAULT_SETTINGS.frames.imageWidth,
      SETTINGS_LIMITS.imageWidth,
      '图片宽度',
      issues,
      true
    )
  };

  // 保留间隔短于采样周期时，去重条件永远成立，等价于「每帧都留」，属于无效配置
  const samplePeriodSeconds = 1 / Math.max(0.5, frames.sampleFps);
  if (frames.minGapSeconds < samplePeriodSeconds) {
    issues.push('两张图的间隔小于采样周期，已按采样周期收敛');
    frames.minGapSeconds = Math.ceil(samplePeriodSeconds);
  }

  const updatedAtRaw = root['updatedAt'];
  const updatedAt =
    typeof updatedAtRaw === 'number' && Number.isFinite(updatedAtRaw) && updatedAtRaw > 0
      ? updatedAtRaw
      : 0;

  return {
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      model,
      vision,
      chunk,
      frames,
      general,
      updatedAt
    },
    issues
  };
}

/** 模型服务是否已具备发起请求的最小配置。 */
export function isModelConfigured(model: ModelSettings): boolean {
  return model.baseUrl.length > 0 && model.apiKey.length > 0 && model.model.length > 0;
}

/**
 * 解析视觉模型的实际连接参数。
 *
 * `baseUrl` / `apiKey` 留空即沿用主模型，因此用户只需要多填一个支持图片的模型名；
 * 若模型名也为空，返回 null 表示「画面识别未启用」，调用方据此隐藏入口，
 * 避免出现点了没反应的按钮。
 */
export function resolveVisionConnection(settings: ExtensionSettings): {
  baseUrl: string;
  apiKey: string;
  model: string;
} | null {
  const { vision, model } = settings;
  const modelName = vision.model.trim();
  if (modelName.length === 0) return null;
  const baseUrl = (vision.baseUrl.trim() || model.baseUrl).trim();
  const apiKey = (vision.apiKey.trim() || model.apiKey).trim();
  if (baseUrl.length === 0 || apiKey.length === 0) return null;
  return { baseUrl, apiKey, model: modelName };
}

/** 画面识别是否可用于发起请求。 */
export function isVisionConfigured(settings: ExtensionSettings): boolean {
  return resolveVisionConnection(settings) !== null;
}
