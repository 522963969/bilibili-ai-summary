/**
 * 应用级常量：名称、版本、平台地址。
 * 该文件在构建期被 manifest 配置引用，必须保持无副作用、无浏览器 API 依赖。
 */

export const APP_NAME = 'B站 AI 视频总结';
export const APP_SHORT_NAME = 'B站 AI 总结';
/**
 * 商店与 manifest 共用的简介。
 *
 * 只写**已经能用**的能力。tests/app-meta.test.ts 会对这里出现的每个关键词
 * 检查对应模块是否真的存在，避免文案跑到实现前面。
 */
export const APP_DESCRIPTION =
  '在 B 站视频页读取字幕，用你自己的 OpenAI 兼容模型生成摘要、知识点与章节，导出思维导图 SVG / PNG 与 Markdown；没有字幕时可按画面识别。';
/**
 * 版本号的唯一来源是 package.json，这里必须与之一致。
 * tests/app-meta.test.ts 会断言两者相等，避免发版时漏改一处。
 */
export const APP_VERSION = '1.0.2';

export const BILIBILI_ORIGIN = 'https://www.bilibili.com';

/**
 * 幕布工作台入口。
 *
 * 幕布没有公开的文档写入 API，扩展无法直接在其账号下建文档；
 * 「复制到幕布」只负责把大纲放进剪贴板并把这个页面打开，由用户粘贴。
 */
export const MUBU_APP_URL = 'https://mubu.com/app';

/** Content Script 注入范围：仅 B 站视频播放页。 */
export const BILIBILI_VIDEO_MATCHES = ['https://www.bilibili.com/video/*'] as const;

/**
 * 宿主级匹配模式，用于 web_accessible_resources。
 * 注意：WAR 的 matches 不接受 `/video/*` 这类窄路径（Chrome 会报
 * Invalid match pattern 并拒绝加载整个扩展），必须使用宿主级通配。
 */
export const BILIBILI_HOST_MATCH = 'https://www.bilibili.com/*';

/** B 站接口请求超时与重试（毫秒 / 次数）。 */
export const BILIBILI_API_TIMEOUT_MS = 12000;
export const BILIBILI_API_RETRIES = 1;

/** 后台与 Content Script 通信的超时时间（毫秒）。 */
export const CONTENT_SCRIPT_TIMEOUT_MS = 1500;

/** 扩展页面与 Service Worker 通信的超时时间（毫秒）。 */
export const RUNTIME_MESSAGE_TIMEOUT_MS = 8000;
