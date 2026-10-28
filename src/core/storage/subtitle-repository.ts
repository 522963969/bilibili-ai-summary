import { STORAGE_KEYS } from '@/core/config/defaults';
import { AppError } from '@/core/errors/app-error';
import type { KeyValueStore } from './store';
import type { NormalizedSubtitle, SubtitleCue } from '@/core/subtitle/types';

/** 单条字幕的体积上限：chrome.storage.local 默认配额为 10MB，这里留出余量。 */
const MAX_SERIALIZED_BYTES = 4 * 1024 * 1024;

function isCue(value: unknown): value is SubtitleCue {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.index === 'number' &&
    typeof record.startMs === 'number' &&
    typeof record.endMs === 'number' &&
    typeof record.text === 'string'
  );
}

function isNormalizedSubtitle(value: unknown): value is NormalizedSubtitle {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.videoKey === 'string' &&
    typeof record.trackId === 'string' &&
    Array.isArray(record.cues) &&
    record.cues.every(isCue) &&
    typeof record.stats === 'object' &&
    record.stats !== null
  );
}

/** 字幕持久化：按视频键存取，读取时做结构校验，损坏数据视为未缓存。 */
export class SubtitleRepository {
  constructor(private readonly store: KeyValueStore) {}

  private storageKey(videoKey: string): string {
    return `${STORAGE_KEYS.subtitlePrefix}${videoKey}`;
  }

  async read(videoKey: string): Promise<NormalizedSubtitle | null> {
    const stored = await this.store.get<unknown>(this.storageKey(videoKey));
    if (stored === undefined) return null;
    if (!isNormalizedSubtitle(stored)) {
      await this.store.remove(this.storageKey(videoKey)).catch(() => undefined);
      return null;
    }
    return stored;
  }

  async save(subtitle: NormalizedSubtitle): Promise<void> {
    const serialized = JSON.stringify(subtitle);
    if (serialized.length > MAX_SERIALIZED_BYTES) {
      throw new AppError('E_STORAGE_FAILED', {
        message: '字幕体积过大，无法保存（超过 4MB）',
        details: `${subtitle.cues.length} 条 / ${serialized.length} 字符`
      });
    }
    await this.store.set(this.storageKey(subtitle.videoKey), subtitle);
  }

  async remove(videoKey: string): Promise<void> {
    await this.store.remove(this.storageKey(videoKey));
  }

  async listVideoKeys(): Promise<string[]> {
    const keys = await this.store.keys();
    const prefix = STORAGE_KEYS.subtitlePrefix;
    return keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
  }
}
