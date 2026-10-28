import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '@/core/config/defaults';
import {
  isModelConfigured,
  isVisionConfigured,
  normalizeBaseUrl,
  normalizeSettings,
  resolveVisionConnection
} from '@/core/settings/normalize';

describe('normalizeBaseUrl', () => {
  it('去掉末尾斜杠、查询串与 hash', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/').value).toBe('https://api.openai.com/v1');
    expect(normalizeBaseUrl(' https://api.deepseek.com/v1?x=1#y ').value).toBe(
      'https://api.deepseek.com/v1'
    );
  });

  it('保留端口与本地地址', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1').value).toBe('http://localhost:11434/v1');
  });

  it('拒绝非法协议与带凭据的地址', () => {
    expect(normalizeBaseUrl('ftp://example.com').error).toBe('Base URL 仅支持 http 或 https');
    expect(normalizeBaseUrl('https://user:pass@example.com').error).toContain('不能包含用户名');
    expect(normalizeBaseUrl('::not-a-url').error).toBe('Base URL 不是合法地址');
  });

  it('空字符串视为未配置而不是错误', () => {
    const result = normalizeBaseUrl('   ');
    expect(result.value).toBe('');
    expect(result.error).toBeNull();
  });
});

describe('normalizeSettings', () => {
  it('空输入返回完整默认值', () => {
    const { settings, issues } = normalizeSettings(undefined);
    expect(settings.model.baseUrl).toBe(DEFAULT_SETTINGS.model.baseUrl);
    expect(settings.chunk.targetTokens).toBe(6000);
    expect(settings.chunk.maxTokens).toBe(8000);
    expect(settings.chunk.overlapSeconds).toBe(30);
    expect(settings.chunk.concurrency).toBe(2);
    expect(settings.chunk.maxRetries).toBe(3);
    expect(settings.general.theme).toBe('auto');
    expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(settings.vision.model).toBe('');
    expect(settings.frames.sampleFps).toBe(2);
    expect(issues).toHaveLength(0);
  });

  it('旧版本设置（无 vision / frames）平滑升级为默认值', () => {
    const legacy = {
      schemaVersion: 1,
      model: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat' },
      chunk: { targetTokens: 6000, maxTokens: 8000, overlapSeconds: 30 },
      general: { theme: 'dark' },
      updatedAt: 123
    };
    const { settings, issues } = normalizeSettings(legacy);
    expect(settings.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(settings.model.model).toBe('deepseek-chat');
    expect(settings.general.theme).toBe('dark');
    expect(settings.vision).toEqual({ baseUrl: '', apiKey: '', model: '' });
    expect(settings.frames.maxFrames).toBe(DEFAULT_SETTINGS.frames.maxFrames);
    expect(issues).toHaveLength(0);
  });

  it('视觉模型 Base URL 非法时清空并提示，不影响主模型', () => {
    const { settings, issues } = normalizeSettings({
      model: { baseUrl: 'https://api.openai.com/v1' },
      vision: { baseUrl: 'javascript:alert(1)', model: 'gpt-4o' }
    });
    expect(settings.vision.baseUrl).toBe('');
    expect(settings.model.baseUrl).toBe('https://api.openai.com/v1');
    expect(issues.some((issue) => issue.includes('视觉模型'))).toBe(true);
  });

  it('保留帧间隔小于采样周期时按采样周期收敛', () => {
    const { settings, issues } = normalizeSettings({ frames: { sampleFps: 0.5, minGapSeconds: 1 } });
    expect(settings.frames.minGapSeconds).toBe(2);
    expect(issues.some((issue) => issue.includes('采样周期'))).toBe(true);
  });

  it('数值越界时收敛到边界并记录问题', () => {
    const { settings, issues } = normalizeSettings({
      model: { temperature: 9, maxOutputTokens: 10, timeoutMs: 1000 },
      chunk: { concurrency: 99, maxRetries: -1, overlapSeconds: 500 }
    });
    expect(settings.model.temperature).toBe(2);
    expect(settings.model.maxOutputTokens).toBe(256);
    expect(settings.model.timeoutMs).toBe(5000);
    expect(settings.chunk.concurrency).toBe(6);
    expect(settings.chunk.maxRetries).toBe(0);
    expect(settings.chunk.overlapSeconds).toBe(120);
    expect(issues.length).toBeGreaterThanOrEqual(6);
  });

  it('每段内容量超过单段上限时收敛并提示', () => {
    const { settings, issues } = normalizeSettings({
      chunk: { targetTokens: 20000, maxTokens: 4000 }
    });
    expect(settings.chunk.targetTokens).toBe(4000);
    expect(issues.some((issue) => issue.includes('每段内容量'))).toBe(true);
  });

  it('越界提示里的等待时间用秒，不把毫秒原始值抛给用户', () => {
    const tooSmall = normalizeSettings({ model: { timeoutMs: 1000 } });
    expect(tooSmall.settings.model.timeoutMs).toBe(5000);
    expect(tooSmall.issues.some((issue) => issue.includes('低于下限 5 秒'))).toBe(true);
    expect(tooSmall.issues.some((issue) => issue.includes('5000'))).toBe(false);

    const tooLarge = normalizeSettings({ model: { timeoutMs: 999999 } });
    expect(tooLarge.settings.model.timeoutMs).toBe(300000);
    expect(tooLarge.issues.some((issue) => issue.includes('高于上限 300 秒'))).toBe(true);
  });

  it('非法 Base URL 清空并提示，未知主题回落默认', () => {
    const { settings, issues } = normalizeSettings({
      model: { baseUrl: 'javascript:alert(1)' },
      general: { theme: 'neon' }
    });
    expect(settings.model.baseUrl).toBe('');
    expect(issues.some((issue) => issue.includes('Base URL'))).toBe(true);
    expect(settings.general.theme).toBe('auto');
  });

  it('字符串数字可被接受，非数字回落默认', () => {
    const { settings } = normalizeSettings({
      chunk: { concurrency: '3', maxRetries: 'abc' },
      model: { maxOutputTokens: '4096' }
    });
    expect(settings.chunk.concurrency).toBe(3);
    expect(settings.chunk.maxRetries).toBe(3);
    expect(settings.model.maxOutputTokens).toBe(4096);
  });

  it('忽略未知字段，不污染输出结构', () => {
    const { settings } = normalizeSettings({ model: { unknownKey: 'x' }, extra: true });
    expect(Object.prototype.hasOwnProperty.call(settings.model, 'unknownKey')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, 'extra')).toBe(false);
  });
});

