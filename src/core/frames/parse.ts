import { FRAME_LIMITS, type FrameScriptEntry } from './types';

/**
 * 解析画面识别输出。
 *
 * 模型被要求按「编号 | 描述」逐行输出。这里按下标回填我方自己的时间戳，
 * 因此即使模型把行序写乱、或只回了部分行，也不会造成时间点错位——
 * 匹配不上的行会被明确计入 `unmatchedLines`，由上层决定是否重试。
 */

/** 行首编号：兼容「3 |」「3.」「3、」「3:」「第3帧」等常见变体。 */
const LINE_PATTERN = /^\s*(?:第\s*)?(\d{1,4})\s*(?:张|帧)?\s*[|｜.、:：)\]]\s*(.+)$/u;

export interface FrameParseResult {
  entries: FrameScriptEntry[];
  /** 有编号但编号不在本批范围内、或格式完全不匹配的行数 */
  unmatchedLines: number;
  /**
   * 是否走了「按行序对齐」的兜底。
   *
   * 有些模型（尤其是带思考过程的模型）会把清单写成
   * 「画面一：摩托车在夜间行驶」这种没有阿拉伯数字编号的形式，
   * 严格按编号匹配会得到 0 条——用户看到的就是「跑完整段视频没有任何产出」。
   * 因此当一行编号都没对上时，再按行序尝试一次。
   */
  positional: boolean;
}

/**
 * @param raw 模型返回的原始文本
 * @param frameTimes 本批各帧的时间戳，下标 i 对应编号 startIndex + i
 * @param startIndex 本批第一帧的编号
 */
export function parseFrameDescriptions(
  raw: string,
  frameTimes: number[],
  startIndex: number
): FrameParseResult {
  const entries: FrameScriptEntry[] = [];
  const seen = new Set<number>();
  let unmatchedLines = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // 去掉可能存在的 Markdown 列表符号与加粗
    const cleaned = trimmed.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '');
    const match = LINE_PATTERN.exec(cleaned);
    if (!match) {
      unmatchedLines += 1;
      continue;
    }
    const index = Number(match[1]);
    const text = (match[2] ?? '').trim();
    const offset = index - startIndex;
    if (!Number.isInteger(offset) || offset < 0 || offset >= frameTimes.length) {
      unmatchedLines += 1;
      continue;
    }
    if (seen.has(offset) || text.length === 0) {
      unmatchedLines += 1;
      continue;
    }
    seen.add(offset);
    entries.push({
      tMs: frameTimes[offset] ?? 0,
      text: text.length > FRAME_LIMITS.maxEntryChars ? `${text.slice(0, FRAME_LIMITS.maxEntryChars)}…` : text
    });
  }

  // 一条都没按编号匹配上：按行序兜底，最多取到本批帧数为止
  if (entries.length === 0) {
    const positional = parseByPosition(raw, frameTimes);
    if (positional.length > 0) {
      return { entries: positional, unmatchedLines: 0, positional: true };
    }
  }

  entries.sort((a, b) => a.tMs - b.tMs);
  return { entries, unmatchedLines, positional: false };
}

/** 去掉编号、列表符号与常见前缀后保留正文，用于「按行序对齐」兜底。 */
function stripDecorations(line: string): string {
  return line
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/\*\*/g, '')
    // 「第1帧：」「画面一：」「Frame 2 -」这类前缀
    .replace(/^(?:第\s*[0-9一二三四五六七八九十]+\s*(?:帧|张|個|个)|画面\s*[0-9一二三四五六七八九十]+|frame\s*\d+)\s*[|｜.、:：)\]-]\s*/iu, '')
    .replace(/^\d{1,4}\s*[|｜.、:：)\]-]\s*/u, '')
    .trim();
}

/**
 * 按行序把描述对齐到时间点。
 *
 * 只在「整批一个编号都没匹配上」时使用：行数与帧数不匹配就不猜，
 * 宁可报告 0 条让上层提示模型格式不对，也不要错位到别的时间点。
 */
function parseByPosition(raw: string, frameTimes: number[]): FrameScriptEntry[] {
  const lines = raw
    .split(/\r?\n/)
    .map(stripDecorations)
    // 「以下是这 6 帧画面的描述：」这类引导语不是描述本身
    .filter((line) => line.length > 0 && !/[：:]$/.test(line));

  if (lines.length === 0) return [];
  // 行数必须落在 1..帧数 之间；多出来的行说明结构不对，不做对齐
  if (lines.length > frameTimes.length) return [];
  // 整批只回了一行、却对应多帧：多半是「一段总结」而不是逐帧描述，
  // 硬对齐会把整段的结论挂到第一帧上，时间点就假了，宁可不产出
  if (frameTimes.length >= 2 && lines.length < 2) return [];

  return lines.map((text, offset) => ({
    tMs: frameTimes[offset] ?? 0,
    text: text.length > FRAME_LIMITS.maxEntryChars ? `${text.slice(0, FRAME_LIMITS.maxEntryChars)}…` : text
  }));
}

/**
 * 把画面讲稿转成与字幕同构的 cue 列表。
 *
 * 复用字幕的分块与总结管线：`SubtitleCue` 只要求「时间区间 + 文本」，
 * 画面讲稿天然满足，因此不需要第二套分块/归并提示词。
 * 每条覆盖到下一帧的时间点，最后一帧延伸到视频结束。
 */
export function buildFrameCues(
  entries: FrameScriptEntry[],
  durationMs: number
): { index: number; startMs: number; endMs: number; text: string }[] {
  const sorted = [...entries].sort((a, b) => a.tMs - b.tMs);
  const total = Math.max(durationMs, sorted.length > 0 ? (sorted[sorted.length - 1]?.tMs ?? 0) + 1000 : 0);

  return sorted.map((entry, position) => {
    const next = sorted[position + 1];
    const endMs = next ? next.tMs : total;
    return {
      index: position + 1,
      startMs: entry.tMs,
      endMs: Math.max(entry.tMs + 500, endMs),
      text: `[画面] ${entry.text}`
    };
  });
}
