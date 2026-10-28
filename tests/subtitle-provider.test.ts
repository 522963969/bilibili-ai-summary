import { describe, expect, it, vi } from 'vitest';
import type { BilibiliApi } from '@/core/bilibili/api';
import type { BilibiliPlayerData, BilibiliVideoView } from '@/core/bilibili/types';
import { AppError } from '@/core/errors/app-error';
import { BilibiliSubtitleProvider } from '@/core/subtitle/bilibili-provider';
import type { VideoIdentity } from '@/core/video/types';

const identity: VideoIdentity = {
  platform: 'bilibili',
  kind: 'video',
  bvid: 'BV1xx411c7mD',
  aid: null,
  epId: null,
  seasonId: null,
  page: 1,
  key: 'BV1xx411c7mD#p1',
  canonicalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD'
};

const view: BilibiliVideoView = {
  bvid: 'BV1xx411c7mD',
  aid: 170001,
  title: '测试视频',
  duration: 120,
  pages: [{ cid: 111, page: 1, part: 'P1', duration: 120 }]
};

const playerWithTracks: BilibiliPlayerData = {
  cid: 111,
  login_mid: 777,
  need_login_subtitle: false,
  subtitle: {
    subtitles: [
      {
        id_str: 'sub-1',
        lan: 'zh-CN',
        lan_doc: '中文（自动生成）',
        subtitle_url: '//aisubtitle.hdslb.com/bfs/subtitle/sub-1.json',
        ai_status: 1
      }
    ]
  }
};

function createApi(options: {
  view?: BilibiliVideoView;
  player?: BilibiliPlayerData;
  text?: string;
}): BilibiliApi {
  return {
    getVideoView: async () => options.view ?? view,
    getPlayerData: async () => options.player ?? playerWithTracks,
    getText: async () => options.text ?? '{"body":[]}'
  } as unknown as BilibiliApi;
}

