import { AppError } from '@/core/errors/app-error';
import type { SettingsRepository } from '@/core/storage/settings-repository';
import type { SettingsPatch } from '@/core/settings/types';
import type { HandlerRegistry } from '../router';

export interface SettingsHandlerDeps {
  settings: SettingsRepository;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 运行时校验 patch 结构。
 * 字段取值范围交给 normalizeSettings 统一收敛，这里只拒绝结构性错误。
 */
function assertSettingsPatch(value: unknown): SettingsPatch {
  if (!isPlainObject(value)) {
    throw new AppError('E_INVALID_PAYLOAD', { details: 'patch 必须是对象' });
  }
  for (const section of ['model', 'chunk', 'general'] as const) {
    const candidate = value[section];
    if (candidate !== undefined && !isPlainObject(candidate)) {
      throw new AppError('E_INVALID_PAYLOAD', { details: `patch.${section} 必须是对象` });
    }
  }
  return value as SettingsPatch;
}

export function createSettingsHandlers(
  deps: SettingsHandlerDeps
): Pick<HandlerRegistry, 'settings.get' | 'settings.update' | 'settings.reset'> {
  return {
    'settings.get': async () => deps.settings.read(),

    'settings.update': async (payload) => {
      if (!isPlainObject(payload)) {
        throw new AppError('E_INVALID_PAYLOAD', { details: '缺少 payload.patch' });
      }
      const patch = assertSettingsPatch(payload.patch);
      return deps.settings.update(patch);
    },

    'settings.reset': async () => deps.settings.reset()
  };
}
