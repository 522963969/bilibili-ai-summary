import type { MindMapLayout, MindNode, PositionedNode } from './types';
import { MINDMAP_LIMITS } from './types';

/**
 * 估算一个字符占多少「字宽单位」。
 *
 * 中文、全角标点按 1 计，ASCII 按 0.55 计——不需要真的测量字体，
 * 只要保证「盒子比文字略宽」，不会出现文字压到边框上。
 */
function charUnits(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  // CJK 统一表意文字、全角标点、假名、谚文
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) {
    return 1;
  }
  return 0.55;
}

function unitsOf(text: string): number {
  let sum = 0;
  for (const char of text) sum += charUnits(char);
  return sum;
}

/**
 * 按字宽单位折行。
 *
 * 中文没有空格可断，只能按字符断；但英文单词、数字、URL 不能从中间切开，
 * 因此遇到 ASCII 连续段时回退到最近的空格。行数超上限后截断并补省略号。
 */
export function wrapLabel(
  text: string,
  // 显式标 number：MINDMAP_LIMITS 是 as const，直接用它做默认值会把参数窄化成字面量 17
  maxUnits: number = MINDMAP_LIMITS.maxLineUnits,
  maxLines: number = MINDMAP_LIMITS.maxLines
): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return [''];

  const chars = Array.from(normalized);
  const lines: string[] = [];
  let current = '';
  let currentUnits = 0;

  const pushLine = (): void => {
    lines.push(current);
    current = '';
    currentUnits = 0;
  };

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i]!;
    const unit = charUnits(char);

    if (currentUnits + unit > maxUnits && current.length > 0) {
      // 正好落在 ASCII 单词中间时，回退到最近的空格，避免把单词劈成两半
      const lastSpace = current.lastIndexOf(' ');
      const isAsciiWord = /[A-Za-z0-9]/.test(char) && /[A-Za-z0-9]$/.test(current);
      if (isAsciiWord && lastSpace > 0) {
        const carry = current.slice(lastSpace + 1);
        current = current.slice(0, lastSpace);
        pushLine();
        current = carry;
        currentUnits = unitsOf(carry);
      } else {
        pushLine();
      }
    }

    current += char;
    currentUnits += unit;
  }
  if (current.length > 0) pushLine();

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? '';
  // 截断行也要保证不超过最大宽度：逐字回退再补省略号
  let trimmed = last;
  while (trimmed.length > 1 && unitsOf(`${trimmed}…`) > maxUnits) {
    trimmed = trimmed.slice(0, -1);
  }
  kept[maxLines - 1] = `${trimmed}…`;
  return kept;
}

interface Measured {
  node: MindNode;
  depth: number;
  parentId: string | null;
  lines: string[];
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * 横向树布局：根在左，层级向右展开，同层节点垂直排列。
 *
 * 父节点在子节点的垂直中线上——这样连线不会交叉，读起来是「一个主题分出几条」，
 * 而不是一张需要从中心向外找方向的放射图。窄面板里横向树也更容易滚动。
 */
export function layoutMindMap(root: MindNode): MindMapLayout {
  const { margin, gapX, gapY, paddingX, paddingY, lineHeight } = MINDMAP_LIMITS;

  const measured: Measured[] = [];
  const maxWidthByDepth: number[] = [];

  const measure = (node: MindNode, depth: number, parentId: string | null): Measured => {
    const lines = wrapLabel(node.label);
    const textUnits = Math.max(...lines.map((line) => unitsOf(line)), 1);
    const fontSize = depth === 0 ? MINDMAP_LIMITS.rootFontSize : MINDMAP_LIMITS.fontSize;
    const width = Math.round(textUnits * fontSize + paddingX * 2);
    // meta 单独占一行，否则会把正文挤在一起
    const metaExtra = node.meta ? MINDMAP_LIMITS.metaLineHeight : 0;
    const height = Math.round(lines.length * lineHeight + paddingY * 2 + metaExtra);
    const item: Measured = { node, depth, parentId, lines, width, height, x: 0, y: 0 };
    measured.push(item);
    maxWidthByDepth[depth] = Math.max(maxWidthByDepth[depth] ?? 0, width);
    for (const child of node.children) measure(child, depth + 1, node.id);
    return item;
  };

  const rootItem = measure(root, 0, null);

  // 每一列的 x 由「前面各列的最大宽度」累加得到，保证同层左对齐、列间不重叠
  const xs: number[] = [];
  let cursorX = margin;
  for (let depth = 0; depth < maxWidthByDepth.length; depth += 1) {
    xs[depth] = cursorX;
    cursorX += (maxWidthByDepth[depth] ?? 0) + gapX;
  }

  const byId = new Map<string, Measured>(measured.map((item) => [item.node.id, item]));
  const childIds = new Map<string | null, string[]>();
  for (const item of measured) {
    if (item.parentId === null) continue;
    const list = childIds.get(item.parentId) ?? [];
    list.push(item.node.id);
    childIds.set(item.parentId, list);
  }

  let cursorY = margin;
  const assignY = (item: Measured): void => {
    item.x = xs[item.depth] ?? margin;
    const kids = (childIds.get(item.node.id) ?? [])
      .map((id) => byId.get(id))
      .filter((kid): kid is Measured => Boolean(kid));

    if (kids.length === 0) {
      item.y = cursorY;
      cursorY += item.height + gapY;
      return;
    }

    for (const kid of kids) assignY(kid);
    const first = kids[0]!;
    const last = kids[kids.length - 1]!;
    // 父节点对齐到子节点整体的垂直中线
    item.y = Math.round((first.y + (last.y + last.height)) / 2 - item.height / 2);
  };

  assignY(rootItem);

  const nodes: PositionedNode[] = measured.map((item) => ({
    id: item.node.id,
    depth: item.depth,
    lines: item.lines,
    // meta 只给章节这类有明确时间点的节点用，根节点与叶子不画
    meta: item.node.meta,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    parentId: item.parentId
  }));

  /**
   * 收尾按「所有节点的实际包围盒」定画布，并把越界的部分平移回来。
   *
   * 父节点对齐到子节点中线后，可能比第一个子节点的 y 还高（父节点文字特别多时），
   * 那就会超出上边界；只按 cursorY 算高度会把它裁掉。
   */
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const shiftX = minX < margin ? margin - minX : 0;
  const shiftY = minY < margin ? margin - minY : 0;
  if (shiftX !== 0 || shiftY !== 0) {
    for (const node of nodes) {
      node.x += shiftX;
      node.y += shiftY;
    }
  }

  const maxRight = Math.max(...nodes.map((node) => node.x + node.width));
  const maxBottom = Math.max(...nodes.map((node) => node.y + node.height));

  return {
    nodes,
    width: Math.ceil(maxRight + margin),
    height: Math.ceil(maxBottom + margin)
  };
}
