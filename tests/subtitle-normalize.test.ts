import { describe, expect, it } from 'vitest';
import { buildNormalizedSubtitle, cleanCueText, normalizeCues } from '@/core/subtitle/normalize';
import { AppError } from '@/core/errors/app-error';
import type { RawCue } from '@/core/subtitle/types';

describe('cleanCueText', () => {
  it('去掉 HTML / ASS 标记并解码实体', () => {
    expect(cleanCueText('<i>斜体</i><font color="#fff">彩色</font>')).toBe('斜体彩色');
    expect(cleanCueText('{\\an8}顶部字幕')).toBe('顶部字幕');
    expect(cleanCueText('A &amp; B &lt;C&gt; &quot;D&quot;')).toBe('A & B <C> "D"');
    expect(cleanCueText('&nbsp;空格&nbsp;')).toBe('空格');
  });

  it('合并换行与多余空格', () => {
    expect(cleanCueText('第一行\n  第二行\t第三段')).toBe('第一行 第二行 第三段');
    expect(cleanCueText('  多   空格  ')).toBe('多 空格');
  });

  it('纯空文本返回空串', () => {
    expect(cleanCueText('<i></i>')).toBe('');
    expect(cleanCueText('   ')).toBe('');
  });
});

describe('normalizeCues', () => {
  it('按起始时间排序并重新编号', () => {
    const raw: RawCue[] = [
      { startMs: 5000, endMs: 6000, text: '第二' },
      { startMs: 1000, endMs: 2000, text: '第一' }
    ];
    const { cues } = normalizeCues(raw);
    expect(cues.map((cue) => cue.text)).toEqual(['第一', '第二']);
    expect(cues.map((cue) => cue.index)).toEqual([1, 2]);
  });

  it('修正结束时间不晚于起始时间的条目', () => {
    const { cues, stats } = normalizeCues([{ startMs: 3000, endMs: 3000, text: 'x' }]);
    expect(cues[0]?.endMs).toBe(4000);
    expect(stats.repairedCues).toBe(1);
  });

  it('丢弃空文本与负数起点收敛为 0', () => {
    const { cues, stats } = normalizeCues([
      { startMs: 1000, endMs: 2000, text: '<i></i>' },
      { startMs: -500, endMs: 500, text: '负起点' }
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0]?.startMs).toBe(0);
    expect(stats.droppedCues).toBe(1);
  });

  it('统计总时长取最后一条的结束时间', () => {
    const { stats } = normalizeCues([
      { startMs: 0, endMs: 1000, text: 'a' },
      { startMs: 60000, endMs: 61000, text: 'b' }
    ]);
    expect(stats.totalDurationMs).toBe(61000);
    expect(stats.cueCount).toBe(2);
  });
});

describe('buildNormalizedSubtitle', () => {
  it('组装可持久化的字幕对象', () => {
    const subtitle = buildNormalizedSubtitle({
      videoKey: 'BV1xx411c7mD#p1',
      trackId: 'track-1',
      lang: 'zh-CN',
      label: '中文（自动生成）',
      source: 'bilibili',
      format: 'bilibili-json',
      rawCues: [{ startMs: 0, endMs: 1000, text: '你好' }],
      now: 1700000000000
    });
    expect(subtitle.cues).toHaveLength(1);
    expect(subtitle.createdAt).toBe(1700000000000);
    expect(subtitle.stats.cueCount).toBe(1);
  });

  it('空字幕视为失败', () => {
    expect(() =>
      buildNormalizedSubtitle({
        videoKey: 'k',
        trackId: 't',
        lang: 'zh',
        label: 'l',
        source: 'import',
        format: 'srt',
        rawCues: [{ startMs: 0, endMs: 1000, text: '   ' }]
      })
    ).toThrowError(AppError);
  });
});
