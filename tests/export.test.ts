import { describe, expect, it } from 'vitest';
import { buildMarkdown, buildMarkdownFileName } from '@/core/export/markdown';
import { buildMubuOutline } from '@/core/export/mubu';
import { sanitizeFileName } from '@/core/export/naming';
import { buildSubtitleFileName, buildSubtitleText } from '@/core/export/subtitle';
import { oneLine, splitSentences, withTimestamp } from '@/core/export/text';
import type { ExportContext } from '@/core/export/types';
import type { SummaryResult } from '@/core/summary/types';
import type { NormalizedSubtitle } from '@/core/subtitle/types';

const RESULT: SummaryResult = {
  overview: '这期视频讲了如何用分块策略总结长视频。重点在于重叠窗口。最后给出取舍建议。',
  highlights: ['单块上限 8000 tokens', '重叠 30 秒避免切断句子'],
  chapters: [
    { title: '为什么要分块', startMs: 35_000, endMs: 96_000, points: ['模型上下文有限'] },
    { title: '参数怎么取\n与实测', startMs: 3_725_000, endMs: null, points: [] }
  ],
  source: 'subtitle',
  generatedAt: new Date(2026, 9, 27, 16, 20).getTime(),
  model: 'deepseek-v4-flash',
  chunkCount: 3,
  cueCount: 120,
  elapsedMs: 8867
};

function context(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    title: '长视频总结的工程实践',
    author: '某UP主',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    videoKey: 'BV1xx411c7mD',
    result: RESULT,
    ...overrides
  };
}

describe('sanitizeFileName', () => {
  it('替换文件系统不接受的字符但保留中文', () => {
    expect(sanitizeFileName('A/B:C*D?"E"<F>|G')).toBe('A B C D E F G');
    expect(sanitizeFileName('中文标题（含括号）')).toBe('中文标题（含括号）');
  });

  it('换行与制表符压成空格，不把标题撑成多行', () => {
    expect(sanitizeFileName('第一行\n第二行\t第三行')).toBe('第一行 第二行 第三行');
  });

  it('空标题回退到兜底文案', () => {
    expect(sanitizeFileName('   ', 'B站视频')).toBe('B站视频');
    expect(sanitizeFileName('///')).toBe('B站视频');
  });

  it('Windows 保留名加下划线，避免无法保存', () => {
    expect(sanitizeFileName('CON')).toBe('CON_');
    expect(sanitizeFileName('lpt1')).toBe('lpt1_');
  });

  it('超长标题按码点截断，不切碎 emoji', () => {
    const name = sanitizeFileName('🎬'.repeat(80));
    expect(Array.from(name)).toHaveLength(60);
    expect(name.endsWith('🎬')).toBe(true);
  });
});

describe('withTimestamp', () => {
  it('无查询参数时用 ? 连接', () => {
    expect(withTimestamp('https://www.bilibili.com/video/BV1xx', 35)).toBe(
      'https://www.bilibili.com/video/BV1xx?t=35'
    );
  });

  it('已有分 P 参数时用 & 连接', () => {
    expect(withTimestamp('https://www.bilibili.com/video/BV1xx?p=2', 35)).toBe(
      'https://www.bilibili.com/video/BV1xx?p=2&t=35'
    );
  });

  it('锚点保留在末尾，秒数取整且负数归零', () => {
    expect(withTimestamp('https://a.test/v#part', 12.9)).toBe('https://a.test/v?t=12#part');
    expect(withTimestamp('https://a.test/v', -5)).toBe('https://a.test/v?t=0');
  });
});

describe('splitSentences', () => {
  it('按中文句末标点切分并保留标点', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？']);
  });

  it('换行也视作句子边界', () => {
    expect(splitSentences('一行\n另一行')).toEqual(['一行', '另一行']);
  });

  it('超过上限时合并剩余句子而不是丢弃', () => {
    const text = '一。二。三。四。五。';
    const parts = splitSentences(text, 3);
    expect(parts).toHaveLength(3);
    expect(parts.at(-1)).toContain('三。四。五。');
  });

  it('空白输入返回空数组', () => {
    expect(splitSentences('   \n ')).toEqual([]);
  });
});

