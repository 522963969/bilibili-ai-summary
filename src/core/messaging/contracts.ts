import type { AiTestResult } from '@/core/ai/types';
import type { ErrorPayload } from '@/core/errors/app-error';
import type {
  CapturedFrame,
  FrameCaptureProgress,
  FrameCaptureSummary,
  FramePushResult,
  FrameScriptDocument,
  FrameSelectOptions,
  FrameStartResult
} from '@/core/frames/types';
import type { SettingsSnapshot, SettingsUpdateResult } from '@/core/storage/settings-repository';
import type { SettingsPatch } from '@/core/settings/types';
import type { NormalizedSubtitle, SubtitleDiscovery } from '@/core/subtitle/types';
import type { SummaryTaskSnapshot } from '@/core/summary/types';
import type { ActiveVideoResolution, TabIdentity, VideoPageContext } from '@/core/video/types';

/**
 * 扩展页面（Popup / Options / Panel）与 Service Worker 之间的消息契约。
 * 新增能力时先在此声明类型，再在 handler 注册表中实现，避免隐式协议。
 */
export interface ApiContractMap {
  'app.ping': { payload: undefined; result: AppPingResult };
  'video.resolveActive': { payload: undefined; result: ActiveVideoResolution };
  /** 由 Content Script 或页面内面板发起：以 sender.tab 为准，不依赖 activeTab */
  'video.resolveFromTab': { payload: undefined; result: ActiveVideoResolution };
  /** Content Script 自报 tabId 与视频身份，用于页面内入口 */
  'tab.whoami': { payload: undefined; result: TabIdentity };
  'settings.get': { payload: undefined; result: SettingsSnapshot };
  'settings.update': { payload: { patch: SettingsPatch }; result: SettingsUpdateResult };
  'settings.reset': { payload: undefined; result: SettingsSnapshot };
  'subtitle.discover': { payload: { tabId: number }; result: SubtitleDiscovery };
  'subtitle.fetch': { payload: { tabId: number; trackId: string }; result: NormalizedSubtitle };
  'subtitle.import': {
    payload: { tabId: number; fileName: string; content: string };
    result: NormalizedSubtitle;
  };
  'subtitle.getCached': {
    payload: { videoKey: string };
    result: { subtitle: NormalizedSubtitle | null };
  };
  'subtitle.clear': { payload: { videoKey: string }; result: { cleared: boolean } };
  /** 连接测试：使用已保存的设置发起一次最小请求 */
  'ai.testConnection': { payload: undefined; result: AiTestResult };
  /** 视觉模型测试：真正发一张图片，验证该模型是否接受图片输入 */
  'ai.testVision': { payload: undefined; result: AiTestResult };
  /** 开始总结。字幕必须已在本地缓存，避免重复拉取 */
  'summary.start': { payload: { tabId: number }; result: SummaryTaskSnapshot };
  'summary.get': {
    payload: { videoKey: string };
    result: { task: SummaryTaskSnapshot | null };
  };
  'summary.cancel': { payload: { videoKey: string }; result: { cancelled: boolean } };
  /** 无字幕时改用画面识别：由后台向页面下发抽帧指令，立即返回任务快照 */
  'frames.start': { payload: { tabId: number; force?: boolean }; result: SummaryTaskSnapshot };
  /** 内容脚本分批推送抽帧结果；后台在这里同步调用视觉模型，用返回的 accepted 做背压 */
  'frames.push': {
    payload: { videoKey: string; frames: CapturedFrame[]; progress: FrameCaptureProgress | null };
    result: FramePushResult;
  };
  /** 抽帧结束（成功或失败），后台据此收尾并进入总结阶段 */
  'frames.finish': {
    payload: { videoKey: string; capture: FrameCaptureSummary | null; error: string | null };
    result: { accepted: boolean };
  };
  'frames.getScript': {
    payload: { videoKey: string };
    result: { script: FrameScriptDocument | null };
  };
  /**
   * 请求页面停下抽帧。
   *
   * 只发一条消息不行：`frames.push` 的 accepted 只在「下一批推送」时才被读到，
   * 而探索阶段可能几十秒不推批次。因此取消要单独通知页面置标志位，
   * 让 seek 循环在下一个候选点就退出。
   */
  'frames.stop': {
    payload: { tabId: number; videoKey: string };
    result: { stopped: boolean };
  };
  /** 清除已缓存的画面讲稿，下次重新抽帧识别 */
  'frames.clear': { payload: { videoKey: string }; result: { cleared: boolean } };
  /** 打开幕布工作台（幕布无公开写入 API，只能由用户在其页面粘贴） */
  'export.openMubu': { payload: undefined; result: { opened: boolean } };
  /** 导出文件：交给目标页面的顶层文档下载，避开跨源 iframe 的下载限制 */
  'export.download': {
    payload: {
      tabId: number;
      fileName: string;
      text: string;
      mime: string;
      /** 缺省按纯文本处理；PNG 等二进制传 base64 */
      encoding?: 'utf8' | 'base64';
    };
    result: { started: boolean };
  };
}

