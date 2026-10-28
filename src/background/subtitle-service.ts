import { BilibiliApi } from '@/core/bilibili/api';
import { BILIBILI_API_RETRIES, BILIBILI_API_TIMEOUT_MS } from '@/core/config/app';
import { AppError } from '@/core/errors/app-error';
import { BilibiliSubtitleProvider } from '@/core/subtitle/bilibili-provider';
import { buildNormalizedSubtitle } from '@/core/subtitle/normalize';
import { parseSubtitleContent } from '@/core/subtitle/parsers';
import {
  SUBTITLE_LIMITS,
  type NormalizedSubtitle,
  type SubtitleDiscovery
} from '@/core/subtitle/types';
import type { SubtitleRepository } from '@/core/storage/subtitle-repository';
import type { VideoIdentity } from '@/core/video/types';
import { ContentScriptTransport } from './transports/content-script-transport';
import { FetchTransport } from './transports/fetch-transport';

/**
 * 字幕服务：编排 Provider 与仓储。
 * Service Worker 不持有必须跨重启保留的状态，字幕写入 chrome.storage。
 */
export class SubtitleService {
  private readonly provider: BilibiliSubtitleProvider;

  constructor(private readonly repository: SubtitleRepository) {
    const api = new BilibiliApi(new FetchTransport(), {
      timeoutMs: BILIBILI_API_TIMEOUT_MS,
      retries: BILIBILI_API_RETRIES
    });
    this.provider = new BilibiliSubtitleProvider(api);
  }

  private createFallbackApi(tabId: number): BilibiliApi {
    return new BilibiliApi(new ContentScriptTransport(tabId), {
      timeoutMs: BILIBILI_API_TIMEOUT_MS,
      retries: 0
    });
  }

  async discover(identity: VideoIdentity, tabId: number): Promise<SubtitleDiscovery> {
    return this.provider.discover(identity, { fallbackApi: this.createFallbackApi(tabId) });
  }

  async fetch(identity: VideoIdentity, tabId: number, trackId: string): Promise<NormalizedSubtitle> {
    const subtitle = await this.provider.fetch(identity, trackId, {
      fallbackApi: this.createFallbackApi(tabId)
    });
    await this.repository.save(subtitle);
    return subtitle;
  }

  async importFromFile(
    identity: VideoIdentity,
    fileName: string,
    content: string
  ): Promise<NormalizedSubtitle> {
    if (fileName.trim().length === 0) {
      throw new AppError('E_INVALID_PAYLOAD', { message: '缺少字幕文件名' });
    }
    const bytes = new TextEncoder().encode(content).length;
    if (bytes > SUBTITLE_LIMITS.maxFileBytes) {
      throw new AppError('E_SUBTITLE_PARSE_FAILED', {
        message: `字幕文件超过 ${Math.round(SUBTITLE_LIMITS.maxFileBytes / 1024 / 1024)}MB 上限`,
        details: `${bytes} 字节`
      });
    }

    const parsed = parseSubtitleContent({ content, fileName });
    const subtitle = buildNormalizedSubtitle({
      videoKey: identity.key,
      trackId: `import:${parsed.format}`,
      lang: 'unknown',
      label: `导入字幕（${parsed.format.toUpperCase()}）`,
      source: 'import',
      format: parsed.format,
      rawCues: parsed.cues,
      importedFileName: fileName
    });
    await this.repository.save(subtitle);
    return subtitle;
  }

  async getCached(videoKey: string): Promise<NormalizedSubtitle | null> {
    return this.repository.read(videoKey);
  }

  async clear(videoKey: string): Promise<{ cleared: boolean }> {
    await this.repository.remove(videoKey);
    return { cleared: true };
  }
}
