import { AppError } from '@/core/errors/app-error';
import {
  SUBTITLE_LIMITS,
  type NormalizedSubtitle,
  type RawCue,
  type SubtitleCue,
  type SubtitleFormat,
  type SubtitleSource,
  type SubtitleStats
} from './types';

const HTML_TAG = /<[^<>]{0,200}>/g;
const ASS_OVERRIDE = /\{\\[^}]{0,200}\}/g;

/**
 * 清理字幕文本：去掉 HTML / ASS 标记、解码常见实体、合并换行。
 * 只做无损清理，不删除实际内容（如括号内的音乐提示）。
 */
export function cleanCueText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(HTML_TAG, '')
    .replace(ASS_OVERRIDE, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, SUBTITLE_LIMITS.maxCueChars);
}

export interface NormalizeCuesResult {
  cues: SubtitleCue[];
  stats: SubtitleStats;
}

/**
 * 规范化字幕条目：
 * - 丢弃空文本与非法时间
 * - 结束时间不晚于起始时间的条目修正为 +1 秒，并计入 repaired
 * - 按起始时间稳定排序后重新编号，保证时间轴单调可追溯
 */
export function normalizeCues(rawCues: RawCue[]): NormalizeCuesResult {
  let repairedCues = 0;
  let droppedCues = 0;
  const prepared: RawCue[] = [];

  for (const cue of rawCues) {
    const text = cleanCueText(cue.text);
    if (text.length === 0) {
      droppedCues += 1;
      continue;
    }
    if (!Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)) {
      droppedCues += 1;
      continue;
    }
    const startMs = Math.max(0, Math.round(cue.startMs));
    let endMs = Math.round(cue.endMs);
    if (endMs <= startMs) {
      endMs = startMs + 1000;
      repairedCues += 1;
    }
    prepared.push({ startMs, endMs, text });
  }

  prepared.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const cues: SubtitleCue[] = prepared.map((cue, position) => ({
    index: position + 1,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text
  }));

  const lastCue = cues[cues.length - 1];
  return {
    cues,
    stats: {
      cueCount: cues.length,
      totalDurationMs: lastCue ? lastCue.endMs : 0,
      repairedCues,
      droppedCues
    }
  };
}

export interface BuildSubtitleInput {
  videoKey: string;
  trackId: string;
  lang: string;
  label: string;
  source: SubtitleSource;
  format: SubtitleFormat;
  rawCues: RawCue[];
  importedFileName?: string;
  now?: number;
}

/** 组装可直接持久化的字幕对象。空字幕视为失败而不是“成功但为空”。 */
export function buildNormalizedSubtitle(input: BuildSubtitleInput): NormalizedSubtitle {
  const { cues, stats } = normalizeCues(input.rawCues);
  if (cues.length === 0) {
    throw new AppError('E_SUBTITLE_PARSE_FAILED', {
      message: '字幕内容为空或全部条目无效'
    });
  }
  return {
    videoKey: input.videoKey,
    trackId: input.trackId,
    lang: input.lang,
    label: input.label,
    source: input.source,
    format: input.format,
    cues,
    stats,
    importedFileName: input.importedFileName,
    createdAt: input.now ?? Date.now()
  };
}
