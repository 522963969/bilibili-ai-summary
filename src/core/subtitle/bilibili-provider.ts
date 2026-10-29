import { absolutizeUrl, type BilibiliApi } from '@/core/bilibili/api';
import type { BilibiliPlayerData, BilibiliSubtitleItem } from '@/core/bilibili/types';
import { AppError } from '@/core/errors/app-error';
import type { VideoIdentity } from '@/core/video/types';
import { buildNormalizedSubtitle } from './normalize';
import { parseSubtitleJson } from './parsers';
import type { NormalizedSubtitle, SubtitleDiscovery, SubtitleTrack } from './types';

export interface DiscoverOptions {
  /** 页面内同源请求通道。Service Worker 直连拿不到会话时用于补位。 */
  fallbackApi?: BilibiliApi;
}

export interface SubtitleProvider {
  discover(identity: VideoIdentity, options?: DiscoverOptions): Promise<SubtitleDiscovery>;
  fetch(
    identity: VideoIdentity,
    trackId: string,
    options?: DiscoverOptions
  ): Promise<NormalizedSubtitle>;
}

const CID_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TTL_MS = 2 * 60 * 1000;

interface VideoMeta {
  cid: number;
  title: string;
  /**
   * 这一分P 的时长（秒），来自 `pages[].duration`。
   *
   * 不能用 `view.duration`：多P视频那里是各P 之和，拿它跟页面正在播放的那一 P
   * 的时长对账必然对不上，会把正常视频误判成「不是同一个视频」。
   */
  durationSeconds: number | null;
  expiresAt: number;
}

function countTracks(player: BilibiliPlayerData): number {
  return player.subtitle?.subtitles?.length ?? 0;
}

function toTrack(item: BilibiliSubtitleItem, position: number): SubtitleTrack {
  const lang = item.lan ?? 'unknown';
  const label = item.lan_doc?.trim() || item.lan?.trim() || `字幕 ${position + 1}`;
  const id = item.id_str ?? (item.id !== undefined ? String(item.id) : `${lang}-${position + 1}`);
  return {
    id,
    lang,
    label,
    url: absolutizeUrl(item.subtitle_url_v2 ?? item.subtitle_url),
    isAiGenerated: item.ai_status === 1 || lang.startsWith('ai-'),
    locked: item.is_lock === true
  };
}

/**
 * B 站字幕 Provider。
 *
 * 已验证的接口行为（2026-10，未登录会话）：
 * - `/x/web-interface/view` 返回 cid / 标题 / 时长，无需登录
 * - `/x/player/v2` 返回 subtitle.subtitles，无需 WBI 签名
 * - 未登录时 subtitles 为空且 need_login_subtitle = true，login_mid = 0
 * 因此获取字幕必须复用用户自己的浏览器会话。
 */
export class BilibiliSubtitleProvider implements SubtitleProvider {
  private readonly videoCache = new Map<string, VideoMeta>();
  private readonly discoveryCache = new Map<
    string,
    { discovery: SubtitleDiscovery; expiresAt: number }
  >();

  constructor(private readonly api: BilibiliApi) {}

  async discover(identity: VideoIdentity, options?: DiscoverOptions): Promise<SubtitleDiscovery> {
    if (identity.kind !== 'video') {
      throw new AppError('E_UNSUPPORTED_PAGE', { message: '番剧字幕暂不支持' });
    }

    const cached = this.discoveryCache.get(identity.key);
    if (cached && cached.expiresAt > Date.now()) return cached.discovery;

    const video = await this.resolveVideo(identity);
    let player = await this.api.getPlayerData(identity, video.cid);

    const shouldTryFallback =
      countTracks(player) === 0 &&
      (player.login_mid ?? 0) === 0 &&
      options?.fallbackApi !== undefined;

    if (shouldTryFallback && options?.fallbackApi) {
      try {
        const alternate = await options.fallbackApi.getPlayerData(identity, video.cid);
        if ((alternate.login_mid ?? 0) > 0 || countTracks(alternate) > 0) {
          player = alternate;
        }
      } catch {
        // 页面通道不可用（标签页已关闭等）时保留主通道结果
      }
    }

    const discovery = this.buildDiscovery(video, player);
    this.discoveryCache.set(identity.key, {
      discovery,
      expiresAt: Date.now() + DISCOVERY_TTL_MS
    });
    return discovery;
  }

