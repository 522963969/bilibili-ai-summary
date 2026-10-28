import { toErrorPayload } from '@/core/errors/app-error';
import { SettingsRepository } from '@/core/storage/settings-repository';
import { SubtitleRepository } from '@/core/storage/subtitle-repository';
import { createExtensionStore } from '@/core/storage/store';
import { FrameService } from './frame-service';
import { createAiHandlers } from './handlers/ai';
import { createExportHandlers } from './handlers/export';
import { createFrameHandlers } from './handlers/frames';
import { createSettingsHandlers } from './handlers/settings';
import { createSubtitleHandlers } from './handlers/subtitle';
import { createSummaryHandlers } from './handlers/summary';
import { createSystemHandlers } from './handlers/system';
import { createTabHandlers } from './handlers/tab';
import { createVideoHandlers } from './handlers/video';
import { createMessageRouter, type HandlerRegistry } from './router';
import { SubtitleService } from './subtitle-service';
import { SummaryService } from './summary-service';

/**
 * Service Worker 入口。
 *
 * 职责边界：
 * - 消息路由与协议校验
 * - 依赖装配（存储、Provider、服务）
 * - 不在此处编写业务规则
 *
 * 注意：Service Worker 会被浏览器随时回收，任何运行态都必须保存在 chrome.storage 中。
 */
const store = createExtensionStore();
const settingsRepository = new SettingsRepository(store);
const subtitleRepository = new SubtitleRepository(store);
const subtitleService = new SubtitleService(subtitleRepository);
const summaryService = new SummaryService({
  settings: settingsRepository,
  subtitles: subtitleRepository,
  store
});
const frameService = new FrameService({
  settings: settingsRepository,
  summary: summaryService,
  store
});

const registry: HandlerRegistry = {
  ...createSystemHandlers(),
  ...createSettingsHandlers({ settings: settingsRepository }),
  ...createVideoHandlers(),
  ...createTabHandlers(),
  ...createSubtitleHandlers({ subtitles: subtitleService, store }),
  ...createAiHandlers({ settings: settingsRepository }),
  ...createSummaryHandlers({ summary: summaryService }),
  ...createFrameHandlers({ frames: frameService, settings: settingsRepository }),
  ...createExportHandlers()
};

const route = createMessageRouter(registry);

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    void route(message, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: toErrorPayload(error) });
      });
    // 异步响应：保持消息通道开启
    return true;
  }
);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装引导用户完成模型配置；失败不影响扩展可用性。
    chrome.runtime.openOptionsPage().catch(() => undefined);
  }
});
