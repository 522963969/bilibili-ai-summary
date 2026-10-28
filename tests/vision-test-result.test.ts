import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompletionResult } from '@/core/ai/types';
import { OpenAiVisionProvider } from '@/core/ai/vision-provider';

/**
 * 视觉模型连通性判定的回归测试。
 *
 * 真实案例：中转站上的 `deepseek-v4-flash` 收到 image_url 后返回 HTTP 200、content 为空字符串。
 * 旧实现只看「请求有没有报错」，于是界面显示绿色「图片输入可用」，
 * 与实际能力完全相反——用户按这个结论去用画面识别，只会拿到空描述。
 * 这里锁住三档判定：真的作答 / 接口通但没看图 / 环境无法生成测试图（未验证）。
 */

/** 只够 testConnection 生成探测图的 OffscreenCanvas 替身。 */
function stubOffscreenCanvas(): void {
  class FakeCanvas {
    getContext(): { fillStyle: string; fillRect: () => void } {
      return { fillStyle: '', fillRect: () => undefined };
    }
    async convertToBlob(): Promise<Blob> {
      return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    }
  }
  vi.stubGlobal('OffscreenCanvas', FakeCanvas as unknown as typeof OffscreenCanvas);
}

function makeProvider(content: string): OpenAiVisionProvider {
  const provider = new OpenAiVisionProvider({
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    timeoutMs: 1000
  });
  const result: CompletionResult = {
    content,
    usage: null,
    model: 'test-model',
    latencyMs: 12
  };
  vi.spyOn(provider, 'complete').mockResolvedValue(result);
  return provider;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiVisionProvider.testConnection', () => {
  it('模型正常回答时标记图片输入可用', async () => {
    stubOffscreenCanvas();
    const provider = makeProvider('红色');

    const result = await provider.testConnection();
    expect(result.ok).toBe(true);
    expect(result.imageAccepted).toBe(true);
    expect(result.message).toContain('图片输入可用');
    expect(result.message).toContain('红色');
  });

  it('接口 200 但内容为空时判定为不支持图片，并给出可操作提示', async () => {
    stubOffscreenCanvas();
    const provider = makeProvider('   ');

    const result = await provider.testConnection();
    // ok 仍为 true：接口与鉴权确实通了
    expect(result.ok).toBe(true);
    // 但图片能力必须显式标成未通过，不能再显示「图片输入可用」
    expect(result.imageAccepted).toBe(false);
    expect(result.message).toContain('不支持图片输入');
    expect(result.message).toContain('qwen3.5-flash');
    expect(result.message).not.toContain('图片输入可用');
  });

  it('环境无法生成测试图时退化为纯文本测试，不声称验证过图片能力', async () => {
    // 不 stub OffscreenCanvas，模拟 Service Worker 里不可用的场景
    const provider = makeProvider('可用');

    const result = await provider.testConnection();
    expect(result.ok).toBe(true);
    expect(result.imageAccepted).toBeUndefined();
    expect(result.message).toContain('未验证图片输入能力');
  });
});
