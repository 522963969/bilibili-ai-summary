/** 字幕时间戳解析与格式化。全部为纯函数，便于单测。 */

const SRT_TIME = /^(\d{1,3}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;
const SHORT_TIME = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;

function toMs(hours: number, minutes: number, seconds: number, millisPart: string): number | null {
  if (minutes > 59 || seconds > 59) return null;
  const millis = Number.parseInt(millisPart.padEnd(3, '0'), 10);
  if (!Number.isFinite(millis)) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/** 解析 SRT 时间戳：`00:01:02,500`（也接受 `.` 作为毫秒分隔符）。 */
export function parseSrtTimestamp(raw: string): number | null {
  const match = SRT_TIME.exec(raw.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  if (h === undefined || m === undefined || s === undefined || ms === undefined) return null;
  return toMs(Number.parseInt(h, 10), Number.parseInt(m, 10), Number.parseInt(s, 10), ms);
}

/** 解析 WebVTT 时间戳：`01:02.500` 或 `00:01:02.500`。 */
export function parseVttTimestamp(raw: string): number | null {
  const match = SHORT_TIME.exec(raw.trim());
  if (!match) return null;
  const [, h, m, s, ms] = match;
  if (m === undefined || s === undefined || ms === undefined) return null;
  const hours = h === undefined ? 0 : Number.parseInt(h, 10);
  return toMs(hours, Number.parseInt(m, 10), Number.parseInt(s, 10), ms);
}

/** 毫秒 -> `HH:MM:SS.mmm`（用于界面预览与导出） */
export function formatCueTime(totalMs: number): string {
  const safe = Number.isFinite(totalMs) && totalMs > 0 ? Math.floor(totalMs) : 0;
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

/** 毫秒 -> `mm:ss`，用于紧凑列表展示 */
export function formatCueClock(totalMs: number): string {
  const safe = Number.isFinite(totalMs) && totalMs > 0 ? Math.floor(totalMs / 1000) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
