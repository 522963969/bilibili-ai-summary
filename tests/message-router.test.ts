import { describe, expect, it } from 'vitest';
import { createMessageRouter, type HandlerRegistry } from '@/background/router';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { AppError } from '@/core/errors/app-error';

const snapshot = { settings: DEFAULT_SETTINGS, modelConfigured: false, visionConfigured: false };
const sender = {} as unknown as chrome.runtime.MessageSender;

function createRouter(overrides: Partial<HandlerRegistry> = {}) {
  const registry: HandlerRegistry = {
    'app.ping': async () => ({ version: '0.1.0', stage: 1, timestamp: 1 }),
    'video.resolveActive': async () => ({ status: 'no-active-tab' }),
    'video.resolveFromTab': async () => ({ status: 'no-active-tab' }),
    'tab.whoami': async () => ({
      tabId: null,
      url: null,
      title: null,
      identity: null,
      reason: '无标签页'
    }),
    'settings.get': async () => snapshot,
    'settings.update': async () => ({ ...snapshot, issues: [] }),
    'settings.reset': async () => snapshot,
    'subtitle.discover': async () => ({
      availability: 'empty',
      tracks: [],
      message: '该视频没有可用字幕',
      loginRequired: false,
      cid: null,
      videoTitle: null,
      fetchedAt: 0
    }),
    'subtitle.fetch': async () => {
      throw new AppError('E_SUBTITLE_UNAVAILABLE');
    },
    'subtitle.import': async () => {
      throw new AppError('E_SUBTITLE_UNAVAILABLE');
    },
    'subtitle.getCached': async () => ({ subtitle: null }),
    'subtitle.clear': async () => ({ cleared: true }),
    'ai.testConnection': async () => ({
      ok: false,
      model: null,
      latencyMs: 0,
      message: '未配置',
      errorCode: 'E_SETTINGS_INVALID'
    }),
    'ai.testVision': async () => ({
      ok: false,
      model: null,
      latencyMs: 0,
      message: '未配置',
      errorCode: 'E_SETTINGS_INVALID'
    }),
    'summary.start': async () => {
      throw new AppError('E_SUBTITLE_UNAVAILABLE');
    },
    'summary.get': async () => ({ task: null }),
    'summary.cancel': async () => ({ cancelled: false }),
    'frames.start': async () => {
      throw new AppError('E_SETTINGS_INVALID');
    },
    'frames.push': async () => ({ accepted: false, analyzed: 0 }),
    'frames.finish': async () => ({ accepted: false }),
    'frames.getScript': async () => ({ script: null }),
    'frames.stop': async () => ({ stopped: true }),
    'frames.clear': async () => ({ cleared: true }),
    'export.openMubu': async () => ({ opened: true }),
    'export.download': async () => ({ started: true }),
    ...overrides
  };
  return createMessageRouter(registry);
}

describe('createMessageRouter', () => {
  it('成功消息返回 ok 信封', async () => {
    const route = createRouter();
    const response = await route({ type: 'app.ping', payload: undefined }, sender);
    expect(response).toEqual({
      ok: true,
      data: { version: '0.1.0', stage: 1, timestamp: 1 }
    });
  });

  it('未知消息类型返回 E_UNKNOWN_MESSAGE', async () => {
    const route = createRouter();
    const response = await route({ type: 'app.unknown', payload: null }, sender);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('E_UNKNOWN_MESSAGE');
      expect(response.error.message).toContain('未知的消息类型');
    }
  });

  it('非对象消息返回 E_INVALID_PAYLOAD', async () => {
    const route = createRouter();
    const response = await route('bad-message', sender);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('E_INVALID_PAYLOAD');
  });

  it('缺少 type 字段返回 E_INVALID_PAYLOAD', async () => {
    const route = createRouter();
    const response = await route({ payload: {} }, sender);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('E_INVALID_PAYLOAD');
  });

  it('处理函数抛出的 AppError 保留错误码与可重试标记', async () => {
    const route = createRouter({
      'settings.get': async () => {
        throw new AppError('E_TIMEOUT', { details: 'upstream' });
      }
    });
    const response = await route({ type: 'settings.get', payload: undefined }, sender);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('E_TIMEOUT');
      expect(response.error.retryable).toBe(true);
      expect(response.error.details).toBe('upstream');
    }
  });

  it('普通异常被收敛为 E_INTERNAL', async () => {
    const route = createRouter({
      'settings.reset': async () => {
        throw new Error('boom');
      }
    });
    const response = await route({ type: 'settings.reset', payload: undefined }, sender);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('E_INTERNAL');
      expect(response.error.message).toBe('boom');
      expect(response.error.retryable).toBe(false);
    }
  });

  it('payload 原样传递给处理函数', async () => {
    let received: unknown;
    const route = createRouter({
      'settings.update': async (payload) => {
        received = payload;
        return { ...snapshot, issues: [] };
      }
    });
    await route({ type: 'settings.update', payload: { patch: { general: { theme: 'dark' } } } }, sender);
    expect(received).toEqual({ patch: { general: { theme: 'dark' } } });
  });
});
