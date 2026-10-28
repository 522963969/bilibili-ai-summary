import { AppError, toErrorPayload } from '@/core/errors/app-error';
import {
  isKnownMessageType,
  isRequestMessage,
  type MessageType,
  type PayloadOf,
  type ResponseEnvelope,
  type ResultOf
} from '@/core/messaging/contracts';

export type MessageHandler<K extends MessageType> = (
  payload: PayloadOf<K>,
  sender: chrome.runtime.MessageSender
) => Promise<ResultOf<K>>;

/** 消息类型 -> 处理函数的完整注册表，缺少任一项都无法通过类型检查。 */
export type HandlerRegistry = { [K in MessageType]: MessageHandler<K> };

export type MessageRouter = (
  message: unknown,
  sender: chrome.runtime.MessageSender
) => Promise<ResponseEnvelope<unknown>>;

/**
 * 消息路由：负责协议校验、错误信封封装与统一异常转换。
 * 处理函数内部抛出的任何异常都会被转换为结构化错误，不会让消息通道挂起。
 */
export function createMessageRouter(registry: HandlerRegistry): MessageRouter {
  return async (message, sender) => {
    if (!isRequestMessage(message) || !isKnownMessageType(message.type)) {
      const code = isRequestMessage(message) ? 'E_UNKNOWN_MESSAGE' : 'E_INVALID_PAYLOAD';
      return {
        ok: false,
        error: new AppError(code, {
          details: isRequestMessage(message) ? `type=${message.type}` : '消息缺少 type 字段'
        }).toPayload()
      };
    }

    const handler = registry[message.type] as MessageHandler<typeof message.type> | undefined;
    if (!handler) {
      return { ok: false, error: new AppError('E_UNKNOWN_MESSAGE').toPayload() };
    }

    try {
      const data = await handler(message.payload as PayloadOf<typeof message.type>, sender);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: toErrorPayload(error) };
    }
  };
}