describe('oneLine', () => {
  it('把多行压成一行并收敛多余空格', () => {
    expect(oneLine('  a\n b   c  ')).toBe('a b c');
  });
});

describe('buildMarkdown', () => {
  it('包含标题、来源、元信息与三段正文', () => {
    const md = buildMarkdown(context());
    expect(md.startsWith('# 长视频总结的工程实践\n')).toBe(true);
    expect(md).toContain('> 总结依据：字幕');
    expect(md).toContain('> UP 主：某UP主');
    expect(md).toContain('> 视频：https://www.bilibili.com/video/BV1xx411c7mD');
    expect(md).toContain('> 模型：deepseek-v4-flash');
    expect(md).toContain('> 素材：120 条字幕 · 分 3 段');
    expect(md).toContain('## 概述');
    expect(md).toContain('## 要点');
    expect(md).toContain('- 单块上限 8000 tokens');
    expect(md).toContain('## 章节');
  });

  it('章节标题带可点击时间戳，秒数与毫秒对应', () => {
    const md = buildMarkdown(context());
    expect(md).toContain('### [00:35](https://www.bilibili.com/video/BV1xx411c7mD?t=35) 为什么要分块');
    // 1 小时以上的时间戳要带小时位
    expect(md).toContain('[1:02:05]');
  });

  it('章节标题里的换行被压平，不会破坏标题层级', () => {
    const md = buildMarkdown(context());
    expect(md).toContain('### [1:02:05](https://www.bilibili.com/video/BV1xx411c7mD?t=3725) 参数怎么取 与实测');
  });

  it('缺少链接时不生成 Markdown 链接，只留纯文本时间戳', () => {
    const md = buildMarkdown(context({ url: null }));
    expect(md).toContain('### 00:35 为什么要分块');
    expect(md).not.toContain('](http');
  });

  it('画面来源的素材单位写成「条画面描述」', () => {
    const md = buildMarkdown(
      context({ result: { ...RESULT, source: 'frames', cueCount: 70 } })
    );
    expect(md).toContain('> 总结依据：画面识别');
    expect(md).toContain('> 素材：70 条画面描述 · 分 3 段');
    expect(md).not.toContain('条字幕');
  });

  it('没有要点与章节时不留空标题', () => {
    const md = buildMarkdown(
      context({ result: { ...RESULT, highlights: [], chapters: [] } })
    );
    expect(md).not.toContain('## 要点');
    expect(md).not.toContain('## 章节');
    expect(md).toContain('## 概述');
  });

  it('缺少模型名时不写空的模型行', () => {
    const md = buildMarkdown(context({ result: { ...RESULT, model: null } }));
    expect(md).not.toContain('> 模型：');
  });

  it('以单个换行结尾，避免文件末尾出现空行堆叠', () => {
    const md = buildMarkdown(context());
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });
});

describe('buildMarkdownFileName', () => {
  it('标题加固定后缀', () => {
    expect(buildMarkdownFileName(context())).toBe('长视频总结的工程实践-AI总结.md');
  });

  it('标题不可用时回退到视频键', () => {
    expect(buildMarkdownFileName(context({ title: '   ' }))).toBe('BV1xx411c7mD-AI总结.md');
  });

  it('标题与视频键都不可用时用通用文案', () => {
    expect(buildMarkdownFileName(context({ title: '', videoKey: null }))).toBe('B站视频-AI总结.md');
  });
});

