import { describe, expect, it } from 'vitest';
import {
  extractHostName,
  formatClock,
  formatDateTime,
  formatDurationHuman,
  maskSecret
} from '@/core/utils/format';
import { parseClockText } from '@/content/page-context';
import { normalizeTabTitle } from '@/background/handlers/video';

describe('formatClock', () => {
  it('格式化分秒与时分秒', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(75)).toBe('01:15');
    expect(formatClock(3661)).toBe('1:01:01');
  });

  it('非法输入返回占位符', () => {
    expect(formatClock(null)).toBe('--:--');
    expect(formatClock(Number.NaN)).toBe('--:--');
    expect(formatClock(-10)).toBe('--:--');
  });
});

describe('formatDurationHuman', () => {
  it('输出中文时长', () => {
    expect(formatDurationHuman(45)).toBe('45 秒');
    expect(formatDurationHuman(90)).toBe('1 分 30 秒');
    expect(formatDurationHuman(3600)).toBe('1 小时');
    expect(formatDurationHuman(4380)).toBe('1 小时 13 分');
  });

  it('缺失时长时标注未知', () => {
    expect(formatDurationHuman(0)).toBe('未知时长');
    expect(formatDurationHuman(null)).toBe('未知时长');
  });
});

describe('formatDateTime', () => {
  it('无记录时提示未记录', () => {
    expect(formatDateTime(0)).toBe('未记录');
    expect(formatDateTime(null)).toBe('未记录');
  });

  it('输出到分钟精度', () => {
    const timestamp = new Date(2024, 0, 2, 3, 4, 5).getTime();
    expect(formatDateTime(timestamp)).toBe('2024-01-02 03:04');
  });
});

describe('maskSecret', () => {
  it('保留首尾四位并隐藏中段', () => {
    const masked = maskSecret('sk-1234567890abcdef');
    expect(masked.startsWith('sk-1')).toBe(true);
    expect(masked.endsWith('cdef')).toBe(true);
    expect(masked).not.toContain('567890ab');
  });

  it('短密钥整体打码', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('')).toBe('');
  });
});

describe('extractHostName', () => {
  it('提取主机名', () => {
    expect(extractHostName('https://api.openai.com/v1')).toBe('api.openai.com');
    expect(extractHostName('http://localhost:11434/v1')).toBe('localhost:11434');
  });

  it('非法地址原样返回', () => {
    expect(extractHostName('not-a-url')).toBe('not-a-url');
  });
});

describe('parseClockText', () => {
  it('解析 mm:ss 与 hh:mm:ss', () => {
    expect(parseClockText('12:34')).toBe(754);
    expect(parseClockText('1:02:03')).toBe(3723);
    expect(parseClockText(' 03:05 ')).toBe(185);
  });

  it('无法解析时返回 null', () => {
    expect(parseClockText(null)).toBeNull();
    expect(parseClockText('abc')).toBeNull();
    expect(parseClockText('12')).toBeNull();
    expect(parseClockText('1:2:3:4')).toBeNull();
  });
});

describe('normalizeTabTitle', () => {
  it('清理 B 站标题后缀', () => {
    expect(normalizeTabTitle('【硬核】十分钟看懂 RAG_哔哩哔哩_bilibili')).toBe(
      '【硬核】十分钟看懂 RAG'
    );
    expect(normalizeTabTitle('某个视频 - 哔哩哔哩_bilibili')).toBe('某个视频');
  });

  it('无标题时给出占位文案', () => {
    expect(normalizeTabTitle(undefined)).toBe('未命名视频');
    expect(normalizeTabTitle('   ')).toBe('未命名视频');
  });

  it('普通标题保持不变', () => {
    expect(normalizeTabTitle('普通标题')).toBe('普通标题');
  });
});