  async fetch(
    identity: VideoIdentity,
    trackId: string,
    options?: DiscoverOptions
  ): Promise<NormalizedSubtitle> {
    const discovery = await this.discover(identity, options);
    const track = discovery.tracks.find((item) => item.id === trackId);
    if (!track) {
      throw new AppError('E_SUBTITLE_UNAVAILABLE', {
        message: '该字幕轨道已失效，请重新获取字幕列表'
      });
    }
    if (track.locked) {
      throw new AppError('E_SUBTITLE_UNAVAILABLE', {
        message:
          '这条字幕轨道被平台标记为需要解锁（充电专属、付费内容或 UP 主限定常见），扩展无法绕过。可以导入本地字幕，或改用画面识别'
      });
    }
    if (!track.url) {
      throw new AppError('E_SUBTITLE_UNAVAILABLE', {
        message: '这条字幕轨道没有可下载地址（未登录或字幕已下线时接口会这样返回），请重新获取字幕列表'
      });
    }

    const text = await this.api.getText(track.url);
    const rawCues = parseSubtitleJson(text);
    return buildNormalizedSubtitle({
      videoKey: identity.key,
      trackId: track.id,
      lang: track.lang,
      label: track.label,
      source: 'bilibili',
      format: 'bilibili-json',
      rawCues
    });
  }

  private async resolveVideo(identity: VideoIdentity): Promise<VideoMeta> {
    const cached = this.videoCache.get(identity.key);
    if (cached && cached.expiresAt > Date.now()) return cached;

    const view = await this.api.getVideoView(identity);
    const pages = Array.isArray(view.pages) ? view.pages : [];

    /**
     * 必须严格按 URL 里的分P取 cid。
     *
     * 这里曾经在「找不到对应分P」时静默回落到第 1 个分P——对把每一集拆成分P的短剧合集来说，
     * 那等于拿第一集的字幕去总结第五集：链接过期、分P被UP主删除、或收藏夹里指向已删除的分P时，
     * 用户就会看到「完全不属于这个视频的内容」，而且界面上没有任何迹象。
     * 宁可直接报错，也不能换一段素材继续跑。
     */
    const matched = pages.find((page) => page.page === identity.page);
    if (!matched) {
      // 单P视频的 URL 不带 ?p=，page 恒为 1；pages 缺失时只有这一种情况可以安全使用顶层 cid
      const topLevelCid = view.cid;
      const canUseTopLevelCid =
        pages.length === 0 &&
        identity.page === 1 &&
        typeof topLevelCid === 'number' &&
        Number.isFinite(topLevelCid);
      if (canUseTopLevelCid) {
        const fallback: VideoMeta = {
          cid: topLevelCid,
          title: view.title,
          durationSeconds: Number.isFinite(view.duration) ? view.duration : null,
          expiresAt: Date.now() + CID_TTL_MS
        };
        this.videoCache.set(identity.key, fallback);
        return fallback;
      }
      const total = pages.length;
      throw new AppError('E_SUBTITLE_UNAVAILABLE', {
        message:
          total === 0
            ? '无法确定这个视频的 cid，可能视频已被删除或结构有变化'
            : `这个视频没有第 ${identity.page} 个分P（当前共 ${total} 个），链接可能已失效。请回到视频页重新选择分片后再试`,
        details: `bvid=${identity.bvid ?? `av${identity.aid ?? ''}`} · 请求 p=${identity.page} · 实际 pages=${pages
          .map((page) => page.page)
          .join('/')}`
      });
    }

    if (!Number.isFinite(matched.cid)) {
      throw new AppError('E_UNSUPPORTED_PAGE', {
        message: '无法确定该分 P 的 cid，可能视频已变更'
      });
    }

    const meta: VideoMeta = {
      cid: matched.cid,
      title: view.title,
      durationSeconds: Number.isFinite(matched.duration) ? matched.duration : null,
      expiresAt: Date.now() + CID_TTL_MS
    };
    this.videoCache.set(identity.key, meta);
    return meta;
  }

