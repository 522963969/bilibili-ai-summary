import { AppError } from '@/core/errors/app-error';
import { postChatCompletion, type ChatConnection } from '@/core/ai/chat-client';
import type { AiTestResult, ChatMessage, CompletionRequest, CompletionResult } from '@/core/ai/types';
import { parseFrameDescriptions } from '@/core/frames/parse';
import { buildFrameMessages, type FramePromptContext } from '@/core/frames/prompts';
import type { CapturedFrame, FrameScriptEntry } from '@/core/frames/types';

/**
 * 视觉模型 Provider。
 *
 * 与文本 Provider 的关键区别不是协议，而是**能力前提不同**：
 * 文本模型不一定接受图片输入。因此这里提供一个真正带图片的连通性测试，
 * 让用户在开始识别前就能确认「这个模型能不能看图」，
 * 而不是等到抽帧几十秒之后才收到一条看不懂的接口报错。
 */

/**
 * 生成一张用于连通性测试的纯色图片。
 *
 * Service Worker 里没有 CANVAS 元素，但可以用 OffscreenCanvas。
 * 失败时返回 null，测试降级为纯文本请求（此时只能验证凭据与模型名，
 * 无法验证图片输入能力，返回结果里会明确说明）。
 */
async function createProbeImage(): Promise<string | null> {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#e4472b';
    ctx.fillRect(0, 0, 64, 64);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of buffer) binary += String.fromCharCode(byte);
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

export interface FrameDescribeResult {
  entries: FrameScriptEntry[];
  /** 模型返回了但无法对上编号的行数 */
  unmatchedLines: number;
  model: string | null;
  latencyMs: number;
  /**
   * 模型这一批的原始返回（截断到可读长度）。
   *
   * 没有它就无法区分「模型根本没看图（返回空）」和「看了但格式不对」——
   * 而这两种情况要给用户的处理建议完全不同，必须能分开。
   */
  rawText: string;
  /** 是否走了按行序对齐的兜底解析 */
  positional: boolean;
}

export class OpenAiVisionProvider {
  constructor(private readonly connection: ChatConnection) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    return postChatCompletion(this.connection, request);
  }

  async testConnection(): Promise<AiTestResult> {
    const startedAt = Date.now();
    const image = await createProbeImage();

    if (!image) {
      try {
        const result = await this.complete({
          messages: [{ role: 'user', content: '只回复两个字：可用' }],
          temperature: 0,
          maxTokens: 32
        });
        return {
          ok: true,
          model: result.model,
          latencyMs: result.latencyMs,
          message: `连通正常，但当前环境无法生成测试图片，未验证图片输入能力（模型返回「${result.content
            .trim()
            .slice(0, 16)}」）`,
          errorCode: null
        };
      } catch (error) {
        const appError = AppError.from(error);
        return {
          ok: false,
          model: null,
          latencyMs: Date.now() - startedAt,
          message: appError.message,
          errorCode: appError.code
        };
      }
    }

    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张图片是什么颜色？只回复两个汉字。' },
          { type: 'image_url', image_url: { url: image, detail: 'low' } }
        ]
      }
    ];

    try {
      const result = await this.complete({ messages, temperature: 0, maxTokens: 32 });
      const echo = result.content.trim().replace(/\s+/g, ' ').slice(0, 24);
      // 不看颜色答得对不对（各模型表述不同），只确认它接受了图片并给出了回答
      if (echo.length === 0) {
        return {
          ok: true,
          // 接口通、模型却没吐任何内容，说明图片部分被丢弃了，图片能力并未验证通过
          imageAccepted: false,
          model: result.model,
          latencyMs: result.latencyMs,
          message: `接口可以访问，但模型对图片没有任何输出——它多半不支持图片输入，请换一个支持看图的模型（例如 qwen3.5-flash、gpt-4o）。用它做画面识别只会得到空描述。`,
          errorCode: null
        };
      }
      return {
        ok: true,
        imageAccepted: true,
        model: result.model,
        latencyMs: result.latencyMs,
        message: `图片输入可用，模型看到「${echo}」`,
        errorCode: null
      };
    } catch (error) {
      const appError = AppError.from(error);
      return {
        ok: false,
        model: null,
        latencyMs: Date.now() - startedAt,
        message: appError.message,
        errorCode: appError.code
      };
    }
  }

  /** 识别一批帧，返回带时间戳的画面描述。 */
  async describeFrames(
    frames: CapturedFrame[],
    context: FramePromptContext,
    options: { temperature: number; maxTokens: number }
  ): Promise<FrameDescribeResult> {
    const result = await this.complete({
      messages: buildFrameMessages(frames, context),
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });

    const parsed = parseFrameDescriptions(
      result.content,
      frames.map((frame) => frame.tMs),
      context.startIndex
    );

    return {
      entries: parsed.entries,
      unmatchedLines: parsed.unmatchedLines,
      model: result.model,
      latencyMs: result.latencyMs,
      rawText: result.content.trim().slice(0, 240),
      positional: parsed.positional
    };
  }
}