describe('isModelConfigured', () => {
  it('三项齐全才算已配置', () => {
    const base = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxOutputTokens: 3000,
      timeoutMs: 120000
    };
    expect(isModelConfigured(base)).toBe(true);
    expect(isModelConfigured({ ...base, apiKey: '' })).toBe(false);
    expect(isModelConfigured({ ...base, model: '' })).toBe(false);
    expect(isModelConfigured({ ...base, baseUrl: '' })).toBe(false);
  });
});

describe('resolveVisionConnection', () => {
  function withVision(patch: Partial<typeof DEFAULT_SETTINGS.vision>) {
    const { settings } = normalizeSettings({
      model: { baseUrl: 'https://gw.example.com/v1', apiKey: 'sk-main', model: 'text-model' },
      vision: patch
    });
    return settings;
  }

  it('只填模型名时沿用主模型的 Base URL 与 Key', () => {
    const settings = withVision({ model: 'qwen-vl' });
    expect(isVisionConfigured(settings)).toBe(true);
    expect(resolveVisionConnection(settings)).toEqual({
      baseUrl: 'https://gw.example.com/v1',
      apiKey: 'sk-main',
      model: 'qwen-vl'
    });
  });

  it('独立的 Base URL 与 Key 优先于主模型', () => {
    const settings = withVision({
      baseUrl: 'https://vision.example.com/v1',
      apiKey: 'sk-vision',
      model: 'gpt-4o'
    });
    expect(resolveVisionConnection(settings)).toEqual({
      baseUrl: 'https://vision.example.com/v1',
      apiKey: 'sk-vision',
      model: 'gpt-4o'
    });
  });

  it('未填模型名视为未启用，界面据此隐藏入口', () => {
    const settings = withVision({});
    expect(isVisionConfigured(settings)).toBe(false);
    expect(resolveVisionConnection(settings)).toBeNull();
  });

  it('主模型也没配置 Key 时返回 null，避免发起注定失败的请求', () => {
    const { settings } = normalizeSettings({
      model: { baseUrl: 'https://gw.example.com/v1', apiKey: '', model: 'text-model' },
      vision: { model: 'qwen-vl' }
    });
    expect(resolveVisionConnection(settings)).toBeNull();
  });
});
