import { describe, expect, it } from 'vitest';
import {
  detectSubtitleFormat,
  parseSrt,
  parseSubtitleContent,
  parseSubtitleJson,
  parseVtt
} from '@/core/subtitle/parsers';
import { AppError } from '@/core/errors/app-error';

const SRT_SAMPLE = `1
00:00:01,000 --> 00:00:03,500
大家好，今天聊聊分块策略

2
00:00:03,600 --> 00:00:06,000
<i>先把字幕读取出来</i>
再按 token 预算切分

3
00:00:06,100 --> 00:00:05,000
结束时间早于开始时间
`;

describe('parseSrt', () => {
  it('解析序号、时间与多行文本', () => {
    const cues = parseSrt(SRT_SAMPLE);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ startMs: 1000, endMs: 3500, text: '大家好，今天聊聊分块策略' });
    expect(cues[1]?.text).toContain('再按 token 预算切分');
    expect(cues[2]?.endMs).toBeLessThan(cues[2]?.startMs ?? 0);
  });

  it('容忍缺少序号行与毫秒用点分隔', () => {
    const cues = parseSrt('00:00:02.000 --> 00:00:04.250\n测试文本\n');
    expect(cues).toHaveLength(1);
    expect(cues[0]?.startMs).toBe(2000);
    expect(cues[0]?.endMs).toBe(4250);
  });

  it('忽略无效块', () => {
    expect(parseSrt('随便一段没有时间轴的文字')).toHaveLength(0);
    expect(parseSrt('')).toHaveLength(0);
  });
});

describe('parseVtt', () => {
  const VTT_SAMPLE = `WEBVTT

NOTE 这是注释，应当跳过

cue-1
00:01.000 --> 00:04.500 align:start position:0%
<v 说话人>第一句</v>

00:00:05.000 --> 00:00:08.000
第二句 &amp; 实体
`;

  it('跳过头部与注释，解析短时间戳与 cue 设置', () => {
    const cues = parseVtt(VTT_SAMPLE);
    expect(cues).toHaveLength(2);
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[0]?.endMs).toBe(4500);
    expect(cues[1]?.startMs).toBe(5000);
  });

  it('支持带小时的时间戳', () => {
    const cues = parseVtt('01:02:03.500 --> 01:02:05.000\n文本');
    expect(cues[0]?.startMs).toBe(3723500);
  });
});

describe('parseSubtitleJson', () => {
  it('解析 B 站 body 结构（秒）', () => {
    const cues = parseSubtitleJson(
      JSON.stringify({
        font_size: 0.4,
        body: [
          { from: 0.5, to: 2.25, content: '第一句' },
          { from: 2.3, to: 4, content: '第二句' }
        ]
      })
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startMs: 500, endMs: 2250, text: '第一句' });
  });

  it('解析通用 cues 数组（毫秒）与时间字符串', () => {
    const cues = parseSubtitleJson(
      JSON.stringify({
        cues: [
          { startMs: 1000, endMs: 2000, text: 'A' },
          { start: '00:00:03.000', end: '00:00:04.500', text: 'B' }
        ]
      })
    );
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[1]?.endMs).toBe(4500);
  });

  it('无法识别的结构抛出 E_SUBTITLE_PARSE_FAILED', () => {
    expect(() => parseSubtitleJson('{"foo":1}')).toThrowError(AppError);
    expect(() => parseSubtitleJson('not-json')).toThrowError(AppError);
    try {
      parseSubtitleJson('[{"foo":1}]');
    } catch (error) {
      expect((error as AppError).code).toBe('E_SUBTITLE_PARSE_FAILED');
    }
  });
});

describe('detectSubtitleFormat', () => {
  it('按内容识别优先于扩展名', () => {
    expect(detectSubtitleFormat('WEBVTT\n\n00:01.000 --> 00:02.000\nx')).toBe('vtt');
    expect(detectSubtitleFormat('1\n00:00:01,000 --> 00:00:02,000\nx')).toBe('srt');
    expect(detectSubtitleFormat('{"body":[]}')).toBe('json');
  });

  it('内容无法判断时使用扩展名', () => {
    expect(detectSubtitleFormat('x', 'a.srt')).toBe('srt');
    expect(detectSubtitleFormat('x', 'a.vtt')).toBe('vtt');
    expect(detectSubtitleFormat('x', 'a.json')).toBe('json');
    expect(detectSubtitleFormat('x', 'a.txt')).toBeNull();
  });
});

describe('parseSubtitleContent', () => {
  it('空内容与不可识别格式给出明确错误', () => {
    expect(() => parseSubtitleContent({ content: '   ' })).toThrowError(/字幕内容为空/);
    expect(() => parseSubtitleContent({ content: '随便一句话' })).toThrowError(/无法识别字幕格式/);
  });

  it('解析成功返回格式与条目', () => {
    const result = parseSubtitleContent({ content: SRT_SAMPLE, fileName: 'demo.srt' });
    expect(result.format).toBe('srt');
    expect(result.cues.length).toBe(3);
  });
});
