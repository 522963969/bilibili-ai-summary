/**
 * 能力清单：用于 Popup 中的「功能状态」展示。
 *
 * 早期版本这里按开发阶段编号推导状态（`stage <= APP_STAGE`）。
 * 正式版不再对外暴露内部阶段号——用户不关心我们是第几阶段，
 * 只想知道「现在能不能用」。因此状态改为显式声明，
 * **每加一项能力都必须同时写下 ready 的真实值**，不允许先写 true 再补实现。
 */
export interface CapabilityItem {
  id: string;
  label: string;
  /** 面向用户的一句话说明，避免出现内部术语 */
  summary: string;
  /** true = 当前版本已可用；false = 还没做，界面会标「暂未支持」 */
  ready: boolean;
}

export const CAPABILITIES: readonly CapabilityItem[] = [
  { id: 'video', label: '视频识别与页面上下文', summary: '读取当前视频的标题、UP 主与分P', ready: true },
  { id: 'settings', label: '设置与本地存储', summary: '模型参数、分块参数、主题', ready: true },
  { id: 'subtitle', label: '字幕获取与导入', summary: '自动匹配字幕轨道，也可导入 SRT / VTT', ready: true },
  { id: 'model', label: '模型连接与测试', summary: '兼容 OpenAI 协议的任意服务', ready: true },
  { id: 'summary', label: '长视频总结与断点续跑', summary: '分块总结、并发请求、失败只重跑未完成的段', ready: true },
  { id: 'entry', label: '页面内入口与就地展开', summary: 'B 站右侧信息栏按钮，点开在下方展开', ready: true },
  { id: 'frames', label: '无字幕画面识别', summary: '自动抽帧交给视觉模型，结果标注来源', ready: true },
  { id: 'markdown', label: '导出 Markdown / 幕布大纲 / 字幕 txt', summary: '下载 .md、复制大纲到幕布', ready: true },
  { id: 'export', label: '思维导图导出', summary: '知识点与章节树，导出 SVG / PNG', ready: true },
  { id: 'history', label: '历史记录与去重', summary: '跨视频的总结历史、重复任务处理', ready: false }
];
