/**
 * 模型调用领域类型。
 * 只描述「与 OpenAI 兼容的 Chat Completions」这一件事，不绑定具体厂商。
 */

export type ChatRole = 'system' | 'user' | 'assistant';

/**
 * 多模态消息片段。
 *
 * 只在需要把图片送给模型时使用；纯文本请求仍然直接给 `content` 传字符串，
 * 这样文本链路不受多模态结构影响，也避免给所有 Provider 增加无谓的复杂度。
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
}

export interface CompletionRequest {
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
  /** 要求模型返回 JSON 时置为 true（由 Provider 决定如何表达） */
  json?: boolean;
}

export interface CompletionUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface CompletionResult {
  content: string;
  usage: CompletionUsage | null;
  model: string | null;
  /** 实际耗时，便于展示与排查 */
  latencyMs: number;
}

export interface AiTestResult {
  ok: boolean;
  /** 服务端回传的模型名，用于确认请求真的到达了模型 */
  model: string | null;
  latencyMs: number;
  message: string;
  /** 失败时的错误码，便于界面区分「密钥错」还是「域名未授权」 */
  errorCode: string | null;
  /**
   * 图片是否真的被模型接收并作答。
   *
   * `ok: true` 只代表接口通了——有些模型（或中转站）会把图片部分**静默丢弃**，
   * 返回 HTTP 200 但 `content` 为空字符串。此时若界面仍显示「图片输入可用」，
   * 用户会以为画面识别能用，实际跑起来只会得到空描述。
   * 因此单独记录这一位：true=真的作答了，false=接口通但没看图，undefined=未验证（环境无法生成测试图）。
   */
  imageAccepted?: boolean;
}

export interface AiProvider {
  /** 发一条最小请求验证配置是否可用 */
  testConnection(): Promise<AiTestResult>;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
