import { describe, expect, it } from 'vitest';
import { buildMindTree } from '@/core/mindmap/build';
import { layoutMindMap, wrapLabel } from '@/core/mindmap/layout';
import { renderMindMapSvg } from '@/core/mindmap/svg';
import { MINDMAP_LIMITS } from '@/core/mindmap/types';
import type { MindNode } from '@/core/mindmap/types';
import type { SummaryResult } from '@/core/summary/types';

function makeResult(patch: Partial<SummaryResult> = {}): SummaryResult {
  return {
    overview: '这支视频讲了分块总结为什么要按句子切。',
    highlights: ['分块的目标是不超过单次请求预算', '重叠区避免观点被切断'],
    chapters: [
      {
        title: '为什么要分块',
        startMs: 35_000,
        endMs: 120_000,
        points: ['字幕太长会超模型上限', '按时间点切分便于定位']
      },
      {
        title: '重叠区间的作用',
        startMs: 120_000,
        endMs: 300_000,
        points: []
      }
    ],
    source: 'subtitle',
    generatedAt: 1_700_000_000_000,
    model: 'test-model',
    chunkCount: 2,
    cueCount: 40,
    elapsedMs: 12_000,
    ...patch
  };
}

describe('buildMindTree', () => {
  it('知识点来自 highlights，章节带时间点，要点挂在章节下', () => {
    const tree = buildMindTree(makeResult(), { title: '测试视频' });
    expect(tree.id).toBe('root');
    expect(tree.label).toBe('测试视频');

    const highlights = tree.children.find((c) => c.id === 'highlights');
    expect(highlights?.label).toBe('知识点');
    expect(highlights?.children).toHaveLength(2);

    const firstChapter = tree.children.find((c) => c.id === 'chapter-0');
    expect(firstChapter?.label).toBe('为什么要分块');
    // 35 秒 → 00:35
    expect(firstChapter?.meta).toBe('00:35');
    expect(firstChapter?.children).toHaveLength(2);

    const secondChapter = tree.children.find((c) => c.id === 'chapter-1');
    expect(secondChapter?.children).toHaveLength(0);
  });

  it('没有章节也没有要点时，用概述兜底，避免只剩一个根节点', () => {
    const tree = buildMindTree(makeResult({ highlights: [], chapters: [] }), { title: '空结果' });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]?.label).toBe('这支视频讲了分块总结为什么要按句子切。');
  });
});

