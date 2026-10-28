/**
 * 把总结结果序列化为 Markdown。
 *
 * 目标是「下载下来就能直接读、直接贴」：带视频来源信息与可点击的时间戳，
 * 章节时间戳指向 B 站对应的播放位置，而不是一串纯文本。
 */

import { SUMMARY_SOURCE_LABELS } from '@/core/summary/types';
import { formatClock, formatDateTime } from '@/core/utils/format';
import { sanitizeFileName } from './naming';
import { oneLine, withTimestamp } from './text';
import type { ExportContext } from './types';

/** 素材单位要跟着来源变，不能让画面识别的结果自称「条字幕」。 */
function entryUnit(ctx: ExportContext): string {
  return ctx.result.source === 'frames' ? '条画面描述' : '条字幕';
}

function buildMetaLines(ctx: ExportContext): string[] {
  const { author, url, result } = ctx;
  const lines: string[] = [`总结依据：${SUMMARY_SOURCE_LABELS[result.source]}`];
  if (author) lines.push(`UP 主：${oneLine(author)}`);
  if (url) lines.push(`视频：${url}`);
  lines.push(`生成：${formatDateTime(result.generatedAt)}`);
  if (result.model) lines.push(`模型：${result.model}`);
  lines.push(`素材：${result.cueCount} ${entryUnit(ctx)} · 分 ${result.chunkCount} 段`);
  return lines;
}

export function buildMarkdown(ctx: ExportContext): string {
  const { result } = ctx;
  const lines: string[] = [];

  lines.push(`# ${oneLine(ctx.title)}`, '');
  for (const meta of buildMetaLines(ctx)) lines.push(`> ${meta}`);
  lines.push('');

  lines.push('## 概述', '', result.overview.trim(), '');

  if (result.highlights.length > 0) {
    lines.push('## 要点', '');
    for (const point of result.highlights) lines.push(`- ${oneLine(point)}`);
    lines.push('');
  }

  if (result.chapters.length > 0) {
    lines.push('## 章节', '');
    for (const chapter of result.chapters) {
      const seconds = Math.floor(chapter.startMs / 1000);
      const clock = formatClock(seconds);
      const heading = oneLine(chapter.title);
      if (ctx.url) {
        lines.push(`### [${clock}](${withTimestamp(ctx.url, seconds)}) ${heading}`);
      } else {
        lines.push(`### ${clock} ${heading}`);
      }
      lines.push('');
      for (const point of chapter.points) lines.push(`- ${oneLine(point)}`);
      lines.push('');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** 文件名：标题 + 固定后缀，标题不可用时回退到视频键。 */
export function buildMarkdownFileName(ctx: ExportContext): string {
  const base = sanitizeFileName(ctx.title, sanitizeFileName(ctx.videoKey ?? '', 'B站视频'));
  return `${base}-AI总结.md`;
}
