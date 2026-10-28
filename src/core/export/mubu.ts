/**
 * 把总结结果序列化为幕布大纲文本。
 *
 * 幕布（mubu.com）没有公开的写入 API，因此「导入」只能通过它支持的两条真实路径：
 * 1) 粘贴带缩进的纯文本，幕布按缩进生成层级（本文件输出的就是这段文本）；
 * 2) 导入它支持的 Xmind / Freemind / OPML / Markdown 文件。
 *
 * 这里用制表符缩进：幕布编辑器里 Tab 就是「降一级」，粘贴多行制表符缩进的文本
 * 会保留层级。不使用空格缩进，因为不同客户端对空格数量的解释不一致。
 */

import { SUMMARY_SOURCE_LABELS } from '@/core/summary/types';
import { formatClock } from '@/core/utils/format';
import { oneLine, splitSentences } from './text';
import type { ExportContext } from './types';

const INDENT_UNIT = '\t';

function node(level: number, text: string): string {
  return `${INDENT_UNIT.repeat(level)}${text}`;
}

export function buildMubuOutline(ctx: ExportContext): string {
  const { author, url, result } = ctx;
  const lines: string[] = [];

  // 根节点就是文档标题：粘贴到幕布空文档时，第一行会成为第一个主题
  lines.push(oneLine(ctx.title));

  if (url) lines.push(node(1, `链接：${url}`));
  if (author) lines.push(node(1, `UP 主：${oneLine(author)}`));
  lines.push(node(1, `总结依据：${SUMMARY_SOURCE_LABELS[result.source]}`));
  lines.push(
    node(1, `素材：${result.cueCount} ${result.source === 'frames' ? '条画面描述' : '条字幕'}`)
  );

  const overviewSentences = splitSentences(result.overview);
  if (overviewSentences.length > 0) {
    lines.push(node(1, '概述'));
    for (const sentence of overviewSentences) lines.push(node(2, sentence));
  }

  if (result.highlights.length > 0) {
    lines.push(node(1, '要点'));
    for (const point of result.highlights) lines.push(node(2, oneLine(point)));
  }

  if (result.chapters.length > 0) {
    lines.push(node(1, '章节'));
    for (const chapter of result.chapters) {
      const clock = formatClock(Math.floor(chapter.startMs / 1000));
      lines.push(node(2, `${clock} ${oneLine(chapter.title)}`));
      for (const point of chapter.points) lines.push(node(3, oneLine(point)));
    }
  }

  return lines.join('\n');
}