describe('BilibiliSubtitleProvider.discover', () => {
  it('返回可用轨道并补全协议相对地址', async () => {
    const provider = new BilibiliSubtitleProvider(createApi({}));
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('ok');
    expect(discovery.tracks).toHaveLength(1);
    expect(discovery.tracks[0]?.url).toBe('https://aisubtitle.hdslb.com/bfs/subtitle/sub-1.json');
    expect(discovery.tracks[0]?.isAiGenerated).toBe(true);
    expect(discovery.cid).toBe(111);
    expect(discovery.videoTitle).toBe('测试视频');
  });

  it('未登录且需要登录时返回 login-required', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: { login_mid: 0, need_login_subtitle: true, subtitle: { subtitles: [] } }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('login-required');
    expect(discovery.loginRequired).toBe(true);
    expect(discovery.message).toContain('登录');
  });

  it('已登录但无字幕时返回 empty', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: { login_mid: 777, need_login_subtitle: false, subtitle: { subtitles: [] } }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('empty');
    expect(discovery.message).toContain('没有可用字幕');
  });

  it('未登录但视频本身没有字幕时返回 empty，且不误报需要登录', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: { login_mid: 0, need_login_subtitle: false, subtitle: { subtitles: [] } }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('empty');
    expect(discovery.loginRequired).toBe(false);
    expect(discovery.message).not.toContain('登录');
  });

  it('字幕全部被锁定时返回 all-locked', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: {
          login_mid: 777,
          subtitle: {
            subtitles: [
              {
                id_str: 'locked-1',
                lan: 'zh-CN',
                lan_doc: '中文',
                subtitle_url: '//aisubtitle.hdslb.com/x.json',
                is_lock: true
              }
            ]
          }
        }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('all-locked');
    // 已登录时不能说「请先登录」——那会把人送去解一个不存在的锁
    expect(discovery.loginRequired).toBe(false);
    expect(discovery.message).toContain('观看权限');
  });

  it('未登录时接口列举轨道但不给地址，应判为登录受限而不是「需要解锁」', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: {
          login_mid: 0,
          need_login_subtitle: false,
          subtitle: {
            subtitles: [
              {
                id_str: 'sub-1',
                lan: 'zh-CN',
                lan_doc: '中文（自动生成）',
                // 未登录时真实响应里 subtitle_url 就是空串
                subtitle_url: '',
                ai_status: 1
              },
              { id_str: 'sub-2', lan: 'en-US', lan_doc: 'English(US)', subtitle_url: '' }
            ]
          }
        }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('login-required');
    expect(discovery.loginRequired).toBe(true);
    expect(discovery.message).toContain('登录');
    expect(discovery.message).not.toContain('解锁');
  });

  it('未登录且轨道全部被锁定：说明先登录再判断，不武断说「登录也没用」', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: {
          login_mid: 0,
          subtitle: {
            subtitles: [
              { id_str: 'l1', lan: 'zh-CN', lan_doc: '中文', subtitle_url: '', is_lock: true },
              { id_str: 'l2', lan: 'en-US', lan_doc: 'English', subtitle_url: '', is_lock: true }
            ]
          }
        }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('all-locked');
    expect(discovery.message).toContain('先登录');
  });

  it('部分轨道被锁定时，可获取的轨道照常返回并提一句锁了几条', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        player: {
          login_mid: 777,
          subtitle: {
            subtitles: [
              {
                id_str: 'ok-1',
                lan: 'zh-CN',
                lan_doc: '中文',
                subtitle_url: '//aisubtitle.hdslb.com/ok.json'
              },
              {
                id_str: 'locked-1',
                lan: 'ja',
                lan_doc: '日本語',
                subtitle_url: '',
                is_lock: true
              }
            ]
          }
        }
      })
    );
    const discovery = await provider.discover(identity);
    expect(discovery.availability).toBe('ok');
    expect(discovery.tracks).toHaveLength(2);
    expect(discovery.message).toContain('另有 1 条被平台锁定');
  });

  it('主通道未拿到登录态时使用页面通道补位', async () => {
    const primary = createApi({
      player: { login_mid: 0, need_login_subtitle: true, subtitle: { subtitles: [] } }
    });
    const fallback = createApi({ player: playerWithTracks });
    const provider = new BilibiliSubtitleProvider(primary);

    const discovery = await provider.discover(identity, { fallbackApi: fallback });
    expect(discovery.availability).toBe('ok');
    expect(discovery.tracks).toHaveLength(1);
  });

  it('页面通道失败时保留主通道结论', async () => {
    const primary = createApi({
      player: { login_mid: 0, need_login_subtitle: true, subtitle: { subtitles: [] } }
    });
    const fallback = {
      getVideoView: async () => view,
      getPlayerData: async () => {
        throw new AppError('E_CONTENT_SCRIPT_UNAVAILABLE');
      },
      getText: async () => ''
    } as unknown as BilibiliApi;
    const provider = new BilibiliSubtitleProvider(primary);

    const discovery = await provider.discover(identity, { fallbackApi: fallback });
    expect(discovery.availability).toBe('login-required');
  });

  it('按分 P 选择对应 cid', async () => {
    const multiPageView: BilibiliVideoView = {
      ...view,
      pages: [
        { cid: 111, page: 1, part: 'P1', duration: 60 },
        { cid: 222, page: 2, part: 'P2', duration: 60 }
      ]
    };
    const getPlayerData = vi.fn(async () => playerWithTracks);
    const api = {
      getVideoView: async () => multiPageView,
      getPlayerData,
      getText: async () => ''
    } as unknown as BilibiliApi;
    const provider = new BilibiliSubtitleProvider(api);

    await provider.discover({ ...identity, page: 2, key: 'BV1xx411c7mD#p2' });
    expect(getPlayerData).toHaveBeenCalledWith(expect.anything(), 222);
  });

  it('分 P 不存在时直接报错，不回落到第 1 个分 P', async () => {
    const multiPageView: BilibiliVideoView = {
      ...view,
      pages: [
        { cid: 111, page: 1, part: 'P1', duration: 60 },
        { cid: 222, page: 2, part: 'P2', duration: 60 }
      ]
    };
    const getPlayerData = vi.fn(async () => playerWithTracks);
    const api = {
      getVideoView: async () => multiPageView,
      getPlayerData,
      getText: async () => ''
    } as unknown as BilibiliApi;
    const provider = new BilibiliSubtitleProvider(api);

    // 链接指向已删除的分 P 时，宁可报错也不能拿第 1 个分 P 的字幕冒充
    await expect(
      provider.discover({ ...identity, page: 5, key: 'BV1xx411c7mD#p5' })
    ).rejects.toMatchObject({
      code: 'E_SUBTITLE_UNAVAILABLE',
      message: expect.stringContaining('没有第 5 个分P')
    });
    expect(getPlayerData).not.toHaveBeenCalled();
  });

  it('pages 缺失时单 P 视频使用顶层 cid 兜底', async () => {
    const flatView: BilibiliVideoView = { ...view, cid: 999, pages: [] };
    const getPlayerData = vi.fn(async () => playerWithTracks);
    const api = {
      getVideoView: async () => flatView,
      getPlayerData,
      getText: async () => ''
    } as unknown as BilibiliApi;
    const provider = new BilibiliSubtitleProvider(api);

    await provider.discover(identity);
    expect(getPlayerData).toHaveBeenCalledWith(expect.anything(), 999);
  });
});

describe('BilibiliSubtitleProvider.fetch', () => {
  it('下载并解析字幕，返回规范化结果', async () => {
    const provider = new BilibiliSubtitleProvider(
      createApi({
        text: JSON.stringify({
          body: [
            { from: 1.5, to: 3, content: '第一句' },
            { from: 3.2, to: 5, content: '<i>第二句</i>' }
          ]
        })
      })
    );
    const subtitle = await provider.fetch(identity, 'sub-1');
    expect(subtitle.source).toBe('bilibili');
    expect(subtitle.format).toBe('bilibili-json');
    expect(subtitle.cues).toHaveLength(2);
    expect(subtitle.cues[1]?.text).toBe('第二句');
    expect(subtitle.videoKey).toBe('BV1xx411c7mD#p1');
  });

  it('轨道不存在时抛出 E_SUBTITLE_UNAVAILABLE', async () => {
    const provider = new BilibiliSubtitleProvider(createApi({}));
    await expect(provider.fetch(identity, 'missing')).rejects.toMatchObject({
      code: 'E_SUBTITLE_UNAVAILABLE'
    });
  });

  it('字幕文件为空时抛出解析错误', async () => {
    const provider = new BilibiliSubtitleProvider(createApi({ text: '{"body":[]}' }));
    await expect(provider.fetch(identity, 'sub-1')).rejects.toMatchObject({
      code: 'E_SUBTITLE_PARSE_FAILED'
    });
  });
});
