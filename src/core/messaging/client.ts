import { RUNTIME_MESSAGE_TIMEOUT_MS } from '@/core/config/app';
import { AppError } from '@/core/errors/app-error';
import { TimeoutError, withTimeout } from '@/core/utils/async';
import type {
  MessageType,
  PayloadOf,
  RequestMessage,
  ResponseEnvelope,
  ResultOf
} from './contracts';

type SendArgs<K extends MessageType> = PayloadOf<K> extends undefined
  ? []
  : [payload: PayloadOf<K>];

/**
 * 扩展页面侧的强类型消息客户端。
 * 统一封装超时、无响应与错误信封解包，调用方只处理成功值或 AppError。
 */
export class MessageClient {
  async send<K extends MessageType>(type: K, ...args: SendArgs<K>): Promise<ResultOf<K>> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      throw new AppError('E_RUNTIME_UNAVAILABLE', { details: 'chrome.runtime 不可用' });
    }

    const payload = args[0] as PayloadOf<K>;
    const message: RequestMessage = { type, payload } as RequestMessage;

    let response: ResponseEnvelope<ResultOf<K>> | undefined;
    try {
      response = await withTimeout(
        chrome.runtime.sendMessage<RequestMessage, ResponseEnvelope<ResultOf<K>>>(message),
        RUNTIME_MESSAGE_TIMEOUT_MS,
        '扩展服务响应超时'
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new AppError('E_TIMEOUT', {
          message: '扩展服务响应超时，请稍后重试',
          details: error.message
        });
      }
      throw new AppError('E_RUNTIME_UNAVAILABLE', { details: String(error) });
    }

    if (!response) {
      throw new AppError('E_RUNTIME_UNAVAILABLE', {
        message: '扩展服务没有返回结果，请重新打开面板',
        details: '空响应'
      });
    }

    if (!response.ok) {
      throw new AppError(response.error.code, {
        message: response.error.message,
        details: response.error.details,
        retryable: response.error.retryable
      });
    }

    return response.data;
  }
}

export const messageClient = new MessageClient();
