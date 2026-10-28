import type { ChatMessage } from '@/core/ai/types';
import type { SubtitleCue } from '@/core/subtitle/types';
import { renderCues } from './chunk-planner';
import type { SummarySource, TranscriptChunk } from './types';

/**
 * 提示词组装。
 * 全部要求模型基于给定素材作答，明确禁止补充素材以外的信息，
 * 避免出现「看似合理但视频里没说过」的幻觉内容。
 *
 * 字幕与画面识别使用两套段落提示词：字幕能听到说话内容，
 * 画面识别只能看到静帧，若不区分，模型会习惯性地「补」出对白。
 */

function clock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export const CHUNK_SYSTEM_PROMPT = [
  '你是严谨的视频内容分析助手。',
  '你会收到视频某一段落的带时间戳字幕，需要输出这段内容的摘要。',
  '规则：',
  '1. 只依据字幕内容，不补充字幕之外的知识、猜测或评价。',
  '2. 保留关键时间点，格式为 [mm:ss]，用于后续定位。',
  '3. 输出 150~260 字的中文纯文本，不要使用 Markdown 标题。',
  '4. 如果这段内容主要是寒暄、口播重复或无实质信息，直接说明「本段无明显信息」。'
].join('\n');

/** 画面识别专用：素材是静帧描述，不是语音转写。 */
export const FRAME_CHUNK_SYSTEM_PROMPT = [
  '你是严谨的视频画面内容分析助手。',
  '你会收到视频某一段落的带时间戳「画面描述」，它们来自对视频截图的逐帧识别，没有声音信息。',
  '规则：',
  '1. 只依据给出的画面描述，不补充画面之外的对白、旁白或剧情推断。',
  '2. 保留关键时间点，格式为 [mm:ss]，用于后续定位。',
  '3. 输出 150~260 字的中文纯文本，不要使用 Markdown 标题；',
  '   描述时用「画面显示」「屏幕上出现」这类措辞，明确这是看到而非听到的内容。',
  '4. 如果这段画面主要是静止画面、转场或黑屏，直接说明「本段无明显画面信息」。'
].join('\n');

