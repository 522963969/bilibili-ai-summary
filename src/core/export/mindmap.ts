import { SUMMARY_SOURCE_LABELS } from '@/core/summary/types';
import { buildMindTree } from '@/core/mindmap/build';
import { layoutMindMap } from '@/core/mindmap/layout';
import { renderMindMapSvg, type MindMapTheme } from '@/core/mindmap/svg';
import { formatDateTime } from '@/core/utils/format';
import { sanitizeFileName } from './naming';
import type { ExportContext } from './types';

export interface MindMapArtifact {
  svg: string;
  width: number;
  height: number;
}

export interface MindMapBuildOptions {
  theme?: MindMapTheme;
}

/**
 * 由总结结果生成思维导图 SVG。
 *
 * 附带一行来源水印（字幕 / 画面识别 · 生成时间 · UP 主）：
 * 导图会被单独导出成图片传播，脱离原页面后就没人知道它依据什么素材生成，
 * 把来源焊在图上是唯一能跟着图走的证据。
 */
export function buildMindMapSvg(
  ctx: ExportContext,
  options: MindMapBuildOptions = {}
): MindMapArtifact {
  const tree = buildMindTree(ctx.result, { title: ctx.title });
  const layout = layoutMindMap(tree);

  const footerParts = [
    SUMMARY_SOURCE_LABELS[ctx.result.source],
    formatDateTime(ctx.result.generatedAt)
  ];
  if (ctx.author) footerParts.push(ctx.author);

  const svg = renderMindMapSvg({
    layout,
    theme: options.theme ?? 'light',
    footer: footerParts.join(' · ')
  });

  return { svg, width: layout.width, height: layout.height };
}

/** 与 Markdown 导出一致的命名习惯，只是后缀不同，方便在同一份笔记里配对保存。 */
export function buildMindMapFileName(ctx: ExportContext, ext: 'svg' | 'png'): string {
  const base = sanitizeFileName(ctx.title, sanitizeFileName(ctx.videoKey ?? '', 'B站视频'));
  return `${base}-思维导图.${ext}`;
}
