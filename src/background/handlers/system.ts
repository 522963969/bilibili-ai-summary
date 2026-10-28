import { APP_VERSION } from '@/core/config/app';
import type { HandlerRegistry } from '../router';

/** 基础系统消息：用于健康检查与版本号展示。 */
export function createSystemHandlers(): Pick<HandlerRegistry, 'app.ping'> {
  return {
    'app.ping': async () => ({
      version: APP_VERSION,
      timestamp: Date.now()
    })
  };
}
