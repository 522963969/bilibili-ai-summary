import { describe, expect, it } from 'vitest';
import { buildFrameCues, parseFrameDescriptions } from '@/core/frames/parse';
import { buildFrameMessages } from '@/core/frames/prompts';
import { FRAME_LIMITS } from '@/core/frames/types';

const times = [0, 15_000, 30_000];

describe('parseFrameDescriptions', () => {
  it('按编号回填我方时间戳，而不是信任模型写的顺序', () => {
    const raw = ['3 | 出现第三章标题', '1 | 开场画面', '2 | 讲师在讲台上'].join('\n');
    const { entries } = parseFrameDescriptions(raw, times, 1);
    expect(entries.map((entry) => entry.tMs)).toEqual([0, 15_000, 30_000]);
    expect(entries[0]?.text).toBe('开场画面');
    expect(entries[2]?.text).toBe('出现第三章标题');
  });

  it('支持常见分隔符与「第N帧」写法', () => {
    const raw = ['第1帧：开场画面', '2. 中间画面', '3、结尾画面'].join('\n');
    const { entries, unmatchedLines } = parseFrameDescriptions(raw, times, 1);
    expect(entries).toHaveLength(3);
    expect(unmatchedLines).toBe(0);
  });

  it('清理 Markdown 列表符号与加粗', () => {
    const raw = ['- **1 | 开场画面**', '* 2 | 中间画面'].join('\n');
    const { entries } = parseFrameDescriptions(raw, times, 1);
    expect(entries[0]?.text).toBe('开场画面');
    expect(entries[1]?.text).toBe('中间画面');
  });

  it('编号越界或重复计入 unmatchedLines，不会错填到别的帧', () => {
    const raw = ['9 | 越界内容', '1 | 正常内容', '1 | 重复内容'].join('\n');
    const { entries, unmatchedLines } = parseFrameDescriptions(raw, times, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tMs).toBe(0);
    expect(unmatchedLines).toBe(2);
  });

  it('空描述与纯空白行被丢弃', () => {
    const raw = ['1 | ', '', '2 | 有效描述'].join('\n');
    const { entries } = parseFrameDescriptions(raw, times, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.text).toBe('有效描述');
  });

  it('超长描述按上限截断', () => {
    const long = '画'.repeat(FRAME_LIMITS.maxEntryChars + 40);
    const { entries } = parseFrameDescriptions(`1 | ${long}`, times, 1);
    expect(entries[0]?.text.length).toBe(FRAME_LIMITS.maxEntryChars + 1);
    expect(entries[0]?.text.endsWith('…')).toBe(true);
  });

  it('完全无法解析时返回空结果而不是抛错', () => {
    const { entries, unmatchedLines } = parseFrameDescriptions('这里没有任何编号信息', times, 1);
    expect(entries).toHaveLength(0);
    expect(unmatchedLines).toBe(1);
  });

  it('批次起始编号不是 1 时能正确对齐', () => {
    const raw = ['7 | 第二批第一张', '8 | 第二批第二张'].join('\n');
    const { entries } = parseFrameDescriptions(raw, [60_000, 75_000], 7);
    expect(entries[0]?.tMs).toBe(60_000);
    expect(entries[1]?.tMs).toBe(75_000);
  });

  /*
   * 以下四个用例守的是「模型不按编号作答」这条真实故障：
   * 整批一个编号都没匹配上时，旧实现直接返回 0 条，
   * 用户看到的是「跑完整段视频没有任何产出」。
   */
  it('整批无编号时按行序对齐，并标记 positional', () => {
    const raw = ['画面一：夜间骑行的第一视角', '画面二：路边停着白色轿车', '画面三：路口亮着绿灯'].join(
      '\n'
    );
    const { entries, positional } = parseFrameDescriptions(raw, times, 1);
    expect(positional).toBe(true);
    expect(entries.map((entry) => entry.tMs)).toEqual([0, 15_000, 30_000]);
    // 「画面一：」这类前缀不应当成描述正文
    expect(entries[0]?.text).toBe('夜间骑行的第一视角');
  });

  it('行数少于帧数时按行序对齐，多出的帧不会错位', () => {
    const { entries, positional } = parseFrameDescriptions('第一段描述\n第二段描述', times, 1);
    expect(positional).toBe(true);
    expect(entries.map((entry) => entry.tMs)).toEqual([0, 15_000]);
  });

  it('只回一行却对应多帧时不做对齐，避免把整段结论挂到第一帧上', () => {
    const { entries, positional } = parseFrameDescriptions('这段视频总体讲的是夜间骑行', times, 1);
    expect(positional).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it('行数超过帧数时不做对齐', () => {
    const raw = ['a描述', 'b描述', 'c描述', 'd描述'].join('\n');
    const { entries, positional } = parseFrameDescriptions(raw, times, 1);
    expect(positional).toBe(false);
    expect(entries).toHaveLength(0);
  });
});

describe('buildFrameCues', () => {
  it('每条覆盖到下一帧，最后一帧延伸到视频结束', () => {
    const cues = buildFrameCues(
      [
        { tMs: 10_000, text: 'A' },
        { tMs: 20_000, text: 'B' }
      ],
      60_000
    );
    expect(cues[0]).toMatchObject({ index: 1, startMs: 10_000, endMs: 20_000 });
    expect(cues[1]).toMatchObject({ index: 2, startMs: 20_000, endMs: 60_000 });
  });

  it('带「[画面]」前缀，与字幕来源可区分', () => {
    const cues = buildFrameCues([{ tMs: 0, text: '开场' }], 10_000);
    expect(cues[0]?.text).toBe('[画面] 开场');
  });

  it('相邻帧时间相同也能得到正的区间长度', () => {
    const cues = buildFrameCues(
      [
        { tMs: 5_000, text: 'A' },
        { tMs: 5_000, text: 'B' }
      ],
      10_000
    );
    expect(cues[0]?.endMs ?? 0).toBeGreaterThan(cues[0]?.startMs ?? 0);
  });

  it('空输入返回空数组', () => {
    expect(buildFrameCues([], 10_000)).toEqual([]);
  });
});

describe('buildFrameMessages', () => {
  it('每帧前标注编号与时间，图片以 data URL 传入', () => {
    const messages = buildFrameMessages(
      [
        { tMs: 0, dataUrl: 'data:image/jpeg;base64,AAA', width: 64, height: 36 },
        { tMs: 65_000, dataUrl: 'data:image/jpeg;base64,BBB', width: 64, height: 36 }
      ],
      { videoTitle: '测试视频', startIndex: 4 }
    );
    const parts = messages[1]?.content;
    expect(Array.isArray(parts)).toBe(true);
    if (!Array.isArray(parts)) return;
    const texts = parts.filter((part) => part.type === 'text').map((part) => part.text);
    expect(texts.some((text) => text.includes('第 4 张') && text.includes('00:00'))).toBe(true);
    expect(texts.some((text) => text.includes('第 5 张') && text.includes('01:05'))).toBe(true);
    const images = parts.filter((part) => part.type === 'image_url');
    expect(images).toHaveLength(2);
  });

  it('系统提示明确禁止编造声音相关内容', () => {
    const messages = buildFrameMessages([], { videoTitle: null, startIndex: 1 });
    expect(String(messages[0]?.content)).toContain('听不到声音');
  });
});
