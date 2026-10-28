import { EXPORT_LIMITS } from './types';

/** Windows / macOS / Linux 均不接受的文件名字符（含换行与制表符）。 */
const ILLEGAL_CHARS = /[\\/:*?"<>|\r\n\t]/g;

/** Windows 保留设备名，作为纯文件名时会无法保存。 */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 连续空白压成一个空格，避免标题里的换行把文件名撑开。 */
const COLLAPSED_SPACES = /\s+/g;

/**
 * 把视频标题转成安全的文件名主体。
 *
 * 只做「不破坏文件系统」所必需的替换，不擅自改写中文与标点：
 * 用户能一眼认出这是哪个视频，比文件名"干净"更重要。
 */
export function sanitizeFileName(raw: string, fallback = 'B站视频'): string {
  const cleaned = raw.replace(ILLEGAL_CHARS, ' ').replace(COLLAPSED_SPACES, ' ').trim();
  // 去掉首尾的点：Windows 会静默丢弃结尾的点，导致实际文件名与预期不符
  const trimmed = cleaned.replace(/^\.+/, '').replace(/\.+$/, '').trim();

  if (trimmed.length === 0) return fallback;
  if (RESERVED_NAMES.test(trimmed)) return `${trimmed}_`;

  const chars = Array.from(trimmed);
  if (chars.length <= EXPORT_LIMITS.maxFileNameChars) return trimmed;
  // 按码点截断，避免把 emoji 或代理对切成半个字符
  return chars.slice(0, EXPORT_LIMITS.maxFileNameChars).join('').trim();
}
