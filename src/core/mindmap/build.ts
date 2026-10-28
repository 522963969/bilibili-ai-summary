import type { SummaryResult } from '@/core/summary/types';
import { formatClock } from '@/core/utils/format';
import type { MindNode } from './types';

/**
 * 把总结结果转成思维导图树。
 *
 * 结构固定为三层，且**每一层都来自结果里真实存在的字段**：
 *
 *   视频标题
 *   ├─ 知识点        ← highlights
 *   └─ 章节（时间点） ← chapters[].title
 *      └─ 该章要点    ← chapters[].points
 *
 * 不做「把概述拆句当分支」这类加工：那会把模型的一段话切成语义不完整的碎片，
 * 看起来更丰富，实际更难读，也容易让人以为是原文里逐条列出的观点。
 */
export function buildMindTree(
  result: SummaryResult,
  options: { title: string }
): MindNode {
  const children: MindNode[] = [];

  if (result.highlights.length > 0) {
    children.push({
      id: 'highlights',
      label: '知识点',
      children: result.highlights.map((text, index) => ({
        id: `highlight-${index}`,
        label: text,
        children: []
      }))
    });
  }

  for (const [index, chapter] of result.chapters.entries()) {
    children.push({
      id: `chapter-${index}`,
      label: chapter.title,
      meta: formatClock(Math.round(chapter.startMs / 1000)),
      children: chapter.points.map((point, pi) => ({
        id: `chapter-${index}-point-${pi}`,
        label: point,
        children: []
      }))
    });
  }

  // 兜底：旧快照或模型只给了概述时，至少把概述放上去，避免渲染出一张只有一个根节点的空图
  if (children.length === 0) {
    children.push({
      id: 'overview',
      label: result.overview,
      children: []
    });
  }

  return {
    id: 'root',
    label: options.title,
    children
  };
}
