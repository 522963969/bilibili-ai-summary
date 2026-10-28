import type { VideoPageContext } from '@/core/video/types';

/**
 * 页面上下文采集：只读取当前 DOM 中已经渲染的信息。
 * 不使用未公开接口，不绕过登录与访问控制，读取不到就返回 null。
 */

const TITLE_SELECTORS = ['h1.video-title', '.video-title', 'h1[title]', 'h1'];
const AUTHOR_SELECTORS = [
  '.up-detail-top .up-name',
  '.up-info--name .up-name',
  '.up-info--name',
  'a.up-name',
  '.up-name'
];

const BILIBILI_TITLE_SUFFIX = /[_\-–—\s]*哔哩哔哩[_\-–—\s]*bilibili\s*$/i;

function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(BILIBILI_TITLE_SUFFIX, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function firstText(selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.trim();
    if (text && text.length > 0) return text;
  }
  return null;
}

function readMetaContent(property: string): string | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  const content = meta?.content?.trim();
  return content && content.length > 0 ? content : null;
}

function readTitle(): string {
  return (
    cleanTitle(firstText(TITLE_SELECTORS)) ??
    cleanTitle(readMetaContent('og:title')) ??
    cleanTitle(document.title) ??
    '未命名视频'
  );
}

function readAuthor(): string | null {
  return firstText(AUTHOR_SELECTORS);
}

/** 解析 "12:34" / "1:02:03" 形式的时长文本。 */
export function parseClockText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const parts = raw.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return numbers.reduce((total, value) => total * 60 + value, 0);
}

function readDuration(): number | null {
  const video = document.querySelector('video');
  if (video && Number.isFinite(video.duration) && video.duration > 0) {
    return Math.round(video.duration);
  }
  const durationText = document.querySelector('.bpx-player-ctrl-time-duration')?.textContent;
  return parseClockText(durationText);
}

export function collectPageContext(): VideoPageContext {
  return {
    title: readTitle(),
    author: readAuthor(),
    durationSeconds: readDuration(),
    collectedAt: Date.now()
  };
}
