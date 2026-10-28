/**
 * 把字幕导出为纯文本。
 *
 * 用途是「留档 + 搜索 + 二次加工」：每行一条、带 `[mm:ss]` 前缀，
 * 复制到笔记软件里仍能按时间定位到视频。这里不做任何清洗与改写，
 * 文本就是用户在面板里看到的那些内容。
 */

import type { NormalizedSubtitle } from '@/core/subtitle/types';
import { formatClock, formatDurationHuman } from '@/core/utils/format';
import { sanitizeFileName } from './naming';

export interface SubtitleExportContext {
  title: string;
  url: string | null;
  videoKey: string | null;
  subtitle: NormalizedSubtitle;
}

function sourceLabel(subtitle: NormalizedSubtitle): string {
  if (subtitle.source === 'import') {
    return subtitle.importedFileName
      ? `本地导入（${subtitle.importedFileName}）`
      : '本地导入';
  }
  return `B 站字幕（${subtitle.label || subtitle.lang}）`;
}

export function buildSubtitleText(ctx: SubtitleExportContext): string {
  const { subtitle } = ctx;
  const lines: string[] = [];

  lines.push(ctx.title.trim());
  if (ctx.url) lines.push(`视频：${ctx.url}`);
  lines.push(`字幕来源：${sourceLabel(subtitle)}`);
  lines.push(
    `共 ${subtitle.stats.cueCount} 条 · ${formatDurationHuman(
      Math.round(subtitle.stats.totalDurationMs / 1000)
    )}`
  );
  lines.push('');

  for (const cue of subtitle.cues) {
    // 单条字幕里的换行会破坏「一行一条」的结构，压成空格
    const text = cue.text.replace(/\s*\n+\s*/g, ' ').trim();
    if (text.length === 0) continue;
    lines.push(`[${formatClock(cue.startMs / 1000)}] ${text}`);
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function buildSubtitleFileName(ctx: SubtitleExportContext): string {
  const base = sanitizeFileName(ctx.title, sanitizeFileName(ctx.videoKey ?? '', 'B站视频'));
  return `${base}-字幕.txt`;
}