export function buildChunkMessages(
  chunk: TranscriptChunk,
  context: { videoTitle: string | null; source?: SummarySource }
): ChatMessage[] {
  const isFrames = context.source === 'frames';
  const header = [
    context.videoTitle ? `视频标题：${context.videoTitle}` : null,
    `本段范围：${clock(chunk.startMs)} - ${clock(chunk.endMs)}`,
    isFrames ? '画面描述（每行以 [时间] 开头）：' : '字幕正文（每行以 [时间] 开头）：'
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return [
    { role: 'system', content: isFrames ? FRAME_CHUNK_SYSTEM_PROMPT : CHUNK_SYSTEM_PROMPT },
    { role: 'user', content: `${header}\n${chunk.text}` }
  ];
}

/** 归并与直出共用的 JSON 结构说明，避免两处写法漂移。 */
const MERGE_JSON_SCHEMA = [
  '{',
  '  "overview": "150~300 字的整体内容概述，只依据给出的素材",',
  '  "highlights": ["3~6 条关键结论，每条不超过 30 字"],',
  '  "chapters": [',
  '    { "title": "章节标题，不超过 16 字", "start": "mm:ss", "points": ["该章节要点，1~3 条"] }',
  '  ]',
  '}'
];

/** 覆盖要求：模型必须让章节铺满整个素材，而不是只总结开头几分钟。 */
const COVERAGE_RULE =
  '章节必须覆盖整个素材范围：第一个章节从素材开头附近开始，最后一个章节必须落在素材结尾附近，不允许只总结前几分钟。';

const DENSITY_RULE =
  '素材超过 10 分钟时，至少每 5 分钟安排一个章节，保证用户能靠章节跳到任意位置。';

export const MERGE_SYSTEM_PROMPT = [
  '你是视频内容编辑。你会收到同一个视频多个段落的摘要，需要合并成结构化结果。',
  '必须只输出一个 JSON 对象，不要输出解释文字，不要使用 Markdown 代码块。',
  'JSON 结构：',
  ...MERGE_JSON_SCHEMA,
  '规则：',
  '1. chapters 按时间先后排列，start 必须是摘要中出现过的真实时间点，不要编造。',
  '2. 章节数量根据内容决定，通常 3~10 个；内容单一时可以更少。',
  '3. 所有文字使用简体中文，不要出现「根据字幕」「本段」这类过程性描述。',
  `4. ${COVERAGE_RULE}`,
  `5. ${DENSITY_RULE}`
].join('\n');

/**
 * 单块直出提示词。
 *
 * 素材能一次装进上下文时不再「先摘要再归并」：两步走会把 20 多分钟的内容压成两百字，
 * 章节只能从这两百字里挑时间点，后半段必然丢失。直出时模型能看到全部时间戳。
 */
export const DIRECT_SYSTEM_PROMPT = [
  '你是视频内容编辑。你会收到一个视频完整的带时间戳字幕，需要直接输出结构化总结。',
  '必须只输出一个 JSON 对象，不要输出解释文字，不要使用 Markdown 代码块。',
  'JSON 结构：',
  ...MERGE_JSON_SCHEMA,
  '规则：',
  '1. chapters 按时间先后排列，start 必须是字幕中出现过的真实时间点，不要编造。',
  '2. 章节数量按素材长度决定，通常 3~10 个。',
  '3. 所有文字使用简体中文，不要出现「根据字幕」「本段」这类过程性描述。',
  `4. ${COVERAGE_RULE}`,
  `5. ${DENSITY_RULE}`
].join('\n');

/** 画面来源的归并提示：避免把「看到的」写成「说过的」。 */
export const FRAME_MERGE_SYSTEM_PROMPT = [
  MERGE_SYSTEM_PROMPT,
  '6. 本例素材来自画面识别而非语音：可以写「视频展示了什么」，',
  '   但不要写成「作者说了什么」；没有画面依据的推断一律不要写。'
].join('\n');

/** 画面来源的直出提示词，规则与直出版本一致，只替换素材性质的说明。 */
export const FRAME_DIRECT_SYSTEM_PROMPT = [
  DIRECT_SYSTEM_PROMPT,
  '6. 本例素材来自画面识别而非语音：素材是「[时间] 画面描述」列表，没有对白。',
  '   可以写「画面显示什么」，但不要写成「作者说了什么」；没有画面依据的推断一律不要写。'
].join('\n');

function materialRange(materialEndMs: number | null | undefined, count: number): string | null {
  if (!materialEndMs || !Number.isFinite(materialEndMs) || materialEndMs <= 0) return null;
  return `素材范围：${clock(0)} - ${clock(materialEndMs)}（共 ${count} 段）`;
}

export function buildMergeMessages(
  summaries: { startMs: number; endMs: number; summary: string }[],
  context: {
    videoTitle: string | null;
    source?: SummarySource;
    /** 素材终点，用于告诉模型章节该铺到哪 */
    materialEndMs?: number | null;
    /** 上一轮章节没覆盖到结尾时的补全指令 */
    retryHint?: string | null;
  }
): ChatMessage[] {
  const blocks = summaries
    .map(
      (item, position) =>
        `【段落 ${position + 1}】${clock(item.startMs)} - ${clock(item.endMs)}\n${item.summary}`
    )
    .join('\n\n');

  const head = [
    context.videoTitle ? `视频标题：${context.videoTitle}` : null,
    materialRange(context.materialEndMs, summaries.length)
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const sourceHint =
    context.source === 'frames' ? '以下摘要依据逐帧画面识别得出，视频没有可用字幕。\n' : '';
  const retryHint = context.retryHint ? `${context.retryHint}\n` : '';

  return [
    {
      role: 'system',
      content: context.source === 'frames' ? FRAME_MERGE_SYSTEM_PROMPT : MERGE_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: `${head ? `${head}\n\n` : ''}${sourceHint}${retryHint}以下是各段落摘要：\n\n${blocks}`
    }
  ];
}

/** 单块直出：把整段字幕连同时间戳一次性交给模型。 */
export function buildDirectMessages(
  cues: SubtitleCue[],
  context: {
    videoTitle: string | null;
    source?: SummarySource;
    materialEndMs?: number | null;
    retryHint?: string | null;
  }
): ChatMessage[] {
  const head = [
    context.videoTitle ? `视频标题：${context.videoTitle}` : null,
    materialRange(context.materialEndMs, 1)
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');

  const sourceHint =
    context.source === 'frames'
      ? '以下内容依据逐帧画面识别得出，没有声音信息。\n'
      : '以下为完整字幕，每行以 [时间] 开头：\n';
  const retryHint = context.retryHint ? `${context.retryHint}\n` : '';

  return [
    {
      role: 'system',
      content: context.source === 'frames' ? FRAME_DIRECT_SYSTEM_PROMPT : DIRECT_SYSTEM_PROMPT
    },
    { role: 'user', content: `${head ? `${head}\n\n` : ''}${sourceHint}${retryHint}${renderCues(cues)}` }
  ];
}

/** 单条字幕文本，供超长场景下的降级摘要使用。 */
export function buildDegradeMessages(
  cues: SubtitleCue[],
  context: { videoTitle: string | null }
): ChatMessage[] {
  const body = cues.map((cue) => cue.text).join('\n').slice(0, 4000);
  return [
    { role: 'system', content: CHUNK_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${context.videoTitle ? `视频标题：${context.videoTitle}\n` : ''}字幕正文：\n${body}`
    }
  ];
}
