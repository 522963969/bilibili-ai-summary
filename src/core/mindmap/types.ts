/**
 * 思维导图领域类型。
 *
 * 这里刻意只描述「节点与几何」，不掺任何 DOM：布局与 SVG 渲染都是纯函数，
 * 这样既能单测，也能在面板、导出、以后的图片生成里共用同一套坐标。
 */

export interface MindNode {
  id: string;
  /** 节点正文，长文本由布局阶段折行 */
  label: string;
  /** 节点右下角的小字，例如章节起始时间 12:34 */
  meta?: string;
  children: MindNode[];
}

export interface PositionedNode {
  id: string;
  depth: number;
  /** 已折好行的文本，渲染时逐行画 */
  lines: string[];
  meta?: string;
  /** 盒子左上角坐标 */
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

export interface MindMapLayout {
  nodes: PositionedNode[];
  width: number;
  height: number;
}

/** 布局参数集中在此，测试与渲染共用同一份，避免「测的是一套、画的是另一套」。 */
export const MINDMAP_LIMITS = {
  /** 单行最多容纳的「字宽单位」：汉字 1，ASCII 约 0.55 */
  maxLineUnits: 17,
  /** 节点最多显示几行，超出用省略号，防止一条长要点把图撑爆 */
  maxLines: 3,
  fontSize: 12.5,
  rootFontSize: 14,
  lineHeight: 18,
  paddingX: 11,
  paddingY: 8,
  /** 列间距，同时给连线留出弯折空间 */
  gapX: 46,
  /** 同列节点之间的垂直间距 */
  gapY: 11,
  /** 有 meta（章节时间点）的节点，在正文下方额外留出的高度 */
  metaLineHeight: 13,
  /** 画布四周留白 */
  margin: 22
} as const;