export interface AppPingResult {
  version: string;
  timestamp: number;
}

/** 运行时消息类型清单，与 ApiContractMap 的键强绑定（见 ContractKeyCheck）。 */
export const MESSAGE_TYPES = [
  'app.ping',
  'video.resolveActive',
  'video.resolveFromTab',
  'tab.whoami',
  'settings.get',
  'settings.update',
  'settings.reset',
  'subtitle.discover',
  'subtitle.fetch',
  'subtitle.import',
  'subtitle.getCached',
  'subtitle.clear',
  'ai.testConnection',
  'ai.testVision',
  'summary.start',
  'summary.get',
  'summary.cancel',
  'frames.start',
  'frames.push',
  'frames.finish',
  'frames.getScript',
  'frames.stop',
  'frames.clear',
  'export.openMubu',
  'export.download'
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** 编译期保证清单与契约键完全一致，避免新增消息漏注册导致运行时 E_UNKNOWN_MESSAGE。 */
export type ContractKeyCheck = [keyof ApiContractMap] extends [MessageType]
  ? [MessageType] extends [keyof ApiContractMap]
    ? true
    : never
  : never;

export type PayloadOf<K extends MessageType> = ApiContractMap[K]['payload'];
export type ResultOf<K extends MessageType> = ApiContractMap[K]['result'];

export type RequestMessage = {
  [K in MessageType]: { type: K; payload: PayloadOf<K> };
}[MessageType];

export type ResponseEnvelope<T> = { ok: true; data: T } | { ok: false; error: ErrorPayload };

export function isRequestMessage(value: unknown): value is RequestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && type.length > 0;
}

export function isKnownMessageType(type: string): type is MessageType {
  return (MESSAGE_TYPES as readonly string[]).includes(type);
}

/**
 * Service Worker 与 Content Script 之间的消息契约。
 * Content Script 只负责页面上下文采集与受限的同源取数，不承载业务逻辑。
 */
export type ContentFetchResult =
  | { ok: true; status: number; text: string }
  | { ok: false; message: string };

/**
 * 打开页面内侧边面板的结果。
 * 失败时用 reason 区分「当前不是视频页」与「页面入口还没挂上」，
 * 让 Popup 能给出针对性提示而不是笼统报错。
 */
export type OpenPanelResult =
  | { opened: true; reason: null }
  | { opened: false; reason: 'not-video-page' | 'entry-unavailable' | 'identity-unresolved' };

export interface ContentContractMap {
  'content.collectPageContext': { payload: undefined; result: VideoPageContext };
  'content.fetchJson': { payload: { url: string }; result: ContentFetchResult };
  'content.openPanel': { payload: undefined; result: OpenPanelResult };
  /**
   * 启动抽帧。只做同步检查后立即返回，抽帧结果通过 frames.push 反向推送，
   * 因为完整抽帧耗时远超消息通道的超时时间。
   */
  'content.startFrames': {
    payload: {
      videoKey: string;
      options: FrameSelectOptions;
      /**
       * 已经识别过的时间点。续跑时页面侧直接跳过这些点，
       * 不再重新 seek + 编码——否则「上次失败后再点一次」会把整个视频重抽一遍。
       */
      skipTimes: number[];
    };
    result: FrameStartResult;
  };
  /** 让页面立刻停止抽帧（用户点了取消）。 */
  'content.stopFrames': { payload: { videoKey: string }; result: { stopped: boolean } };
  /**
   * 由页面顶层文档触发下载。
   *
   * 面板是嵌在 B 站页面里的跨源 iframe，浏览器会把其中的 blob 下载直接取消
   * （实测 downloadWillBegin 后立即 canceled），因此必须交给顶层文档执行。
   *
   * `encoding` 决定 `text` 怎么解读：文本（Markdown / SVG / txt）用 utf8；
   * PNG 这类二进制先由面板转成 base64 再传，避免在消息里塞 Uint8Array。
   */
  'content.download': {
    payload: { fileName: string; text: string; mime: string; encoding?: 'utf8' | 'base64' };
    result: { started: boolean };
  };
}

export type ContentMessageType = keyof ContentContractMap;
export type ContentRequestMessage = {
  [K in ContentMessageType]: { type: K; payload: ContentContractMap[K]['payload'] };
}[ContentMessageType];
