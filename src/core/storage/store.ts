import { AppError } from '@/core/errors/app-error';

/**
 * 存储抽象。
 * 业务层只依赖该接口，单元测试可用内存实现替换 chrome.storage。
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

function hasChromeLocalStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

/** chrome.storage.local 实现：仅本地、不同步，适合保存 API Key。 */
export class ChromeLocalStore implements KeyValueStore {
  async get<T>(key: string): Promise<T | undefined> {
    this.assertAvailable();
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] as T | undefined;
    } catch (error) {
      throw new AppError('E_STORAGE_FAILED', { details: String(error) });
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.assertAvailable();
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (error) {
      throw new AppError('E_STORAGE_FAILED', { details: String(error) });
    }
  }

  async remove(key: string): Promise<void> {
    this.assertAvailable();
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      throw new AppError('E_STORAGE_FAILED', { details: String(error) });
    }
  }

  async keys(): Promise<string[]> {
    this.assertAvailable();
    try {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all);
    } catch (error) {
      throw new AppError('E_STORAGE_FAILED', { details: String(error) });
    }
  }

  private assertAvailable(): void {
    if (!hasChromeLocalStorage()) {
      throw new AppError('E_STORAGE_UNAVAILABLE', {
        details: 'chrome.storage.local 不存在，可能不在扩展环境中运行'
      });
    }
  }
}

/** 测试与降级场景使用的内存实现。 */
export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, unknown>();

  constructor(initial?: Record<string, unknown>) {
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.data.set(key, structuredClone(value));
      }
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.data.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.data.keys()];
  }
}

/** 扩展运行时统一入口。 */
export function createExtensionStore(): KeyValueStore {
  return new ChromeLocalStore();
}
