import { DEFAULT_SETTINGS, STORAGE_KEYS } from '@/core/config/defaults';
import { isModelConfigured, isVisionConfigured, normalizeSettings } from '@/core/settings/normalize';
import type { ExtensionSettings, SettingsPatch } from '@/core/settings/types';
import type { KeyValueStore } from '@/core/storage/store';

export interface SettingsSnapshot {
  settings: ExtensionSettings;
  modelConfigured: boolean;
  /** 视觉模型已配置，可执行「按画面识别」；未配置时界面不显示该入口 */
  visionConfigured: boolean;
}

export interface SettingsUpdateResult extends SettingsSnapshot {
  issues: string[];
}

export interface SettingsRepositoryLike {
  read(): Promise<SettingsSnapshot>;
  update(patch: SettingsPatch): Promise<SettingsUpdateResult>;
  reset(): Promise<SettingsSnapshot>;
}

function cloneDefaults(): ExtensionSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

/**
 * 设置仓储：唯一的设置读写入口。
 * Service Worker 可能被随时回收，因此不缓存状态，每次从存储读取并规范化。
 */
export class SettingsRepository implements SettingsRepositoryLike {
  constructor(private readonly store: KeyValueStore) {}

  async read(): Promise<SettingsSnapshot> {
    const stored = await this.store.get<unknown>(STORAGE_KEYS.settings);
    if (stored === undefined) {
      return this.toSnapshot(cloneDefaults());
    }
    const { settings } = normalizeSettings(stored);
    return this.toSnapshot(settings);
  }

  async update(patch: SettingsPatch): Promise<SettingsUpdateResult> {
    const current = await this.read();
    const merged: ExtensionSettings = {
      schemaVersion: current.settings.schemaVersion,
      model: { ...current.settings.model, ...patch.model },
      vision: { ...current.settings.vision, ...patch.vision },
      chunk: { ...current.settings.chunk, ...patch.chunk },
      frames: { ...current.settings.frames, ...patch.frames },
      general: { ...current.settings.general, ...patch.general },
      updatedAt: Date.now()
    };
    const { settings, issues } = normalizeSettings(merged);
    await this.store.set(STORAGE_KEYS.settings, settings);
    return { ...this.toSnapshot(settings), issues };
  }

  async reset(): Promise<SettingsSnapshot> {
    const next = cloneDefaults();
    next.updatedAt = Date.now();
    await this.store.set(STORAGE_KEYS.settings, next);
    return this.toSnapshot(next);
  }

  private toSnapshot(settings: ExtensionSettings): SettingsSnapshot {
    return {
      settings,
      modelConfigured: isModelConfigured(settings.model),
      visionConfigured: isVisionConfigured(settings)
    };
  }
}
