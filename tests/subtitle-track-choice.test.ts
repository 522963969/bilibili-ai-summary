import { describe, expect, it } from 'vitest';
import {
  TRACK_COVERAGE,
  buildCoverageHint,
  isFetchableTrack,
  listFetchableTracks,
  measureSubtitleCoverage,
  pickDefaultTrack
} from '@/core/subtitle/track-choice';
import type { SubtitleTrack } from '@/core/subtitle/types';

/**
 * 轨道选择与覆盖率判定。
 *
 * 背景（真实反馈）：24 分钟的视频，点「获取字幕」只拿到 1 条、10 秒。
 * 面板此前没有任何轨道选择入口，直接取第一条可用轨道——如果那是 UP 主上传的占位字幕，
 * 用户既看不出问题在哪，也没法换。这里锁住「怎么挑」和「怎么判断不够用」。
 */

function track(patch: Partial<SubtitleTrack> = {}): SubtitleTrack {
  return {
    id: 'zh-CN',
    lang: 'zh-CN',
    label: '中文（自动生成）',
    url: '//aisubtitle.hdslb.com/bfs/ai_subtitle/x.json',
    isAiGenerated: true,
    locked: false,
    ...patch
  };
}

describe('isFetchableTrack / listFetchableTracks', () => {
  it('锁定或没有地址的轨道不可用', () => {
    expect(isFetchableTrack(track())).toBe(true);
    expect(isFetchableTrack(track({ locked: true }))).toBe(false);
    expect(isFetchableTrack(track({ url: null }))).toBe(false);
    expect(isFetchableTrack(track({ url: '   ' }))).toBe(false);
  });

  it('过滤后保持接口返回的原始顺序', () => {
    const tracks = [
      track({ id: 'a', lang: 'en-US', isAiGenerated: false }),
      track({ id: 'b', locked: true }),
      track({ id: 'c' })
    ];
    expect(listFetchableTracks(tracks).map((item) => item.id)).toEqual(['a', 'c']);
  });
});

describe('pickDefaultTrack', () => {
  it('优先中文自动生成轨道，而不是盲取第一条', () => {
    const tracks = [
      track({ id: 'uploaded', lang: 'zh-CN', label: 'UP主上传', isAiGenerated: false }),
      track({ id: 'ai-zh', lang: 'ai-zh', label: '中文（自动生成）' })
    ];
    expect(pickDefaultTrack(tracks)?.id).toBe('ai-zh');
  });

  it('没有自动生成时退到任意中文轨道', () => {
    const tracks = [
      track({ id: 'en', lang: 'en-US', isAiGenerated: false, label: 'English' }),
      track({ id: 'zh', lang: 'zh-CN', isAiGenerated: false, label: '中文' })
    ];
    expect(pickDefaultTrack(tracks)?.id).toBe('zh');
  });

  it('全是外语轨道时退回第一条可用轨道，不返回 null', () => {
    const tracks = [
      track({ id: 'en', lang: 'en-US', isAiGenerated: false }),
      track({ id: 'ja', lang: 'ja-JP', isAiGenerated: false })
    ];
    expect(pickDefaultTrack(tracks)?.id).toBe('en');
  });

  it('没有可用轨道时返回 null', () => {
    expect(pickDefaultTrack([track({ locked: true })])).toBeNull();
    expect(pickDefaultTrack([])).toBeNull();
  });
});

describe('measureSubtitleCoverage', () => {
  it('24 分钟视频只有 1 条 10 秒字幕时判为不足', () => {
    const coverage = measureSubtitleCoverage({ cueCount: 1, totalDurationMs: 10_000 }, 1474);
    expect(coverage.insufficient).toBe(true);
    expect(coverage.reason).toBe('few-cues');
    expect(coverage.ratio).toBeNull();
  });

  it('条数够多但只覆盖前段时判为不足，并给出比例', () => {
    const coverage = measureSubtitleCoverage({ cueCount: 40, totalDurationMs: 120_000 }, 1474);
    expect(coverage.insufficient).toBe(true);
    expect(coverage.reason).toBe('short-coverage');
    expect(coverage.ratio).toBeCloseTo(0.0814, 3);
  });

  it('覆盖到位时不提示', () => {
    const coverage = measureSubtitleCoverage({ cueCount: 700, totalDurationMs: 1_440_000 }, 1474);
    expect(coverage.insufficient).toBe(false);
    expect(coverage.reason).toBe('ok');
  });

  it('短视频不做覆盖率判定，避免旁白稀疏被误判', () => {
    const coverage = measureSubtitleCoverage({ cueCount: 40, totalDurationMs: 30_000 }, 90);
    expect(coverage.insufficient).toBe(false);
    expect(coverage.reason).toBe('unknown');
    expect(TRACK_COVERAGE.minVideoSeconds).toBe(120);
  });

  it('拿不到视频时长时只在条数极少时判定', () => {
    expect(measureSubtitleCoverage({ cueCount: 1, totalDurationMs: 1000 }, null).insufficient).toBe(true);
    expect(measureSubtitleCoverage({ cueCount: 50, totalDurationMs: 600_000 }, null).insufficient).toBe(false);
  });
});

describe('buildCoverageHint', () => {
  it('条数极少时同时给出字幕条数与视频时长', () => {
    const stats = { cueCount: 1, totalDurationMs: 10_000 };
    const coverage = measureSubtitleCoverage(stats, 1474);
    const hint = buildCoverageHint(coverage, stats, 1474);
    expect(hint).toContain('只有 1 条');
    expect(hint).toContain('24:34');
    expect(hint).toContain('换一条');
  });

  it('覆盖不足时指出字幕到哪、视频多长', () => {
    const stats = { cueCount: 40, totalDurationMs: 120_000 };
    const coverage = measureSubtitleCoverage(stats, 1474);
    const hint = buildCoverageHint(coverage, stats, 1474);
    expect(hint).toContain('02:00');
    expect(hint).toContain('24:34');
  });

  it('覆盖到位时不返回提示', () => {
    const stats = { cueCount: 700, totalDurationMs: 1_440_000 };
    const coverage = measureSubtitleCoverage(stats, 1474);
    expect(buildCoverageHint(coverage, stats, 1474)).toBeNull();
  });
});