describe('wrapLabel', () => {
  it('中文按字宽折行，每行不超过上限', () => {
    const lines = wrapLabel('这是一段需要折行的中文说明文字用来测试折行是否按宽度切分', 8, 5);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(8);
  });

  it('不把英文单词劈成两半', () => {
    const lines = wrapLabel('配置 Base URL 与 API Key 之后才能调用模型', 10, 5);
    // 拼回去应当能看到完整的 "Base URL" 与 "API Key"，而不是 "Ba" + "se"
    const joined = lines.join('');
    expect(joined).toContain('Base');
    expect(lines.some((line) => line.endsWith('Ba'))).toBe(false);
  });

  it('超过最大行数时截断并补省略号', () => {
    const lines = wrapLabel('很长很长的一段文字'.repeat(10), 6, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
  });

  it('空白输入返回单个空行而不是空数组', () => {
    expect(wrapLabel('   ')).toEqual(['']);
  });
});

describe('layoutMindMap', () => {
  const layout = layoutMindMap(buildMindTree(makeResult(), { title: '测试视频' }));

  it('根节点在最左，层级越深 x 越大', () => {
    const root = layout.nodes.find((n) => n.id === 'root');
    expect(root?.depth).toBe(0);
    expect(root?.x).toBeGreaterThan(0);

    for (const node of layout.nodes) {
      if (!node.parentId) continue;
      const parent = layout.nodes.find((n) => n.id === node.parentId);
      expect(parent).toBeDefined();
      expect(node.x).toBeGreaterThan(parent!.x);
      expect(node.depth).toBe(parent!.depth + 1);
    }
  });

  it('同层兄弟节点垂直方向不重叠', () => {
    const byDepth = new Map<number, typeof layout.nodes>();
    for (const node of layout.nodes) {
      const list = byDepth.get(node.depth) ?? [];
      list.push(node);
      byDepth.set(node.depth, list);
    }
    for (const list of byDepth.values()) {
      const sorted = [...list].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1]!;
        const cur = sorted[i]!;
        // 同一列里至少留出 gapY 的间距，否则会糊成一片
        expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.height);
      }
    }
  });

  it('画布尺寸包住所有节点且留出外边距', () => {
    const maxRight = Math.max(...layout.nodes.map((n) => n.x + n.width));
    const maxBottom = Math.max(...layout.nodes.map((n) => n.y + n.height));
    const minX = Math.min(...layout.nodes.map((n) => n.x));
    const minY = Math.min(...layout.nodes.map((n) => n.y));
    expect(layout.width).toBeGreaterThanOrEqual(maxRight);
    expect(layout.height).toBeGreaterThanOrEqual(maxBottom);
    expect(minX).toBeGreaterThan(0);
    expect(minY).toBeGreaterThan(0);
  });

  it('正文越多节点越高，meta 额外占一层', () => {
    const tree: MindNode = {
      id: 'root',
      label: '根',
      children: [
        { id: 'short', label: '短', children: [] },
        { id: 'long', label: '很长很长的一段说明文字'.repeat(6), children: [] },
        { id: 'meta', label: '短', meta: '01:23', children: [] }
      ]
    };
    const laid = layoutMindMap(tree);
    const short = laid.nodes.find((n) => n.id === 'short')!;
    const long = laid.nodes.find((n) => n.id === 'long')!;
    const meta = laid.nodes.find((n) => n.id === 'meta')!;

    expect(short.lines).toHaveLength(1);
    expect(long.lines).toHaveLength(MINDMAP_LIMITS.maxLines);
    expect(long.height).toBeGreaterThan(short.height);
    // 同样的文字，多一行 meta 就多出 metaLineHeight
    expect(meta.height - short.height).toBe(MINDMAP_LIMITS.metaLineHeight);
    expect(meta.meta).toBe('01:23');
  });

  it('同样的输入两次布局结果完全一致（导出可复现）', () => {
    const again = layoutMindMap(buildMindTree(makeResult(), { title: '测试视频' }));
    expect(again).toEqual(layout);
  });
});

describe('renderMindMapSvg', () => {
  it('输出独立 SVG，尺寸与布局一致，且不含 foreignObject', () => {
    const tree = buildMindTree(makeResult(), { title: '测试视频' });
    const layout = layoutMindMap(tree);
    const svg = renderMindMapSvg({ layout, theme: 'light', footer: '字幕 · 2026-10-28' });

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${layout.width}"`);
    expect(svg).toContain(`height="${layout.height}"`);
    // PNG 导出靠 Image + canvas 栅格化，foreignObject 在 Chromium 里会渲染成空白
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('测试视频');
    expect(svg).toContain('知识点');
    expect(svg).toContain('00:35');
    expect(svg).toContain('字幕 · 2026-10-28');
  });

  it('转义 XML 特殊字符，避免模型输出里的 & 和 < 破坏 SVG', () => {
    const tree = buildMindTree(
      makeResult({
        highlights: ['A & B <script> 不是标签'],
        chapters: []
      }),
      { title: '标题 & <标签>' }
    );
    const svg = renderMindMapSvg({ layout: layoutMindMap(tree), theme: 'dark' });
    expect(svg).toContain('A &amp; B &lt;script&gt; 不是标签');
    expect(svg).toContain('标题 &amp; &lt;标签&gt;');
    // 原始未转义的小于号会出现在标签里，但不该有 <script>
    expect(svg).not.toContain('<script>');
  });

  it('深色主题用深色背景，浅色主题用白底', () => {
    const layout = layoutMindMap(buildMindTree(makeResult(), { title: 'T' }));
    const light = renderMindMapSvg({ layout, theme: 'light' });
    const dark = renderMindMapSvg({ layout, theme: 'dark' });
    expect(light).toContain('fill="#ffffff"');
    expect(dark).toContain('fill="#1b1e24"');
  });
});
