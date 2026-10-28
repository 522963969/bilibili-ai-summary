/** 导出用的文本处理工具。全部为纯函数，便于单测。 */

import { EXPORT_LIMITS } from './types';

/** 把可能含换行的模型输出压成单行，用于标题、列表项这类不能断行的位置。 */
export function oneLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * 给视频链接补上定位到指定秒数的参数。
 *
 * B 站支持 `?t=秒数`，但规范链接可能已带 `?p=2`，因此要先判断分隔符；
 * hash 必须留在末尾，否则会破坏锚点。
 */
export function withTimestamp(url: string, seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hashIndex = url.indexOf('#');
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}t=${safe}${hash}`;
}

/** 句末标点：中文与英文都认，分号也算，因为模型常把并列项写成一句。 */
const SENTENCE_PATTERN = /[^。！？；!?;\n]+[。！？；!?;]?/g;

/** 中文句末标点后面不需要再补空格，否则「一。 二。」读起来很别扭。 */
const CJK_SENTENCE_END = /[。！？；]$/;

function joinSentences(parts: readonly string[]): string {
  return parts.reduce((acc, part) => {
    if (acc.length === 0) return part;
    return CJK_SENTENCE_END.test(acc) ? `${acc}${part}` : `${acc} ${part}`;
  }, '');
}

/**
 * 把概述拆成适合放进大纲节点的短句。
 *
 * 幕布的思维导图会把一个节点当作一个主题，整段贴在单个节点上会变成一大块文字，
 * 失去大纲的意义；因此按句拆分，但设上限，避免概述过长时铺出几十个节点。
 */
export function splitSentences(text: string, max: number = EXPORT_LIMITS.mubuOverviewSentences): string[] {
  const matches = text.normalize('NFC').match(SENTENCE_PATTERN) ?? [];
  const sentences: string[] = [];
  for (const match of matches) {
    const sentence = match.replace(/\s+/g, ' ').trim();
    if (sentence.length > 0) sentences.push(sentence);
  }
  if (sentences.length <= max) return sentences;

  // 超出上限时把剩余句子合并成一条，宁可节点长一点也不丢内容
  const head = sentences.slice(0, max - 1);
  const tail = joinSentences(sentences.slice(max - 1));
  return [...head, tail];
}
