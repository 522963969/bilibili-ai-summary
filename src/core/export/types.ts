/**
 * 导出领域类型。
 *
 * SummaryResult 本身只有内容，不含「这是哪个视频」。
 * 标题、UP 主、链接来自视频身份与页面上下文，因此统一由 ExportContext 携带，
 * 生成函数保持纯函数，便于单测与后续接入其它导出格式。
 */

import type { SummaryResult } from '@/core/summary/types';

export interface ExportContext {
  /** 视频标题；无法读取时应传入兜底文案，不要传空串 */
  title: string;
  author: string | null;
  /** 规范化链接（不含跟踪参数），缺失时导出内容不写链接 */
  url: string | null;
  /** 稳定视频键，用作文件名的兜底，例如 BV1xx411c7mD#p2 */
  videoKey: string | null;
  result: SummaryResult;
}

export const EXPORT_LIMITS = {
  /** 文件名主体的最大字符数（不含扩展名与后缀） */
  maxFileNameChars: 60,
  /** 幕布大纲里「概述」最多拆成几个子节点，超出部分合并进最后一个 */
  mubuOverviewSentences: 10
} as const;
