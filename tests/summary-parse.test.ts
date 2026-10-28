import { describe, expect, it } from 'vitest';
import { buildChatEndpoint } from '@/core/ai/openai-provider';
import { truncateToTokens } from '@/core/summary/orchestrator';
import { extractJsonObject, parseClockToMs, parseMergeOutput } from '@/core/summary/parse';

describe('buildChatEndpoint', () => {
  it('在 /v1 后补全路径', () => {
    expect(buildChatEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
  });

  it('去除末尾斜杠后再拼接', () => {
    expect(buildChatEndpoint('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1/chat/completions'
    );
  });

  it('已填写完整路径时不再重复拼接', () => {
    expect(buildChatEndpoint('https://host/v1/chat/completions')).toBe(
      'https://host/v1/chat/completions'
    );
  });
});

describe('parseClockToMs', () => {
  it('解析 mm:ss 与 hh:mm:ss', () => {
    expect(parseClockToMs('01:05')).toBe(65_000);
    expect(parseClockToMs('1:02:03')).toBe(3_723_000);
    expect(parseClockToMs('00:00')).toBe(0);
  });

  it('非法输入返回 null', () => {
    expect(parseClockToMs('abc')).toBeNull();
    expect(parseClockToMs('01:99')).toBeNull();
    expect(parseClockToMs('')).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('提取被 ```json 包裹的对象', () => {
    const raw = '```json\n{"overview":"测试"}\n```';
    expect(extractJsonObject(raw)).toEqual({ overview: '测试' });
  });

  it('忽略前后夹带的说明文字', () => {
    const raw = '好的，结果如下：{"overview":"测试"} 以上是结果。';
    expect(extractJsonObject(raw)).toEqual({ overview: '测试' });
  });

  it('没有 JSON 时抛出 E_MODEL_OUTPUT_INVALID', () => {
    expect(() => extractJsonObject('完全没有结构')).toThrowError(/JSON/);
  });
});

describe('parseMergeOutput', () => {
  const valid = JSON.stringify({
    overview: '整体概述',
    highlights: ['要点一', '要点二'],
    chapters: [
      { title: '第二章', start: '02:00', points: ['a'] },
      { title: '第一章', start: '00:30', points: ['b', 'c'] }
    ]
  });

  it('解析概述、要点与章节', () => {
    const parsed = parseMergeOutput(valid);
    expect(parsed.overview).toBe('整体概述');
    expect(parsed.highlights).toHaveLength(2);
    expect(parsed.chapters).toHaveLength(2);
  });

  it('章节按时间排序，并用下一章起点补齐结束时间', () => {
    const parsed = parseMergeOutput(valid);
    expect(parsed.chapters[0]?.title).toBe('第一章');
    expect(parsed.chapters[0]?.startMs).toBe(30_000);
    expect(parsed.chapters[0]?.endMs).toBe(120_000);
    expect(parsed.chapters[1]?.endMs).toBeNull();
  });

  it('丢弃缺少标题的章节，保留其余内容', () => {
    const parsed = parseMergeOutput(
      JSON.stringify({ overview: '概述', chapters: [{ start: '00:10' }, { title: '有标题', start: '00:20' }] })
    );
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]?.title).toBe('有标题');
  });

  it('章节时间为空时记为 0 而不是报错', () => {
    const parsed = parseMergeOutput(JSON.stringify({ overview: '概述', chapters: [{ title: '无时间' }] }));
    expect(parsed.chapters[0]?.startMs).toBe(0);
  });

  it('概述与章节都为空时抛错', () => {
    expect(() => parseMergeOutput(JSON.stringify({ overview: '', chapters: [] }))).toThrowError();
  });
});

describe('truncateToTokens', () => {
  it('未超预算时原样返回', () => {
    expect(truncateToTokens('短文本', 100)).toBe('短文本');
  });

  it('超预算时截断并追加省略号', () => {
    const text = '中'.repeat(500);
    const result = truncateToTokens(text, 50);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(51);
  });

  it('预算为 0 时返回空串', () => {
    expect(truncateToTokens('内容', 0)).toBe('');
  });
});
