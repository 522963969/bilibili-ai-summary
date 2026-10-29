import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TOLERANCE,
  checkVideoIdentity,
  isSameTitle,
  normalizeTitle
} from '@/core/video/identity-match';

/**
 * 面板认的视频 vs 页面正在播的视频。
 *
 * 真实反馈：3:04 的视频，面板里是 176 条 / 6:32 的字幕，总结讲的是沃尔玛和山姆。
 * 面板的视频身份来自标签页 URL，页面信息来自 DOM，B 站切视频时这两者会短暂不同步
 * （实测采样到过「path 已是新视频、h1 还是旧视频」的中间帧）。这里锁住对账规则。
 */

const api = (durationSeconds: number | null, title: string | null = null) => ({ durationSeconds, title });
const page = (durationSeconds: number | null, title: string | null = null) => ({ durationSeconds, title });

describe('checkVideoIdentity', () => {
  it('两边时长差太多时判定不是同一个视频', () => {
    const verdict = checkVideoIdentity(api(392), page(184));
    expect(verdict.kind).toBe('mismatch');
    expect(verdict.basis).toBe('duration');
    expect(verdict.message).toContain('06:32');
    expect(verdict.message).toContain('03:04');
  });

  it('时长几乎一致时算对得上', () => {
    expect(checkVideoIdentity(api(184), page(185)).kind).toBe('ok');
    expect(checkVideoIdentity(api(1474), page(1470)).kind).toBe('ok');
  });

  it('差几秒属于正常抖动，不误报', () => {
    // 允许 5% 或 5 秒中较大的那个
    expect(checkVideoIdentity(api(184), page(190)).kind).toBe('ok');
    expect(checkVideoIdentity(api(1474), page(1450)).kind).toBe('ok');
    expect(IDENTITY_TOLERANCE.minDurationSeconds).toBe(120);
  });

  it('短视频不做时长判定，避免广告/预告片误报', () => {
    expect(checkVideoIdentity(api(178), page(60)).kind).toBe('unknown');
    expect(checkVideoIdentity(api(30), page(45)).kind).toBe('unknown');
  });

  it('时长不可用时退回标题比对', () => {
    const same = checkVideoIdentity(api(null, '疆域阿力木——互联网把一个人劈成两半'), page(null, '疆域阿力木——互联网把一个人劈成两半：一半留在梗里'));
    expect(same.kind).toBe('ok');

    const different = checkVideoIdentity(api(null, '沃尔玛和山姆的烘焙区到底差在哪'), page(null, '疆域阿力木——互联网把一个人劈成两半'));
    expect(different.kind).toBe('mismatch');
    expect(different.basis).toBe('title');
  });

  it('两边都没有可用证据时不下结论', () => {
    expect(checkVideoIdentity(api(null, null), page(null, null)).kind).toBe('unknown');
    expect(checkVideoIdentity(api(184), page(null)).kind).toBe('unknown');
  });

  it('时长能判的时候优先用时長，不看标题', () => {
    const verdict = checkVideoIdentity(api(184, '标题完全不同 A'), page(184, '标题完全不同 B'));
    expect(verdict.kind).toBe('ok');
  });
});

describe('normalizeTitle / isSameTitle', () => {
  it('忽略空白与标点', () => {
    expect(normalizeTitle('疆域阿力木——互联网：把一个人劈成两半')).toBe('疆域阿力木互联网把一个人劈成两半');
  });

  it('一边是另一边的截断时视为同一个', () => {
    expect(isSameTitle('疆域阿力木——互联网把一个人劈成两半：一半留在梗里，一半扔进争议里。', '疆域阿力木——互联网把一个人劈成两半')).toBe(true);
  });

  it('过短的标题不做包含判断，避免「视频」两个字命中一切', () => {
    expect(isSameTitle('视频', '疆域阿力木——互联网把一个人劈成两半')).toBe(false);
    expect(isSameTitle('', '疆域阿力木——互联网把一个人劈成两半')).toBe(false);
    expect(isSameTitle(null, '疆域阿力木——互联网把一个人劈成两半')).toBe(false);
  });

  it('完全不同的标题判定为不同', () => {
    expect(isSameTitle('沃尔玛和山姆的烘焙区到底差在哪', '疆域阿力木——互联网把一个人劈成两半')).toBe(false);
  });
});
