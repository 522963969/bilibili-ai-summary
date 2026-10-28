import { OpenAiCompatibleProvider } from '@/core/ai/openai-provider';
import { OpenAiVisionProvider } from '@/core/ai/vision-provider';
import type { AiTestResult } from '@/core/ai/types';
import { AppError } from '@/core/errors/app-error';
import { resolveVisionConnection } from '@/core/settings/normalize';
import type { SettingsRepositoryLike } from '@/core/storage/settings-repository';
import type { HandlerRegistry } from '../router';

export interface AiHandlerDeps {
  settings: SettingsRepositoryLike;
}

/** 从 baseUrl 推导出用于权限检查的 origin 模式，格式不正确返回 null。 */
export function originPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

/** 请求前统一检查「域名已授权」，未授权时给出可执行的提示。 */
async function requireOriginGranted(baseUrl: string, label: string): Promise<void> {
  const pattern = originPattern(baseUrl);
  if (!pattern) {
    throw new AppError('E_SETTINGS_INVALID', {
      message: `${label}地址格式不正确，需要以 http:// 或 https:// 开头`
    });
  }
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (!granted) {
    throw new AppError('E_PERMISSION_DENIED', {
      message: `尚未授权该模型域名，请先在设置页点击「授权该域名」`,
      details: pattern
    });
  }
}

/**
 * 连接测试。
 * 前置条件（未配置、域名未授权）也统一收敛为 AiTestResult，
 * 让界面只处理一种返回结构。
 */
export function createAiHandlers(
  deps: AiHandlerDeps
): Pick<HandlerRegistry, 'ai.testConnection' | 'ai.testVision'> {
  return {
    'ai.testConnection': async (): Promise<AiTestResult> => {
      const startedAt = Date.now();
      try {
        const { settings, modelConfigured } = await deps.settings.read();
        if (!modelConfigured) {
          throw new AppError('E_SETTINGS_INVALID', {
            message: '请先填写 Base URL、API Key 与模型名称并保存'
          });
        }
        await requireOriginGranted(settings.model.baseUrl, 'Base URL ');
        return await new OpenAiCompatibleProvider(settings).testConnection();
      } catch (error) {
        const appError = AppError.from(error);
        return {
          ok: false,
          model: null,
          latencyMs: Date.now() - startedAt,
          message: appError.message,
          errorCode: appError.code
        };
      }
    },

    /**
     * 视觉模型测试。
     * 与文本测试的区别是**真的发一张图片**：只有这样才能确认模型接受图片输入，
     * 否则用户会在抽帧耗掉几十秒之后才收到一句看不懂的接口报错。
     */
    'ai.testVision': async (): Promise<AiTestResult> => {
      const startedAt = Date.now();
      try {
        const { settings } = await deps.settings.read();
        const connection = resolveVisionConnection(settings);
        if (!connection) {
          throw new AppError('E_SETTINGS_INVALID', {
            message: '请先填写视觉模型名称并保存；若与主模型连接不同，还需填写视觉模型自己的 Base URL 与 API Key'
          });
        }
        await requireOriginGranted(connection.baseUrl, '视觉模型 Base URL ');
        return await new OpenAiVisionProvider({
          baseUrl: connection.baseUrl,
          apiKey: connection.apiKey,
          model: connection.model,
          timeoutMs: settings.model.timeoutMs
        }).testConnection();
      } catch (error) {
        const appError = AppError.from(error);
        return {
          ok: false,
          model: null,
          latencyMs: Date.now() - startedAt,
          message: appError.message,
          errorCode: appError.code
        };
      }
    }
  };
}
