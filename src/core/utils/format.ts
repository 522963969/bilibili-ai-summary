/** 展示层格式化工具。所有函数均为纯函数，便于单元测试。 */

/** 秒 -> mm:ss 或 h:mm:ss */
export function formatClock(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '--:--';
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(rest)}`;
  return `${pad(minutes)}:${pad(rest)}`;
}

/** 秒 -> 人类可读时长，例如 1 小时 12 分 */
export function formatDurationHuman(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '未知时长';
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '未知时长';
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  if (minutes > 0) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
}

/** 毫秒时间戳 -> YYYY-MM-DD HH:mm */
export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) return '未记录';
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * API Key 脱敏展示。
 * 仅在界面呈现时调用，不得写入日志。
 */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 8) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${'*'.repeat(Math.min(12, trimmed.length - 8))}${trimmed.slice(-4)}`;
}

/** 从 Base URL 中提取主机名，用于界面展示。 */
export function extractHostName(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
