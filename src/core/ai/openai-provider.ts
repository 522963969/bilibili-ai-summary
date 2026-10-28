import { AppError } from '@/core/errors/app-error';
import type { ExtensionSettings } from '@/core/settings/types';
import {
  buildChatEndpoint,
  postChatCompletion,
  type ChatConnection
} from './chat-client';
import type { AiProvider, AiTestResult, CompletionRequest, CompletionResult } from './types';

/**
 * OpenAI 兼容的 Chat Completions Provider（文本）。
 *
 * 只依赖标准的 `POST {baseUrl}/chat/completions`，因此可对接 OpenAI、
 * DeepSeek、Moonshot、通义、本地 Ollama / vLLM / LM Studio 等服务。
 * 不猜测厂商私有字段，除 `choices[0].message.content` 外不做任何假设。
 *
 * 请求实现见 `chat-client`，与视觉 Provider 共用同一套协议与错误映射。
 */

export { buildChatEndpoint };

const TEST_PROMPT = '只回复两个字：可用';

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly settings: ExtensionSettings) {}

  private connection(): ChatConnection {
    const { baseUrl, apiKey, model, timeoutMs } = this.settings.model;
    return { baseUrl, apiKey, model, timeoutMs };
  }

  async testConnection(): Promise<AiTestResult> {
    const startedAt = Date.now();
    try {
      const result = await this.complete({
        messages: [{ role: 'user', content: TEST_PROMPT }],
        temperature: 0,
        maxTokens: 32
      });
      const echo = result.content.trim().replace(/\s+/g, ' ').slice(0, 24);
      return {
        ok: true,
        model: result.model,
        latencyMs: result.latencyMs,
        message: echo.length > 0 ? `连接成功，模型返回「${echo}」` : '连接成功，但模型返回内容为空',
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

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    return postChatCompletion(this.connection(), request);
  }
}