describe('buildMubuOutline', () => {
  function levels(outline: string): Array<{ depth: number; text: string }> {
    return outline.split('\n').map((line) => {
      const tabs = line.match(/^\t*/)?.[0].length ?? 0;
      return { depth: tabs, text: line.slice(tabs) };
    });
  }

  it('第一行是无缩进的文档标题', () => {
    const rows = levels(buildMubuOutline(context()));
    expect(rows[0]).toEqual({ depth: 0, text: '长视频总结的工程实践' });
  });

  it('元信息、概述、要点、章节都是一级节点', () => {
    const rows = levels(buildMubuOutline(context()));
    const top = rows.filter((row) => row.depth === 1).map((row) => row.text);
    expect(top).toContain('概述');
    expect(top).toContain('要点');
    expect(top).toContain('章节');
    expect(top.some((text) => text.startsWith('链接：'))).toBe(true);
  });

  it('概述按句拆成二级节点', () => {
    const rows = levels(buildMubuOutline(context()));
    const overviewIndex = rows.findIndex((row) => row.depth === 1 && row.text === '概述');
    const children = rows.slice(overviewIndex + 1).filter((row) => row.depth === 2);
    expect(children.slice(0, 3).map((row) => row.text)).toEqual([
      '这期视频讲了如何用分块策略总结长视频。',
      '重点在于重叠窗口。',
      '最后给出取舍建议。'
    ]);
  });

  it('章节节点带时间戳，要点挂在章节下（三级）', () => {
    const rows = levels(buildMubuOutline(context()));
    const chapterIndex = rows.findIndex((row) => row.depth === 1 && row.text === '章节');
    const chapterRows = rows.slice(chapterIndex + 1);
    expect(chapterRows[0]).toEqual({ depth: 2, text: '00:35 为什么要分块' });
    expect(chapterRows[1]).toEqual({ depth: 3, text: '模型上下文有限' });
    expect(chapterRows[2]?.text).toBe('1:02:05 参数怎么取 与实测');
  });

  it('缺少链接时不输出链接节点', () => {
    const outline = buildMubuOutline(context({ url: null }));
    expect(outline).not.toContain('链接：');
  });

  it('画面来源标注为画面识别，素材单位一致', () => {
    const outline = buildMubuOutline(
      context({ result: { ...RESULT, source: 'frames', cueCount: 70 } })
    );
    expect(outline).toContain('总结依据：画面识别');
    expect(outline).toContain('素材：70 条画面描述');
  });

  it('没有要点时不留空的「要点」节点', () => {
    const outline = buildMubuOutline(context({ result: { ...RESULT, highlights: [] } }));
    expect(outline.split('\n').some((line) => line.trim() === '要点')).toBe(false);
  });
});

describe('buildSubtitleText', () => {
  const subtitle: NormalizedSubtitle = {
    videoKey: 'BV1xx411c7mD#p1',
    trackId: 't1',
    lang: 'zh-CN',
    label: '中文（自动生成）',
    source: 'bilibili',
    format: 'srt',
    cues: [
      { index: 1, startMs: 0, endMs: 2500, text: '第一句' },
      { index: 2, startMs: 3000, endMs: 6000, text: '第二句\n被换行拆开' }
    ],
    stats: { cueCount: 2, totalDurationMs: 6000, repairedCues: 0, droppedCues: 0 },
    createdAt: 0
  };

  const ctx = {
    title: '测试视频',
    url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    videoKey: 'BV1xx411c7mD#p1',
    subtitle
  };

  it('头部写来源与规模，正文一行一条带时间戳', () => {
    const text = buildSubtitleText(ctx);
    const lines = text.split('\n');
    expect(lines[0]).toBe('测试视频');
    expect(lines[1]).toBe('视频：https://www.bilibili.com/video/BV1xx411c7mD');
    expect(lines[2]).toBe('字幕来源：B 站字幕（中文（自动生成））');
    expect(lines[3]).toBe('共 2 条 · 6 秒');
    expect(text).toContain('[00:00] 第一句');
    expect(text).toContain('[00:03] 第二句 被换行拆开');
  });

  it('单条字幕内的换行被压平，保证一行一条', () => {
    const text = buildSubtitleText(ctx);
    const bodyLines = text.split('\n').filter((line) => line.startsWith('['));
    expect(bodyLines).toHaveLength(2);
  });

  it('导入来源显示文件名', () => {
    const text = buildSubtitleText({
      ...ctx,
      subtitle: { ...subtitle, source: 'import', importedFileName: 'demo.srt' }
    });
    expect(text).toContain('字幕来源：本地导入（demo.srt）');
  });

  it('缺失链接时不输出视频行', () => {
    const text = buildSubtitleText({ ...ctx, url: null });
    expect(text).not.toContain('视频：');
  });

  it('文件名是标题加固定后缀', () => {
    expect(buildSubtitleFileName(ctx)).toBe('测试视频-字幕.txt');
  });
});
