import { AppError } from '@/core/errors/app-error';
import type { SummaryChapter } from './types';

/** 解析 `mm:ss` 或 `hh:mm:ss` 形式的时间标记，失败返回 null。 */
export function parseClockToMs(raw: string): number | null {
  const text = raw.trim();
  const match = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})$/.exec(text);
  if (!match) return null;
  const [, h, m, s] = match;
  if (m === undefined || s === undefined) return null;
  const hours = h === undefined ? 0 : Number.parseInt(h, 10);
  const minutes = Number.parseInt(m, 10);
  const seconds = Number.parseInt(s, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

/**
 * 从模型输出中提取 JSON 对象。
 * 兼容 ```json 代码块与前后夹带说明文字的情况，不对内容做任何修补。
 */
export function extractJsonObject(raw: string): unknown {
  const withoutFence = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (match) => (match.includes('```') ? '' : match))
    .replace(/```[\s\S]*$/, '');
  const source = withoutFence.trim().length > 0 ? withoutFence : raw;

  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new AppError('E_MODEL_OUTPUT_INVALID', {
      message: '模型没有返回 JSON 结构',
      details: raw.slice(0, 200)
    });
  }
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch (error) {
    throw new AppError('E_MODEL_OUTPUT_INVALID', {
      message: '模型返回的 JSON 无法解析',
      details: `${error instanceof Error ? error.message : String(error)} · ${raw.slice(0, 160)}`
    });
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readString(item))
    .filter((item) => item.length > 0)
    .slice(0, limit);
}

export interface ParsedMergeOutput {
  overview: string;
  highlights: string[];
  chapters: SummaryChapter[];
}

/**
 * 解析归并阶段输出。
 * 章节缺时间或时间非法时保留章节但把 startMs 记为 0，
 * 由调用方决定是否过滤，避免整段结果因一个字段报废。
 */
export function parseMergeOutput(raw: string): ParsedMergeOutput {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AppError('E_MODEL_OUTPUT_INVALID', { message: '模型返回的不是 JSON 对象' });
  }
  const record = parsed as Record<string, unknown>;

  const overview = readString(record.overview);
  const highlights = readStringArray(record.highlights, 8);

  const rawChapters = Array.isArray(record.chapters) ? record.chapters : [];
  const chapters: SummaryChapter[] = [];
  for (const item of rawChapters) {
    if (typeof item !== 'object' || item === null) continue;
    const chapter = item as Record<string, unknown>;
    const title = readString(chapter.title);
    if (title.length === 0) continue;
    const startText = readString(chapter.start);
    const startMs = startText.length > 0 ? (parseClockToMs(startText) ?? 0) : 0;
    chapters.push({
      title,
      startMs,
      endMs: null,
      points: readStringArray(chapter.points, 5)
    });
  }

  if (overview.length === 0 && chapters.length === 0) {
    throw new AppError('E_MODEL_OUTPUT_INVALID', {
      message: '模型返回的总结缺少概述与章节',
      details: raw.slice(0, 200)
    });
  }

  // 按时间排序并用下一章起点补齐上一章结束时间，保证点击章节能定位到区间
  chapters.sort((a, b) => a.startMs - b.startMs);
  chapters.forEach((chapter, index) => {
    const next = chapters[index + 1];
    chapter.endMs = next ? next.startMs : null;
  });

  return { overview, highlights, chapters };
}
