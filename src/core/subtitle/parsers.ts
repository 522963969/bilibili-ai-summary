import { AppError } from '@/core/errors/app-error';
import { parseSrtTimestamp, parseVttTimestamp } from './timestamp';
import { SUBTITLE_LIMITS, type RawCue, type SubtitleFormat } from './types';

/** 字幕文本解析：SRT / WebVTT / B 站 JSON / 通用 JSON。 */

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function normalizeNewlines(text: string): string {
  return stripBom(text).replace(/\r\n?/g, '\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitBlocks(text: string): string[][] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.split('\n'))
    .filter((lines) => lines.some((line) => line.trim().length > 0));
}

/** 解析 SRT。容忍缺少序号行、毫秒用 `.` 分隔、字幕块中出现空行的异常文件。 */
export function parseSrt(content: string): RawCue[] {
  const text = normalizeNewlines(content);
  const cues: RawCue[] = [];

  for (const lines of splitBlocks(text)) {
    const trimmed = lines.map((line) => line.trim());
    const firstLine = trimmed[0] ?? '';
    const cursor = /^\d+$/.test(firstLine) ? 1 : 0;
    const timingLine = trimmed[cursor] ?? '';
    const arrowIndex = timingLine.indexOf('-->');
    if (arrowIndex < 0) continue;

    const start = parseSrtTimestamp(timingLine.slice(0, arrowIndex));
    const endToken = timingLine.slice(arrowIndex + 3).trim().split(/\s+/)[0] ?? '';
    const end = parseSrtTimestamp(endToken);
    if (start === null || end === null) continue;

    const textLines = trimmed.slice(cursor + 1).filter((line) => line.length > 0);
    if (textLines.length === 0) continue;
    cues.push({ startMs: start, endMs: end, text: textLines.join('\n') });
  }

  return cues;
}

/** 解析 WebVTT。跳过 WEBVTT / NOTE / STYLE / REGION 块，忽略时间戳后的排版设置。 */
export function parseVtt(content: string): RawCue[] {
  const text = normalizeNewlines(content);
  const cues: RawCue[] = [];

  for (const lines of splitBlocks(text)) {
    const first = (lines[0] ?? '').trim();
    if (/^WEBVTT/.test(first)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(first)) continue;

    let timingIndex = -1;
    for (let index = 0; index < Math.min(lines.length, 3); index += 1) {
      if ((lines[index] ?? '').includes('-->')) {
        timingIndex = index;
        break;
      }
    }
    if (timingIndex < 0) continue;

    const timingLine = (lines[timingIndex] ?? '').trim();
    const [left, right] = timingLine.split('-->');
    if (left === undefined || right === undefined) continue;

    const start = parseVttTimestamp(left);
    const endToken = right.trim().split(/\s+/)[0] ?? '';
    const end = parseVttTimestamp(endToken);
    if (start === null || end === null) continue;

    const textLines = lines
      .slice(timingIndex + 1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (textLines.length === 0) continue;
    cues.push({ startMs: start, endMs: end, text: textLines.join('\n') });
  }

  return cues;
}

function pickCueArray(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    if (Array.isArray(data.body)) return data.body;
    if (Array.isArray(data.cues)) return data.cues;
    if (Array.isArray(data.subtitles)) return data.subtitles;
  }
  return null;
}

function readTime(value: unknown, mode: 'seconds' | 'millis'): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return mode === 'seconds' ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return mode === 'seconds' ? Math.round(numeric * 1000) : Math.round(numeric);
    }
    return parseSrtTimestamp(trimmed) ?? parseVttTimestamp(trimmed);
  }
  return null;
}

function readTextField(item: Record<string, unknown>): string {
  const candidates = [item.content, item.text, item.body];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return '';
}

function toRawCue(item: unknown, position: number): RawCue {
  if (!isRecord(item)) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: `第 ${position + 1} 条字幕不是对象`
    });
  }

  // B 站字幕：from / to 以秒为单位
  const hasSecondsShape = typeof item.from === 'number' || typeof item.to === 'number';
  const start = hasSecondsShape
    ? readTime(item.from, 'seconds')
    : item.startMs !== undefined
      ? readTime(item.startMs, 'millis')
      : readTime(item.start, 'millis');
  const end = hasSecondsShape
    ? readTime(item.to, 'seconds')
    : item.endMs !== undefined
      ? readTime(item.endMs, 'millis')
      : readTime(item.end, 'millis');

  if (start === null || end === null) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: `第 ${position + 1} 条字幕缺少可识别的时间字段`,
      details: '支持 {from,to}（秒）、{startMs,endMs}（毫秒）或 {start,end}（毫秒或时间字符串）'
    });
  }

  return { startMs: start, endMs: end, text: readTextField(item) };
}

/** 解析 JSON 字幕：B 站 `{ body: [...] }`、`{ cues: [...] }` 或裸数组。 */
export function parseSubtitleJson(content: string): RawCue[] {
  let data: unknown;
  try {
    data = JSON.parse(stripBom(content));
  } catch (error) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: 'JSON 字幕文件无法解析',
      details: error instanceof Error ? error.message : String(error)
    });
  }

  const items = pickCueArray(data);
  if (!items) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: 'JSON 中未找到字幕条目',
      details: '期望 { body: [...] }、{ cues: [...] } 或字幕数组'
    });
  }
  if (items.length > SUBTITLE_LIMITS.maxCues) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: `字幕条目过多（${items.length}），上限为 ${SUBTITLE_LIMITS.maxCues}`
    });
  }

  return items.map((item, index) => toRawCue(item, index));
}

/** 依据文件名与内容特征判断格式。内容特征优先，文件名兜底。 */
export function detectSubtitleFormat(content: string, fileName?: string): SubtitleFormat | null {
  const head = normalizeNewlines(content).slice(0, 4000);
  if (/^WEBVTT/.test(head.trimStart())) return 'vtt';
  if (/^\s*[{[]/.test(head)) return 'json';
  if (/\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}/.test(head)) {
    return 'srt';
  }

  const extension = fileName?.toLowerCase().split('.').pop();
  if (extension === 'srt') return 'srt';
  if (extension === 'vtt') return 'vtt';
  if (extension === 'json') return 'json';
  return null;
}

export interface ParsedSubtitle {
  format: SubtitleFormat;
  cues: RawCue[];
}

/** 统一入口：识别格式并解析。无法识别或解析失败时抛出 AppError。 */
export function parseSubtitleContent(input: {
  content: string;
  fileName?: string;
  format?: SubtitleFormat;
}): ParsedSubtitle {
  if (input.content.trim().length === 0) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', { message: '字幕内容为空' });
  }

  const format = input.format ?? detectSubtitleFormat(input.content, input.fileName);
  if (!format) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: '无法识别字幕格式',
      details: '支持 .srt、.vtt 与 JSON（B 站 body 结构或通用 cues 数组）'
    });
  }

  const cues =
    format === 'srt'
      ? parseSrt(input.content)
      : format === 'vtt'
        ? parseVtt(input.content)
        : parseSubtitleJson(input.content);

  if (cues.length === 0) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: '未解析出任何字幕条目',
      details: `格式判定为 ${format}`
    });
  }
  if (cues.length > SUBTITLE_LIMITS.maxCues) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: `字幕条目过多（${cues.length}），上限为 ${SUBTITLE_LIMITS.maxCues}`
    });
  }
  return { format, cues };
}
