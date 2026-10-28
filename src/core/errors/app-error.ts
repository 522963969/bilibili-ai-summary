import { ERROR_MESSAGES, isRetryableCode, type ErrorCode } from './codes';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
}

export interface AppErrorOptions {
  /** 覆盖默认中文提示（用于更具体的场景描述）。 */
  message?: string;
  /** 技术细节，仅用于排查，不包含敏感信息。 */
  details?: string;
  retryable?: boolean;
  cause?: unknown;
}

/**
 * 业务异常。跨上下文传输时统一序列化为 ErrorPayload，
 * 避免依赖 Error 实例在消息通道中的保真度。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: string;
  readonly retryable: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? isRetryableCode(code);
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable
    };
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }

  /** 将任意抛出物收敛为 AppError，保证上层处理逻辑单一。 */
  static from(value: unknown): AppError {
    if (value instanceof AppError) return value;
    if (value instanceof Error) {
      return new AppError('E_INTERNAL', { message: value.message, details: value.stack });
    }
    if (typeof value === 'string') {
      return new AppError('E_INTERNAL', { message: value });
    }
    return new AppError('E_INTERNAL');
  }
}

export function isErrorPayload(value: unknown): value is ErrorPayload {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string' && typeof record.message === 'string';
}

export function toErrorPayload(value: unknown): ErrorPayload {
  if (isErrorPayload(value)) {
    return {
      code: value.code as ErrorCode,
      message: value.message,
      details: value.details,
      retryable: value.retryable ?? isRetryableCode(value.code as ErrorCode)
    };
  }
  return AppError.from(value).toPayload();
}
