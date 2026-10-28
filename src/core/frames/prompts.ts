import type { ChatContentPart, ChatMessage } from '@/core/ai/types';
import type { CapturedFrame } from './types';

/**
 * 画面识别的提示词。
 *
 * 关键约束：
 * 1. 模型只能看到静帧，听不到声音、也看不到帧与帧之间发生了什么，
 *    因此必须明确禁止它编造对白、音效与剧情。
 * 2. 输出使用「序号 | 描述」这种极简格式，不依赖 `response_format: json_object`
 *    （并非所有视觉模型都支持该参数），由我方按序号回填时间戳，
 *    模型即使写错顺序也不会导致时间点错位。
 */

function clock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export const FRAME_SYSTEM_PROMPT = [
  '你是严谨的视频画面解说助手。你会收到同一段视频按时间顺序排列的若干截图。',
  '请为每一张截图写一句客观描述，用于在没有字幕的情况下重建视频内容。',
  '规则：',
  '1. 只描述画面中真实可见的内容：场景、人物、文字、图表、操作、字幕条等。',
  '2. 你听不到声音，绝对不要编造对白、旁白、音效或画面之外的剧情推断。',
  '3. 若画面是纯色、黑屏、转场或无信息画面，写「无明确画面信息」。',
  '4. 画面中出现的文字（标题、代码、PPT 要点、界面文案）必须原样摘录，这对理解内容最关键。',
  '5. 每条描述不超过 60 个汉字，客观陈述，不加评价。',
  '6. 严格按「序号 | 描述」一行一条输出，序号使用我给每张图标注的编号，不要输出其它内容。'
].join('\n');

export interface FramePromptContext {
  videoTitle: string | null;
  /** 本批第一帧在整条视频中的序号（从 1 开始），用于让模型回填正确编号 */
  startIndex: number;
}

export function buildFrameMessages(
  frames: CapturedFrame[],
  context: FramePromptContext
): ChatMessage[] {
  const parts: ChatContentPart[] = [];
  const header = [
    context.videoTitle ? `视频标题：${context.videoTitle}` : null,
    `本批共 ${frames.length} 张截图，编号从 ${context.startIndex} 开始，按时间先后排列。`,
    '请对每张图输出一行：编号 | 画面描述'
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  parts.push({ type: 'text', text: header });

  frames.forEach((frame, offset) => {
    const index = context.startIndex + offset;
    parts.push({ type: 'text', text: `第 ${index} 张（${clock(frame.tMs)}）：` });
    parts.push({ type: 'image_url', image_url: { url: frame.dataUrl, detail: 'low' } });
  });

  return [
    { role: 'system', content: FRAME_SYSTEM_PROMPT },
    { role: 'user', content: parts }
  ];
}
