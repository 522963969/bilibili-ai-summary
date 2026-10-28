import { describe, expect, it } from 'vitest';
import {
  isContentScriptEligibleUrl,
  parseBilibiliVideoUrl,
  parsePageParam
} from '@/core/video/parse-video-url';

describe('parseBilibiliVideoUrl', () => {
  it('解析带跟踪参数与分 P 的 BV 链接', () => {
    const identity = parseBilibiliVideoUrl(
      'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.999.0.0&p=2'
    );
    expect(identity).not.toBeNull();
    expect(identity?.kind).toBe('video');
    expect(identity?.bvid).toBe('BV1xx411c7mD');
    expect(identity?.aid).toBeNull();
    expect(identity?.page).toBe(2);
    expect(identity?.key).toBe('BV1xx411c7mD#p2');
    expect(identity?.canonicalUrl).toBe('https://www.bilibili.com/video/BV1xx411c7mD?p=2');
  });

  it('解析 av 号链接并生成规范链接', () => {
    const identity = parseBilibiliVideoUrl('https://www.bilibili.com/video/av170001?p=3');
    expect(identity?.aid).toBe(170001);
    expect(identity?.bvid).toBeNull();
    expect(identity?.key).toBe('av170001#p3');
    expect(identity?.canonicalUrl).toBe('https://www.bilibili.com/video/av170001?p=3');
  });

  it('解析番剧 ep / ss 链接', () => {
    const ep = parseBilibiliVideoUrl('https://www.bilibili.com/bangumi/play/ep123456');
    expect(ep?.kind).toBe('bangumi');
    expect(ep?.epId).toBe('123456');
    expect(ep?.canonicalUrl).toBe('https://www.bilibili.com/bangumi/play/ep123456');

    const season = parseBilibiliVideoUrl('https://www.bilibili.com/bangumi/play/ss987');
    expect(season?.kind).toBe('bangumi');
    expect(season?.seasonId).toBe('987');
  });

  it('接受 http 协议但拒绝非 B 站域名', () => {
    expect(parseBilibiliVideoUrl('http://www.bilibili.com/video/BV1xx411c7mD')?.bvid).toBe(
      'BV1xx411c7mD'
    );
    expect(parseBilibiliVideoUrl('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(parseBilibiliVideoUrl('https://space.bilibili.com/123')).toBeNull();
  });

  it('非法或不支持的路径返回 null', () => {
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/foo')).toBeNull();
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/BV123')).toBeNull();
    expect(parseBilibiliVideoUrl('not-a-url')).toBeNull();
    expect(parseBilibiliVideoUrl('')).toBeNull();
  });

  it('分 P 参数非法时回落为 1', () => {
    expect(
      parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=0')?.page
    ).toBe(1);
    expect(
      parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD?p=abc')?.page
    ).toBe(1);
    expect(
      parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD')?.canonicalUrl
    ).toBe('https://www.bilibili.com/video/BV1xx411c7mD');
  });
});

describe('parsePageParam', () => {
  it('限制在 1 到 2000 之间', () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam('7')).toBe(7);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam('999999')).toBe(2000);
  });
});

describe('isContentScriptEligibleUrl', () => {
  it('仅普通投稿播放页可注入', () => {
    expect(isContentScriptEligibleUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(true);
    expect(isContentScriptEligibleUrl('https://www.bilibili.com/bangumi/play/ep123456')).toBe(
      false
    );
    expect(isContentScriptEligibleUrl('https://example.com/video/BV1xx411c7mD')).toBe(false);
  });
});
