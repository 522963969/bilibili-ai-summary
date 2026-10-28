import { BILIBILI_ORIGIN } from '@/core/config/app';
import type { BilibiliPageKind, VideoIdentity } from './types';

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const AID_PATTERN = /^av(\d{1,20})$/i;
const EP_ID_PATTERN = /^ep(\d{1,20})$/i;
const SEASON_ID_PATTERN = /^ss(\d{1,20})$/i;

function isBilibiliHost(hostname: string): boolean {
  return hostname === 'www.bilibili.com' || hostname === 'bilibili.com';
}

/** 分 P 参数：非法或缺失一律回落到第 1 分 P。 */
export function parsePageParam(raw: string | null): number {
  if (!raw) return 1;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, 2000);
}

function buildCanonicalUrl(kind: BilibiliPageKind, identity: {
  bvid: string | null;
  aid: number | null;
  epId: string | null;
  seasonId: string | null;
  page: number;
}): string {
  if (kind === 'bangumi') {
    if (identity.epId) return `${BILIBILI_ORIGIN}/bangumi/play/ep${identity.epId}`;
    return `${BILIBILI_ORIGIN}/bangumi/play/ss${identity.seasonId ?? ''}`;
  }
  const path = identity.bvid ? `video/${identity.bvid}` : `video/av${identity.aid ?? ''}`;
  const suffix = identity.page > 1 ? `?p=${identity.page}` : '';
  return `${BILIBILI_ORIGIN}/${path}${suffix}`;
}

function buildKey(kind: BilibiliPageKind, identity: {
  bvid: string | null;
  aid: number | null;
  epId: string | null;
  seasonId: string | null;
  page: number;
}): string {
  if (kind === 'bangumi') {
    return identity.epId ? `ep${identity.epId}` : `ss${identity.seasonId ?? 'unknown'}`;
  }
  if (identity.bvid) return `${identity.bvid}#p${identity.page}`;
  return `av${identity.aid ?? 'unknown'}#p${identity.page}`;
}

/**
 * 解析 B 站视频链接。
 * 只处理可被 Content Script 注入的公开页面结构，不猜测未公开的接口。
 * 无法识别时返回 null，由调用方给出明确提示。
 */
export function parseBilibiliVideoUrl(rawUrl: string): VideoIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!isBilibiliHost(url.hostname)) return null;

  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  const [first, second, third] = segments;

  if (first === 'video' && second) {
    const page = parsePageParam(url.searchParams.get('p'));
    if (BVID_PATTERN.test(second)) {
      const partial = { bvid: second, aid: null, epId: null, seasonId: null, page };
      return {
        platform: 'bilibili',
        kind: 'video',
        ...partial,
        key: buildKey('video', partial),
        canonicalUrl: buildCanonicalUrl('video', partial)
      };
    }
    const aidMatch = AID_PATTERN.exec(second);
    if (aidMatch?.[1]) {
      const partial = {
        bvid: null,
        aid: Number.parseInt(aidMatch[1], 10),
        epId: null,
        seasonId: null,
        page
      };
      return {
        platform: 'bilibili',
        kind: 'video',
        ...partial,
        key: buildKey('video', partial),
        canonicalUrl: buildCanonicalUrl('video', partial)
      };
    }
    return null;
  }

  if (first === 'bangumi' && second === 'play' && third) {
    const epMatch = EP_ID_PATTERN.exec(third);
    if (epMatch?.[1]) {
      const partial = { bvid: null, aid: null, epId: epMatch[1], seasonId: null, page: 1 };
      return {
        platform: 'bilibili',
        kind: 'bangumi',
        ...partial,
        key: buildKey('bangumi', partial),
        canonicalUrl: buildCanonicalUrl('bangumi', partial)
      };
    }
    const seasonMatch = SEASON_ID_PATTERN.exec(third);
    if (seasonMatch?.[1]) {
      const partial = { bvid: null, aid: null, epId: null, seasonId: seasonMatch[1], page: 1 };
      return {
        platform: 'bilibili',
        kind: 'bangumi',
        ...partial,
        key: buildKey('bangumi', partial),
        canonicalUrl: buildCanonicalUrl('bangumi', partial)
      };
    }
    return null;
  }

  return null;
}

/** 该链接是否属于 Content Script 注入范围（普通投稿播放页）。 */
export function isContentScriptEligibleUrl(rawUrl: string): boolean {
  const identity = parseBilibiliVideoUrl(rawUrl);
  return identity !== null && identity.kind === 'video';
}
