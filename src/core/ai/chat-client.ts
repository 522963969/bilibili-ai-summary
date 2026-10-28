import { AppError } from '@/core/errors/app-error';
import type { CompletionRequest, CompletionResult } from './types';

/**
 * OpenAI 兼容的 Chat Completions 客户端。
 *
 * 文本模型与视觉模型共用同一个请求实现：多模态只是 `messages[].content`
 * 从字符串换成片段数组，协议本身没有差别。抽出来是为了让两个 Provider
 * 共享同一套 HTTP 状态映射与超时处理，避免错误码在两条链路上不一致。
 */

/** 一次请求所需的连接参数。 */
export interface ChatConnection {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** baseUrl 允许用户填写到 /v1 或直接填完整的 /chat/completions。 */
export function buildChatEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function mapHttpStatus(status: number, body: string): AppError {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AppError('E_API_UNAUTHORIZED', { details: `HTTP ${status} · ${detail}` });
  }
  if (status === 429) {
    return new AppError('E_API_RATE_LIMITED', { details: `HTTP 429 · ${detail}` });
  }
  if (status === 404) {
    return new AppError('E_API_HTTP_ERROR', {
      message: '模型接口地址不存在，请检查 Base URL 是否包含正确的版本路径',
      details: `HTTP 404 · ${detail}`
    });
  }
  if (status >= 500) {
    return new AppError('E_API_HTTP_ERROR', {
      message: `模型服务端错误（HTTP ${status}）`,
      details: detail,
      retryable: true
    });
  }
  return new AppError('E_API_HTTP_ERROR', { details: `HTTP ${status} · ${detail}` });
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 校验连接参数是否足以发起请求；缺失时抛出带指引的错误。 */
export function assertConnection(connection: ChatConnection): void {
  if (!connection.apiKey.trim()) {
    throw new AppError('E_SETTINGS_INVALID', { message: '尚未配置 API Key，请先在设置页填写' });
  }
  if (!connection.baseUrl.trim()) {
    throw new AppError('E_SETTINGS_INVALID', { message: '尚未配置 Base URL，请先在设置页填写' });
  }
  if (!connection.model.trim()) {
    throw new AppError('E_SETTINGS_INVALID', { message: '尚未配置模型名称，请先在设置页填写' });
  }
}

export async function postChatCompletion(
  connection: ChatConnection,
  request: CompletionRequest
): Promise<CompletionResult> {
  assertConnection(connection);

  const endpoint = buildChatEndpoint(connection.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5000, connection.timeoutMs));
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${connection.apiKey.trim()}`
      },
      body: JSON.stringify({
        model: connection.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false,
        ...(request.json ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) throw mapHttpStatus(response.status, text);

    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      throw new AppError('E_API_RESPONSE_INVALID', { details: text.slice(0, 200) });
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AppError('E_API_RESPONSE_INVALID', {
        message: '模型返回中没有 choices[0].message.content',
        details: text.slice(0, 200)
      });
    }

    return {
      content,
      model: typeof parsed.model === 'string' ? parsed.model : connection.model,
      usage: parsed.usage
        ? {
            promptTokens: readNumber(parsed.usage.prompt_tokens),
            completionTokens: readNumber(parsed.usage.completion_tokens)
          }
        : null,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const appError = AppError.from(error);
    if (appError.code === 'E_TIMEOUT' || appError.message.includes('abort')) {
      throw new AppError('E_TIMEOUT', {
        message: `模型在 ${Math.round(connection.timeoutMs / 1000)} 秒内没有响应`,
        retryable: true
      });
    }
    throw new AppError('E_NETWORK_FAILED', {
      message: '无法连接模型接口，请检查 Base URL、域名授权与网络',
      details: appError.message
    });
  } finally {
    clearTimeout(timer);
  }
}