  private buildDiscovery(video: VideoMeta, player: BilibiliPlayerData): SubtitleDiscovery {
    const rawItems = player.subtitle?.subtitles ?? [];
    const tracks = rawItems.map((item, position) => toTrack(item, position));
    const loginMid = player.login_mid ?? 0;
    const needLogin = player.need_login_subtitle === true;
    const signedOut = loginMid === 0;

    const available = tracks.filter((track) => !track.locked && track.url !== null);
    const lockedCount = tracks.length - available.length;
    /** 轨道全部被平台标记为「需要解锁」 */
    const allLocked = tracks.length > 0 && tracks.every((track) => track.locked);
    /**
     * 未登录时接口会照常列出轨道，但**不给 subtitle_url**。
     *
     * 旧实现只看「有没有轨道」就报「需要解锁」，把登录态问题说成了权限问题——
     * 用户按提示去解锁会发现根本没有可解锁的东西。这两种原因必须分开说。
     */
    const needsLoginForUrl = signedOut && tracks.length > 0 && !allLocked;
    /** 只有「因为未登录才拿不到字幕」才算登录受限，视频本身无字幕时不算。 */
    const loginBlocked = needLogin && signedOut && tracks.length === 0;

    let availability: SubtitleDiscovery['availability'];
    let message: string;

    if (available.length > 0) {
      availability = 'ok';
      message =
        lockedCount > 0
          ? `发现 ${available.length} 条可获取的字幕轨道（另有 ${lockedCount} 条被平台锁定）`
          : `发现 ${available.length} 条可获取的字幕轨道`;
    } else if (allLocked) {
      availability = 'all-locked';
      message = signedOut
        ? `该视频的 ${tracks.length} 条字幕轨道都被平台标记为需要解锁。未登录时接口不会给出字幕文件，请先登录 B 站账号再试；登录后依然锁定的，通常属于充电专属 / 付费内容这类观看权限限制`
        : `该视频的 ${tracks.length} 条字幕轨道都被平台标记为需要解锁，接口不返回字幕文件地址。这是平台侧的观看权限限制（充电专属、付费内容、UP 主限定常见），登录不会解除；可以导入本地字幕，或改用画面识别`;
    } else if (needsLoginForUrl || loginBlocked) {
      availability = 'login-required';
      message =
        tracks.length > 0
          ? '字幕轨道存在，但当前会话未登录，B 站不返回字幕文件地址。请先在浏览器登录 B 站账号，再重新获取'
          : '该视频的字幕仅登录后可见，请先在浏览器中登录 B 站账号，再重新获取';
    } else if (tracks.length > 0) {
      // 已登录、轨道也没被锁定，但接口仍然没下发地址：只能如实说明，不能编原因
      availability = 'all-locked';
      message =
        '字幕轨道存在，但接口这次没有返回字幕文件地址（可能被风控，或该轨道已临时下线）。请稍后重试，或导入本地字幕';
    } else {
      availability = 'empty';
      message = '该视频没有可用字幕，可导入本地字幕文件';
    }

    return {
      availability,
      tracks,
      message,
      loginRequired: needsLoginForUrl || loginBlocked,
      cid: video.cid,
      videoTitle: video.title,
      videoDurationSeconds: video.durationSeconds,
      fetchedAt: Date.now()
    };
  }
}
