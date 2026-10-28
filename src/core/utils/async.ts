/** Promise 超时保护。用于浏览器 API 与网络请求，避免任务无限挂起。 */
export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message = `操作超时（${timeoutMs}ms）`) {
    super(message);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(timeoutMs, message)), timeoutMs);
  });
  try {
    return await Promise.race([task, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 延迟执行，仅用于重试退避，不用于伪装任务进度。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
