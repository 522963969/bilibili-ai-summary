import { AppError } from '@/core/errors/app-error';
import type { VideoIdentity } from '@/core/video/types';
import type { BilibiliEnvelope, BilibiliPlayerData, BilibiliVideoView } from './types';

/** B 站接口基址与访问边界。集中在同一处，便于审计实际请求的域名。 */
export const BILIBILI_API_BASE = 'https://api.bilibili.com';

/** 字幕文件所在 CDN 的域名后缀集合（实际返回可能为 aisubtitle/i0 等子域）。 */
const SUBTITLE_CDN_SUFFIXES = ['.hdslb.com', '.bilibili.com'];

export function buildVideoViewUrl(identity: VideoIdentity): string {
  const params = new URLSearchParams();
  if (identity.bvid) params.set('bvid', identity.bvid);
  else if (identity.aid !== null) params.set('aid', String(identity.aid));
  return `${BILIBILI_API_BASE}/x/web-interface/view?${params.toString()}`;
}

export function buildPlayerUrl(identity: VideoIdentity, cid: number): string {
  const params = new URLSearchParams({ cid: String(cid) });
  if (identity.bvid) params.set('bvid', identity.bvid);
  else if (identity.aid !== null) params.set('aid', String(identity.aid));
  return `${BILIBILI_API_BASE}/x/player/v2?${params.toString()}`;
}

/** 协议相对地址补全为 https。 */
export function absolutizeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('http://')) return `https://${trimmed.slice('http://'.length)}`;
  return null;
}

/**
 * 仅允许访问 B 站接口与字幕 CDN。
 * Content Script 的取数代理也复用该判断，避免成为任意 URL 的代理。
 */
export function isAllowedBilibiliUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'api.bilibili.com') return true;
  return SUBTITLE_CDN_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export interface TransportResponse {
  status: number;
  text: string;
  /** 实际使用的通道，便于诊断 Cookie 是否命中 */
  via: 'background' | 'content-script';
}

/** 网络传输抽象：Service Worker 直连，或退化为页面内同源请求。 */
export interface BilibiliTransport {
  get(url: string, timeoutMs: number): Promise<TransportResponse>;
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * B 站接口客户端。
 * 只负责传输、重试与 JSON 解析；业务语义（需要登录 / 无字幕）交由上层判断。
 */
export class BilibiliApi {
  constructor(
    private readonly transport: BilibiliTransport,
    private readonly options: { timeoutMs: number; retries: number } = {
      timeoutMs: 12000,
      retries: 1
    }
  ) {}

  async getEnvelope<T>(url: string): Promise<BilibiliEnvelope<T>> {
    const text = await this.getText(url);
    try {
      const parsed = JSON.parse(text) as BilibiliEnvelope<T>;
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.code !== 'number') {
        throw new Error('缺少 code 字段');
      }
      return parsed;
    } catch (error) {
      throw new AppError('E_API_RESPONSE_INVALID', {
        message: 'B 站接口返回了无法解析的数据',
        details: `${url} · ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  async getText(url: string): Promise<string> {
    if (!isAllowedBilibiliUrl(url)) {
      throw new AppError('E_PERMISSION_DENIED', {
        message: '拒绝访问未授权的地址',
        details: url
      });
    }

    const attempts = Math.max(1, this.options.retries + 1);
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.transport.get(url, this.options.timeoutMs);
        if (response.status === 412 || response.status === 429) {
          throw new AppError('E_API_RATE_LIMITED', {
            message: 'B 站接口触发了访问限制，请稍后重试',
            details: `HTTP ${response.status}`
          });
        }
        if (response.status >= 400) {
          const retryable = RETRYABLE_STATUS.has(response.status);
          const error = new AppError('E_API_HTTP_ERROR', {
            message: `B 站接口返回 HTTP ${response.status}`,
            details: url,
            retryable
          });
          if (retryable && attempt < attempts) {
            lastError = error;
            await sleep(300 * attempt);
            continue;
          }
          throw error;
        }
        return response.text;
      } catch (error) {
        const appError = AppError.from(error);
        if (appError.code === 'E_API_RATE_LIMITED' || appError.code === 'E_PERMISSION_DENIED') {
          throw appError;
        }
        if (attempt < attempts && (appError.retryable || appError.code === 'E_TIMEOUT')) {
          lastError = appError;
          await sleep(300 * attempt);
          continue;
        }
        if (appError.code === 'E_INTERNAL') {
          throw new AppError('E_NETWORK_FAILED', {
            message: '无法连接 B 站接口',
            details: appError.message
          });
        }
        throw appError;
      }
    }

    throw lastError ?? new AppError('E_NETWORK_FAILED');
  }

  async getVideoView(identity: VideoIdentity): Promise<BilibiliVideoView> {
    const envelope = await this.getEnvelope<BilibiliVideoView>(buildVideoViewUrl(identity));
    if (envelope.code === -404) {
      throw new AppError('E_UNSUPPORTED_PAGE', {
        message: '视频不存在或已被删除',
        details: `code=${envelope.code}`
      });
    }
    if (envelope.code !== 0) {
      throw new AppError('E_API_RESPONSE_INVALID', {
        message: '读取视频信息失败',
        details: `code=${envelope.code} ${envelope.message}`
      });
    }
    return envelope.data;
  }

  async getPlayerData(identity: VideoIdentity, cid: number): Promise<BilibiliPlayerData> {
    const envelope = await this.getEnvelope<BilibiliPlayerData>(buildPlayerUrl(identity, cid));
    if (envelope.code === -101) {
      return { login_mid: 0, need_login_subtitle: true, subtitle: { subtitles: [] } };
    }
    if (envelope.code !== 0) {
      throw new AppError('E_API_RESPONSE_INVALID', {
        message: '读取字幕列表失败',
        details: `code=${envelope.code} ${envelope.message}`
      });
    }
    return envelope.data;
  }
}
