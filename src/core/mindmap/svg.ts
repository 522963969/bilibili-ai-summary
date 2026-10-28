import type { MindMapLayout, PositionedNode } from './types';
import { MINDMAP_LIMITS } from './types';

export type MindMapTheme = 'light' | 'dark';

interface Palette {
  background: string;
  link: string;
  rootFill: string;
  rootText: string;
  branchFill: string;
  branchStroke: string;
  branchText: string;
  leafFill: string;
  leafStroke: string;
  leafText: string;
  metaText: string;
  footer: string;
}

const PALETTES: Record<MindMapTheme, Palette> = {
  light: {
    background: '#ffffff',
    link: '#e3cdd5',
    rootFill: '#fb7299',
    rootText: '#ffffff',
    branchFill: '#fff1f5',
    branchStroke: '#f7bfd0',
    branchText: '#1f2329',
    leafFill: '#f8f9fb',
    leafStroke: '#e3e5e7',
    leafText: '#2f3540',
    metaText: '#c2607e',
    footer: '#9aa1ab'
  },
  dark: {
    background: '#1b1e24',
    link: '#4d3b42',
    rootFill: '#fb7299',
    rootText: '#ffffff',
    branchFill: '#3a2630',
    branchStroke: '#6d4350',
    branchText: '#f2f3f5',
    leafFill: '#24272e',
    leafStroke: '#3a3d45',
    leafText: '#dfe2e7',
    metaText: '#f0a8bd',
    footer: '#6b717b'
  }
};

const FONT_STACK =
  "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

/** XML 文本转义：节点内容来自模型输出，出现 `&` / `<` 会直接让 SVG 解析失败。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function styleOf(node: PositionedNode, palette: Palette): {
  fill: string;
  stroke: string;
  text: string;
  fontSize: number;
  bold: boolean;
} {
  if (node.depth === 0) {
    return {
      fill: palette.rootFill,
      stroke: palette.rootFill,
      text: palette.rootText,
      fontSize: MINDMAP_LIMITS.rootFontSize,
      bold: true
    };
  }
  if (node.depth === 1) {
    return {
      fill: palette.branchFill,
      stroke: palette.branchStroke,
      text: palette.branchText,
      fontSize: MINDMAP_LIMITS.fontSize,
      bold: true
    };
  }
  return {
    fill: palette.leafFill,
    stroke: palette.leafStroke,
    text: palette.leafText,
    fontSize: MINDMAP_LIMITS.fontSize,
    bold: false
  };
}

export interface MindMapSvgOptions {
  layout: MindMapLayout;
  theme?: MindMapTheme;
  /** 右下角水印文案，例如「字幕 · 2026-10-28」 */
  footer?: string;
}

/**
 * 把布局渲染成独立 SVG 字符串。
 *
 * 只用 rect / path / text 三种元素，不用 foreignObject —— 因为 PNG 导出靠
 * `Image` + `canvas.drawImage` 栅格化，Chromium 对 SVG 里的 foreignObject
 * 会静默丢内容，画出来是一片空白。
 */
export function renderMindMapSvg(options: MindMapSvgOptions): string {
  const { layout, theme = 'light', footer } = options;
  const palette = PALETTES[theme];
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
      `viewBox="0 0 ${layout.width} ${layout.height}" font-family="${FONT_STACK}">`
  );
  parts.push(`<rect width="${layout.width}" height="${layout.height}" fill="${palette.background}"/>`);

  // 先画连线，后画节点，避免线压在文字上
  for (const node of layout.nodes) {
    if (!node.parentId) continue;
    const parent = byId.get(node.parentId);
    if (!parent) continue;
    const x1 = parent.x + parent.width;
    const y1 = parent.y + parent.height / 2;
    const x2 = node.x;
    const y2 = node.y + node.height / 2;
    const midX = (x1 + x2) / 2;
    parts.push(
      `<path d="M${x1} ${y1} C${midX} ${y1} ${midX} ${y2} ${x2} ${y2}" ` +
        `fill="none" stroke="${palette.link}" stroke-width="1.4" stroke-linecap="round"/>`
    );
  }

  for (const node of layout.nodes) {
    const style = styleOf(node, palette);
    const radius = node.depth === 0 ? 10 : 7;
    parts.push(
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" ` +
        `rx="${radius}" ry="${radius}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="1"/>`
    );

    const { paddingX, paddingY, lineHeight } = MINDMAP_LIMITS;
    const textX = node.x + paddingX;
    node.lines.forEach((line, index) => {
      const baseline = node.y + paddingY + lineHeight * index + lineHeight / 2;
      parts.push(
        `<text x="${textX}" y="${Math.round(baseline)}" font-size="${style.fontSize}" ` +
          `font-weight="${style.bold ? 600 : 400}" fill="${style.text}" ` +
          `dominant-baseline="central">${escapeXml(line)}</text>`
      );
    });

    if (node.meta) {
      // 时间点画在正文下方单独一行（布局已为它预留 metaLineHeight）
      parts.push(
        `<text x="${textX}" y="${node.y + node.height - paddingY - 3}" ` +
          `font-size="10" fill="${palette.metaText}" dominant-baseline="auto">` +
          `${escapeXml(node.meta)}</text>`
      );
    }
  }

  if (footer) {
    parts.push(
      `<text x="${MINDMAP_LIMITS.margin}" y="${layout.height - 8}" font-size="10" ` +
        `fill="${palette.footer}">${escapeXml(footer)}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

/** 面板预览用的 data URL；`#` 等字符必须编码，否则 SVG 会在第一个井号处被截断。 */
export function toSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
