/**
 * 统一错误码。所有跨上下文（Popup / Options / Service Worker / Content Script）
 * 的错误都以此枚举描述，界面根据 code 决定展示与可重试性。
 */
export type ErrorCode =
  // 通用
  | 'E_INTERNAL'
  | 'E_UNKNOWN_MESSAGE'
  | 'E_INVALID_PAYLOAD'
  | 'E_RUNTIME_UNAVAILABLE'
  | 'E_TIMEOUT'
  // 存储
  | 'E_STORAGE_UNAVAILABLE'
  | 'E_STORAGE_FAILED'
  // 视频与页面
  | 'E_NO_ACTIVE_TAB'
  | 'E_NOT_BILIBILI_PAGE'
  | 'E_UNSUPPORTED_PAGE'
  | 'E_CONTENT_SCRIPT_UNAVAILABLE'
  // 设置与权限
  | 'E_SETTINGS_INVALID'
  | 'E_PERMISSION_DENIED'
  // 网络与模型（阶段 3 起使用）
  | 'E_NETWORK_FAILED'
  | 'E_API_HTTP_ERROR'
  | 'E_API_UNAUTHORIZED'
  | 'E_API_RATE_LIMITED'
  | 'E_API_RESPONSE_INVALID'
  | 'E_MODEL_OUTPUT_INVALID'
  // 字幕与任务（阶段 2、4 起使用）
  | 'E_SUBTITLE_UNAVAILABLE'
  | 'E_SUBTITLE_PARSE_FAILED'
  | 'E_TASK_CANCELLED'
  | 'E_TASK_NOT_FOUND'
  // 画面识别（阶段 5 起使用）
  | 'E_FRAME_CAPTURE_UNAVAILABLE'
  // 导出（Markdown / 幕布大纲）
  | 'E_CLIPBOARD_DENIED'
  | 'E_DOWNLOAD_FAILED';

/** 面向用户的中文提示。技术细节通过 details 字段附加。 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  E_INTERNAL: '扩展内部错误',
  E_UNKNOWN_MESSAGE: '未知的消息类型',
  E_INVALID_PAYLOAD: '请求参数不合法',
  E_RUNTIME_UNAVAILABLE: '扩展服务未响应，请重新打开面板或重新加载扩展',
  E_TIMEOUT: '操作超时',
  E_STORAGE_UNAVAILABLE: '扩展存储不可用',
  E_STORAGE_FAILED: '读写扩展存储失败',
  E_NO_ACTIVE_TAB: '未找到当前标签页',
  E_NOT_BILIBILI_PAGE: '当前标签页不是 B 站视频页面',
  E_UNSUPPORTED_PAGE: '当前页面暂不支持',
  E_CONTENT_SCRIPT_UNAVAILABLE: '页面脚本未连接，请刷新 B 站页面后重试',
  E_SETTINGS_INVALID: '设置内容不合法',
  E_PERMISSION_DENIED: '未获得该域名的访问授权',
  E_NETWORK_FAILED: '网络请求失败',
  E_API_HTTP_ERROR: '模型接口返回错误状态',
  E_API_UNAUTHORIZED: 'API Key 无效或已过期',
  E_API_RATE_LIMITED: '请求过于频繁，请稍后再试',
  E_API_RESPONSE_INVALID: '模型接口返回的数据格式无法识别',
  E_MODEL_OUTPUT_INVALID: '模型输出不符合要求的结构',
  E_SUBTITLE_UNAVAILABLE: '该视频没有可用字幕',
  E_SUBTITLE_PARSE_FAILED: '字幕文件解析失败',
  E_TASK_CANCELLED: '任务已取消',
  E_TASK_NOT_FOUND: '任务不存在或已被清理',
  E_FRAME_CAPTURE_UNAVAILABLE: '无法从当前页面抽取画面',
  E_CLIPBOARD_DENIED: '无法写入剪贴板，请点击面板后再重试',
  E_DOWNLOAD_FAILED: '导出文件失败，请刷新 B 站页面后重试'
};

/** 默认允许重试的错误码。 */
const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'E_TIMEOUT',
  'E_NETWORK_FAILED',
  'E_API_RATE_LIMITED',
  'E_API_HTTP_ERROR',
  'E_API_RESPONSE_INVALID'
]);

export function isRetryableCode(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}
