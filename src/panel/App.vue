<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AppError } from '@/core/errors/app-error';
import { buildMarkdown, buildMarkdownFileName } from '@/core/export/markdown';
import { buildMindMapFileName, buildMindMapSvg } from '@/core/export/mindmap';
import { buildMubuOutline } from '@/core/export/mubu';
import { buildSubtitleFileName, buildSubtitleText } from '@/core/export/subtitle';
import type { ExportContext } from '@/core/export/types';
import type { FrameScriptDocument } from '@/core/frames/types';
import { messageClient } from '@/core/messaging/client';
import { toSvgDataUrl } from '@/core/mindmap/svg';
import type { NormalizedSubtitle, SubtitleDiscovery } from '@/core/subtitle/types';
import { SUMMARY_SOURCE_LABELS, type SummaryTaskSnapshot } from '@/core/summary/types';
import type { ResolvedVideo } from '@/core/video/types';
import { svgToPngBase64 } from './svg-to-png';

/**
 * 页面内总结面板（由 Content Script 以 iframe 嵌入 B 站视频页）。
 *
 * 只通过消息契约与后台交互，不直接访问 B 站接口；
 * 字幕的获取、缓存、分块与模型调用全部在 Service Worker 侧完成。
 * 无字幕时的画面识别同样如此：本页面只发起任务与轮询进度，
 * 抽帧由 Content Script 执行，识别由后台执行。
 */

const tabId = ref<number | null>(null);
const urlVideoKey = ref<string | null>(null);

const video = ref<ResolvedVideo | null>(null);
const videoError = ref<string | null>(null);
const loadingVideo = ref(true);

const subtitle = ref<NormalizedSubtitle | null>(null);
const discovery = ref<SubtitleDiscovery | null>(null);
const subtitleBusy = ref<'idle' | 'discover' | 'fetch' | 'import'>('idle');
const subtitleError = ref<string | null>(null);
const subtitleNotice = ref<string | null>(null);

const task = ref<SummaryTaskSnapshot | null>(null);
const summaryBusy = ref(false);
const summaryError = ref<string | null>(null);

/** 视觉模型是否可用；不可用时不渲染画面识别按钮，避免出现点了没反应的入口。 */
const visionConfigured = ref(false);
const frameScript = ref<FrameScriptDocument | null>(null);
const frameError = ref<string | null>(null);

/** 导出：'markdown' 正在下载，'mubu' 正在复制大纲，'subtitle' 正在下载字幕，'svg'/'png' 正在导出导图 */
const exportBusy = ref<'idle' | 'markdown' | 'mubu' | 'subtitle' | 'svg' | 'png'>('idle');
const exportError = ref<string | null>(null);
const exportNotice = ref<string | null>(null);

/**
 * 面板跟随系统深浅色（见 panel.css 的 prefers-color-scheme）。
 * 导图是独立 SVG，拿不到 CSS 变量，必须把主题显式传进去，否则深色下会导出白底图。
 */
const prefersDark = ref(false);
let themeQuery: MediaQueryList | null = null;

function syncTheme(event: MediaQueryList | MediaQueryListEvent): void {
  prefersDark.value = event.matches;
}

/** 字幕全文是否展开。默认只显示前 3 条，避免一进来就被几百行淹没。 */
const subtitleExpanded = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
let pollTimer: number | null = null;

const videoKey = computed<string | null>(() => video.value?.identity.key ?? urlVideoKey.value);
const title = computed(
  () =>
    video.value?.pageContext?.title ??
    video.value?.fallbackTitle ??
    (loadingVideo.value ? '正在识别视频…' : '未识别到视频')
);
const author = computed(() => video.value?.pageContext?.author ?? null);
const durationText = computed(() => {
  const seconds = video.value?.pageContext?.durationSeconds;
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
});

const running = computed(() => {
  const status = task.value?.status;
  return status === 'preparing' || status === 'running' || status === 'merging';
});
const hasResult = computed(() => Boolean(task.value?.result));
/**
 * 快照与本页视频是否对不上。
 *
 * 快照是按 videoKey 存的，正常情况下不可能读到别人的；但只要上游某一环（地址解析、
 * 分P 映射、导入文件、历史遗留缓存）把素材或键配错，界面上就会安静地渲染一份
 * 「不属于这个视频」的总结——那是最容易误导人的错误，因为内容本身看着完全正常。
 * 因此渲染前先比对视频键，对不上就明确报出来，而不是照单渲染。
 */
const taskOwnerMismatch = computed(() => {
  const current = task.value;
  const key = videoKey.value;
  if (!current || !key) return false;
  return current.videoKey !== key;
});
/** 素材指纹：让「这份总结依据的是哪条视频、哪段话」显示出来，可直接与视频内容对照。 */
const materialNote = computed(() => {
  const result = task.value?.result;
  const material = result?.material;
  if (!material) return null;
  const range = `${clock(material.startMs)}–${clock(material.endMs)}`;
  const unit = result?.source === 'frames' ? '条画面描述' : '条字幕';
  const first = material.firstText ? ` · 首条「${material.firstText}${material.firstText.length >= 40 ? '…' : ''}」` : '';
  return `依据 ${material.cueCount} ${unit} · ${range}${first}`;
});
const progressPercent = computed(() => {
  const current = task.value;
  if (!current || current.totalChunks <= 0) return 0;
  return Math.min(100, Math.round((current.doneChunks / current.totalChunks) * 100));
});
/** 抽帧阶段还没有分块进度，此时用不确定态进度条，避免看起来像卡在 0%。 */
const progressIndeterminate = computed(() => {
  const current = task.value;
  return Boolean(running.value && current && current.totalChunks <= 0);
});
const subtitleSummaryText = computed(() => {
  const current = subtitle.value;
  if (!current) return '未获取';
  const seconds = Math.round(current.stats.totalDurationMs / 1000);
  return `已获取 ${current.stats.cueCount} 条 · ${seconds} 秒`;
});
const hasFrameScript = computed(() => (frameScript.value?.entries.length ?? 0) > 0);
/**
 * 任务总耗时（含抽帧）。
 * 模型的 elapsedMs 只覆盖分块与归并，画面识别还有几十秒抽帧时间，
 * 用快照的时间区间才不会让用户以为「70 帧画面只花了 15 秒就识别完」。
 */
const totalElapsedSeconds = computed(() => {
  const current = task.value;
  if (!current) return null;
  return Math.max(1, Math.round((current.updatedAt - current.startedAt) / 1000));
});
const frameButtonText = computed(() => {
  if (running.value) return '正在处理…';
  if (hasResult.value) return '重新生成总结';
  if (hasFrameScript.value) return '用已识别画面生成总结';
  return '按画面识别生成总结';
});
const resultSourceLabel = computed(() => {
  const source = task.value?.result?.source;
  return source ? SUMMARY_SOURCE_LABELS[source] : null;
});
/** 素材条数在不同来源下含义不同，文案要跟着变，不能一律叫「条字幕」。 */
const resultEntryLabel = computed(() => {
  const result = task.value?.result;
  if (!result) return '';
  return result.source === 'frames' ? `${result.cueCount} 条画面描述` : `${result.cueCount} 条字幕`;
});
/** 收起时只看前 3 条；展开后给出全部，供用户自己核对与复制。 */
const visibleCues = computed(() => {
  const cues = subtitle.value?.cues ?? [];
  return subtitleExpanded.value ? cues : cues.slice(0, 3);
});
/**
 * 章节覆盖范围提示。
 *
 * 只有确实没铺到结尾时才出现——正常情况下不该有这条提示，
 * 出现即说明模型只总结了前段，用户需要知道点击章节跳不到后面。
 */
const chapterCoverageNote = computed(() => {
  const result = task.value?.result;
  const end = result?.materialEndMs;
  if (!result || !end || end < 5 * 60 * 1000) return null;
  const last = result.chapters.reduce((max, chapter) => Math.max(max, chapter.startMs), 0);
  if (last / end >= 0.6) return null;
  return `章节只覆盖到 ${clock(last)}，素材一直到 ${clock(end)}`;
});

function clock(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (v: number): string => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function reportError(target: typeof videoError, error: unknown): void {
  const appError = AppError.from(error);
  target.value = appError.message;
}

async function loadVideo(): Promise<void> {
  loadingVideo.value = true;
  try {
    const result = await messageClient.send('video.resolveFromTab');
    if (result.status === 'ready') {
      video.value = result.video;
      tabId.value = result.video.tabId;
      videoError.value = null;
    } else if (result.status === 'unsupported-page') {
      videoError.value = result.reason;
    } else {
      videoError.value = '未找到当前标签页，请刷新 B 站页面后重试';
    }
  } catch (error) {
    reportError(videoError, error);
  } finally {
    loadingVideo.value = false;
  }
}

async function loadSubtitle(): Promise<void> {
  const key = videoKey.value;
  if (!key) return;
  try {
    const result = await messageClient.send('subtitle.getCached', { videoKey: key });
    subtitle.value = result.subtitle;
  } catch (error) {
    reportError(subtitleError, error);
  }
}

async function loadTask(): Promise<void> {
  const key = videoKey.value;
  if (!key) return;
  try {
    const result = await messageClient.send('summary.get', { videoKey: key });
    task.value = result.task;
    if (running.value) startPolling();
  } catch {
    // 读取历史任务失败不影响主流程
    task.value = null;
  }
}

/** 读取视觉模型配置状态，决定是否渲染「按画面识别总结」入口。 */
async function loadAuxiliaryState(): Promise<void> {
  try {
    const snapshot = await messageClient.send('settings.get');
    visionConfigured.value = snapshot.visionConfigured;
  } catch {
    visionConfigured.value = false;
  }

  const key = videoKey.value;
  if (!key) return;
  try {
    const result = await messageClient.send('frames.getScript', { videoKey: key });
    frameScript.value = result.script;
  } catch {
    frameScript.value = null;
  }
}

/** 无字幕时按画面识别：先抽帧再总结，全部在后台串起来。 */
async function startFrameSummary(force: boolean): Promise<void> {
  const id = tabId.value;
  if (id === null) {
    frameError.value = '缺少标签页信息，请刷新 B 站页面后重试';
    return;
  }
  summaryBusy.value = true;
  frameError.value = null;
  summaryError.value = null;
  try {
    const snapshot = await messageClient.send('frames.start', { tabId: id, force });
    task.value = snapshot;
    startPolling();
  } catch (error) {
    frameError.value = AppError.from(error).message;
  } finally {
    summaryBusy.value = false;
  }
}

/** 清除已识别的画面讲稿，下次重新抽帧。 */
async function clearFrameScript(): Promise<void> {
  const key = videoKey.value;
  if (!key) return;
  try {
    await messageClient.send('frames.clear', { videoKey: key });
    frameScript.value = null;
  } catch (error) {
    frameError.value = AppError.from(error).message;
  }
}

/**
 * 导出的标题兜底：页面标题 → 结果里记录的视频名 → 视频键 → 通用文案。
 *
 * 中间那一档很关键：页面信息拿不到时（后台被回收、面板刚打开还没探测完），
 * 结果快照里其实存着生成时的视频名，退到视频键会让文件名变成
 * 「B站视频 BV1xx…#p1」这种只有编号的名字。
 */
function resolveExportTitle(): string {
  const pageTitle = video.value?.pageContext?.title ?? video.value?.fallbackTitle ?? null;
  const storedTitle = task.value?.result?.material?.videoTitle ?? null;
  const title = pageTitle?.trim() || storedTitle?.trim() || '';
  if (title.length > 0) return title;
  return videoKey.value ? `B站视频 ${videoKey.value}` : 'B站视频';
}

function exportContext(): ExportContext | null {
  const result = task.value?.result;
  if (!result) return null;
  return {
    title: resolveExportTitle(),
    author: author.value,
    url: video.value?.identity.canonicalUrl ?? null,
    videoKey: videoKey.value,
    result
  };
}

/**
 * 思维导图：由结果现算，不落盘。
 *
 * 计算量很小（几十个节点），而且必须与当前结果严格同源——
 * 缓存一份 svg 字符串反而会出现「结果已重新生成、导图还是旧的」这种不一致。
 */
const mindMap = computed(() => {
  const context = exportContext();
  if (!context || taskOwnerMismatch.value) return null;
  const artifact = buildMindMapSvg(context, { theme: prefersDark.value ? 'dark' : 'light' });
  return { ...artifact, dataUrl: toSvgDataUrl(artifact.svg) };
});

/**
 * 导图预览是否按原始大小显示。
 *
 * 面板只有 400 多像素宽，一张 600~900 像素宽的导图缩到适配宽度后，
 * 12.5px 的字只剩 7px 左右，时间点和要点基本读不出来。
 * 默认适配宽度（能看清整体结构），需要读文字时切到原始大小并横向滚动。
 */
const mindMapZoom = ref(false);

function resetExportState(): void {
  exportError.value = null;
  exportNotice.value = null;
}

/** 统一走「页面顶层文档下载」；二进制以 base64 传输，避免消息通道塞字节数组。 */
async function sendDownload(
  fileName: string,
  text: string,
  mime: string,
  encoding: 'utf8' | 'base64' = 'utf8'
): Promise<void> {
  const id = tabId.value;
  if (id === null) {
    throw new AppError('E_DOWNLOAD_FAILED', { message: '缺少标签页信息，请刷新 B 站页面后重试' });
  }
  const result = await messageClient.send('export.download', {
    tabId: id,
    fileName,
    text,
    mime,
    encoding
  });
  if (!result.started) throw new AppError('E_DOWNLOAD_FAILED');
}

/** 导出思维导图 SVG。矢量格式可以无限放大，适合贴进文档与幻灯片。 */
async function downloadMindMapSvg(): Promise<void> {
  const map = mindMap.value;
  const context = exportContext();
  if (!map || !context) return;
  resetExportState();
  exportBusy.value = 'svg';
  try {
    const fileName = buildMindMapFileName(context, 'svg');
    await sendDownload(fileName, map.svg, 'image/svg+xml;charset=utf-8');
    exportNotice.value = `已导出 ${fileName}`;
  } catch (error) {
    exportError.value = AppError.from(error).message;
  } finally {
    exportBusy.value = 'idle';
  }
}

/**
 * 导出思维导图 PNG。
 *
 * 栅格化在面板里用 canvas 完成（要 DOM），下载仍然交给页面顶层文档——
 * 面板是跨源 iframe，自己下载会被浏览器取消。
 */
async function downloadMindMapPng(): Promise<void> {
  const map = mindMap.value;
  const context = exportContext();
  if (!map || !context) return;
  resetExportState();
  exportBusy.value = 'png';
  try {
    const base64 = await svgToPngBase64(map.svg, map.width, map.height, {
      scale: 2,
      background: prefersDark.value ? '#1b1e24' : '#ffffff'
    });
    const fileName = buildMindMapFileName(context, 'png');
    await sendDownload(fileName, base64, 'image/png', 'base64');
    exportNotice.value = `已导出 ${fileName}`;
  } catch (error) {
    exportError.value = AppError.from(error).message;
  } finally {
    exportBusy.value = 'idle';
  }
}

/**
 * 下载 Markdown。
 *
 * 生成在本地完成，但下载必须交给目标页面的顶层文档：
 * 面板是跨源 iframe，浏览器会把它发起的 blob 下载直接取消。
 */
async function downloadMarkdown(): Promise<void> {
  const context = exportContext();
  if (!context) return;
  resetExportState();
  exportBusy.value = 'markdown';
  try {
    const fileName = buildMarkdownFileName(context);
    await sendDownload(fileName, buildMarkdown(context), 'text/markdown;charset=utf-8');
    exportNotice.value = `已导出 ${fileName}`;
  } catch (error) {
    exportError.value = AppError.from(error).message;
  } finally {
    exportBusy.value = 'idle';
  }
}

/** 下载字幕原文为 txt；带 BOM 是为了 Windows 记事本打开不乱码。 */
async function downloadSubtitle(): Promise<void> {
  const current = subtitle.value;
  if (!current) return;
  subtitleNotice.value = null;
  subtitleError.value = null;
  exportBusy.value = 'subtitle';
  try {
    const context = {
      title: resolveExportTitle(),
      url: video.value?.identity.canonicalUrl ?? null,
      videoKey: videoKey.value,
      subtitle: current
    };
    const fileName = buildSubtitleFileName(context);
    await sendDownload(fileName, `\uFEFF${buildSubtitleText(context)}`, 'text/plain;charset=utf-8');
    subtitleNotice.value = `已导出 ${fileName}`;
  } catch (error) {
    subtitleError.value = AppError.from(error).message;
  } finally {
    exportBusy.value = 'idle';
  }
}

function toggleSubtitle(): void {
  subtitleExpanded.value = !subtitleExpanded.value;
}

// 换字幕（重新获取 / 重新导入）后收起全文，避免展开状态跨内容沿用
watch(subtitle, () => {
  subtitleExpanded.value = false;
  subtitleNotice.value = null;
});

/**
 * 写入剪贴板。
 *
 * 面板是嵌在 B 站页面里的跨源 iframe，clipboard API 可能因焦点或 Permissions Policy
 * 被拒，因此保留 textarea + execCommand 兜底；两条路径都失败才向上抛错。
 */
async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 落到兜底路径
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '0';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    area.remove();
  }
  if (!copied) throw new AppError('E_CLIPBOARD_DENIED');
}

/**
 * 复制幕布大纲并打开幕布工作台。
 *
 * 必须先复制成功再打开页面：顺序反了，用户切过去粘到的会是剪贴板里的旧内容。
 * 幕布没有公开写入 API，所以这一步到「粘贴」为止，界面文案也要如实这么说。
 */
async function copyToMubu(): Promise<void> {
  const context = exportContext();
  if (!context) return;
  resetExportState();
  exportBusy.value = 'mubu';
  try {
    await writeClipboard(buildMubuOutline(context));
    const opened = await messageClient.send('export.openMubu');
    exportNotice.value = opened.opened
      ? '大纲已复制，在幕布中按 Ctrl+V 粘贴即可生成层级'
      : '大纲已复制，请手动打开 mubu.com 粘贴';
  } catch (error) {
    exportError.value = AppError.from(error).message;
  } finally {
    exportBusy.value = 'idle';
  }
}

async function discoverAndFetch(): Promise<void> {
  const id = tabId.value;
  if (id === null) {
    subtitleError.value = '缺少标签页信息，请刷新 B 站页面后重试';
    return;
  }
  subtitleBusy.value = 'discover';
  subtitleError.value = null;
  try {
    const found = await messageClient.send('subtitle.discover', { tabId: id });
    discovery.value = found;
    const track = found.tracks.find((item) => !item.locked && item.url);
    if (!track) {
      subtitleError.value = found.message;
      return;
    }
    subtitleBusy.value = 'fetch';
    subtitle.value = await messageClient.send('subtitle.fetch', { tabId: id, trackId: track.id });
  } catch (error) {
    reportError(subtitleError, error);
  } finally {
    subtitleBusy.value = 'idle';
  }
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const id = tabId.value;
  if (id === null) {
    subtitleError.value = '缺少标签页信息，请刷新 B 站页面后重试';
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    subtitleError.value = '字幕文件超过 5 MB，请先精简后再导入';
    return;
  }
  subtitleBusy.value = 'import';
  subtitleError.value = null;
  try {
    const content = await file.text();
    subtitle.value = await messageClient.send('subtitle.import', {
      tabId: id,
      fileName: file.name,
      content
    });
  } catch (error) {
    reportError(subtitleError, error);
  } finally {
    subtitleBusy.value = 'idle';
  }
}

async function startSummary(): Promise<void> {
  const id = tabId.value;
  if (id === null) {
    summaryError.value = '缺少标签页信息，请刷新 B 站页面后重试';
    return;
  }
  summaryBusy.value = true;
  summaryError.value = null;
  try {
    const snapshot = await messageClient.send('summary.start', { tabId: id });
    task.value = snapshot;
    startPolling();
  } catch (error) {
    reportError(summaryError, error);
  } finally {
    summaryBusy.value = false;
  }
}

async function cancelSummary(): Promise<void> {
  const key = videoKey.value;
  if (!key) return;
  try {
    await messageClient.send('summary.cancel', { videoKey: key });
    // 抽帧是页面里的长循环，光把任务标成已取消停不下 seek，必须单独通知页面
    const id = tabId.value;
    if (id !== null) {
      await messageClient.send('frames.stop', { tabId: id, videoKey: key }).catch(() => undefined);
    }
    await refreshTask();
  } catch (error) {
    reportError(summaryError, error);
  }
}

async function refreshTask(): Promise<void> {
  const key = videoKey.value;
  if (!key) return;
  try {
    const wasRunning = running.value;
    const result = await messageClient.send('summary.get', { videoKey: key });
    task.value = result.task;
    if (!running.value) {
      stopPolling();
      // 任务刚结束时画面讲稿已落盘，顺手刷新一次，让「复用已有讲稿」入口立即可见
      if (wasRunning) await loadAuxiliaryState();
    }
  } catch (error) {
    reportError(summaryError, error);
    stopPolling();
  }
}

function startPolling(): void {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void refreshTask();
  }, 1200);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function seek(startMs: number): void {
  window.parent.postMessage({ type: 'bili-ai-summary:seek', seconds: startMs / 1000 }, '*');
}

function close(): void {
  window.parent.postMessage({ type: 'bili-ai-summary:close' }, '*');
}

onMounted(async () => {
  themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  syncTheme(themeQuery);
  themeQuery.addEventListener('change', syncTheme);

  const params = new URLSearchParams(window.location.search);
  const rawTabId = params.get('tabId');
  const parsed = rawTabId === null ? Number.NaN : Number(rawTabId);
  if (Number.isInteger(parsed) && parsed >= 0) tabId.value = parsed;
  urlVideoKey.value = params.get('videoKey');

  await loadVideo();
  await Promise.all([loadSubtitle(), loadTask(), loadAuxiliaryState()]);
});

onBeforeUnmount(() => {
  stopPolling();
  themeQuery?.removeEventListener('change', syncTheme);
  themeQuery = null;
});
</script>

<template>
  <div class="panel">
    <header class="head">
      <span class="head__status">
        <span class="head__dot" :class="subtitle ? 'head__dot--ok' : 'head__dot--idle'" />
        字幕 {{ subtitleSummaryText }}
      </span>
      <button class="icon-btn" type="button" title="收起面板" @click="close">×</button>
    </header>

    <main class="body">
      <section class="card">
        <div class="card__head">
          <span class="card__title">当前视频</span>
          <span v-if="video" class="tag tag--ok">已识别</span>
        </div>
        <div class="card__title-main">{{ title }}</div>
        <div v-if="author || durationText" class="meta">
          <span v-if="author">UP 主：{{ author }}</span>
          <span v-if="durationText">时长 {{ durationText }}</span>
        </div>
        <p v-if="videoError" class="alert alert--error">{{ videoError }}</p>
      </section>

      <section class="card">
        <div class="card__head">
          <span class="card__title">字幕</span>
          <span v-if="subtitle" class="tag tag--ok">已获取</span>
          <span v-else class="tag">未获取</span>
        </div>

        <template v-if="subtitle">
          <div class="meta">
            <span>{{ subtitle.stats.cueCount }} 条</span>
            <span>·</span>
            <span>{{ Math.round(subtitle.stats.totalDurationMs / 1000) }} 秒</span>
            <span>·</span>
            <span>{{ subtitle.source === 'import' ? '本地导入' : 'B 站' }}</span>
          </div>
          <ul class="cues" :class="{ 'cues--full': subtitleExpanded }">
            <li v-for="cue in visibleCues" :key="cue.index" class="cues__item">
              <button class="cues__time cues__time--btn" type="button" :title="`跳转到 ${clock(cue.startMs)}`" @click="seek(cue.startMs)">
                {{ clock(cue.startMs) }}
              </button>
              <span class="cues__text">{{ cue.text }}</span>
            </li>
          </ul>
          <div class="actions">
            <button class="btn btn--ghost" type="button" @click="toggleSubtitle">
              {{ subtitleExpanded ? '收起字幕' : `展开全部 ${subtitle.stats.cueCount} 条` }}
            </button>
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="exportBusy !== 'idle'"
              @click="downloadSubtitle"
            >
              {{ exportBusy === 'subtitle' ? '导出中…' : '下载 .txt' }}
            </button>
          </div>
          <div class="actions">
            <button class="btn btn--ghost" type="button" :disabled="subtitleBusy !== 'idle'" @click="discoverAndFetch">
              重新获取
            </button>
            <button class="btn btn--ghost" type="button" @click="pickFile">导入文件</button>
          </div>
          <p v-if="subtitleNotice" class="hint hint--ok">{{ subtitleNotice }}</p>
        </template>

        <template v-else>
          <p class="hint">
            字幕只从当前浏览器会话可访问的 B 站字幕接口读取，不绕过登录与权限；读取不到时可导入本地 SRT / VTT / JSON。
          </p>
          <div class="actions">
            <button class="btn btn--primary" type="button" :disabled="subtitleBusy !== 'idle'" @click="discoverAndFetch">
              {{ subtitleBusy === 'discover' ? '读取中…' : subtitleBusy === 'fetch' ? '下载中…' : '获取字幕' }}
            </button>
            <button class="btn btn--ghost" type="button" :disabled="subtitleBusy !== 'idle'" @click="pickFile">
              导入本地字幕
            </button>
          </div>
        </template>

        <p v-if="subtitleError" class="alert alert--warn">{{ subtitleError }}</p>

        <input ref="fileInput" class="hidden" type="file" accept=".srt,.vtt,.json,text/plain,application/json" @change="onFileChange" />
      </section>

      <section class="card">
        <div class="card__head">
          <span class="card__title">总结</span>
          <span v-if="resultSourceLabel" class="tag tag--source">{{ resultSourceLabel }}</span>
          <span v-else-if="hasResult" class="tag tag--ok">已完成</span>
        </div>

        <template v-if="subtitle">
          <div class="actions">
            <button
              class="btn btn--primary btn--wide"
              type="button"
              :disabled="running || summaryBusy"
              @click="startSummary"
            >
              {{ hasResult ? '重新生成总结' : running ? '正在总结…' : '开始总结' }}
            </button>
            <button v-if="running" class="btn btn--ghost" type="button" @click="cancelSummary">取消</button>
          </div>
          <p class="hint">基于字幕生成，依据的是视频里说过的内容。</p>
        </template>

        <template v-else>
          <p class="hint">
            这个视频没有可用字幕。可以改用画面识别：在页面上抽取关键画面，交给视觉模型描述，再据此生成总结。
          </p>
          <div class="actions">
            <button
              v-if="visionConfigured"
              class="btn btn--primary btn--wide"
              type="button"
              :disabled="running || summaryBusy"
              @click="startFrameSummary(false)"
            >
              {{ frameButtonText }}
            </button>
            <button v-if="running" class="btn btn--ghost" type="button" @click="cancelSummary">取消</button>
          </div>

          <p v-if="!visionConfigured" class="hint hint--warn">
            尚未配置视觉模型，画面识别不可用。请到扩展设置页填入一个支持图片输入的模型名称（例如 qwen3.5-flash、gpt-4o）。
          </p>
          <div v-else class="meta meta--actions">
            <span v-if="hasFrameScript">已有 {{ frameScript?.entries.length }} 条画面描述</span>
            <span v-else>逐段抽帧并逐批识别，长视频需要几分钟（进度见下方）</span>
            <button v-if="hasFrameScript" class="link-btn" type="button" @click="startFrameSummary(true)">
              重新识别
            </button>
            <button v-if="hasFrameScript" class="link-btn" type="button" @click="clearFrameScript">
              清除
            </button>
          </div>
        </template>

        <div v-if="running" class="progress">
          <div class="progress__bar" :class="{ 'progress__bar--idle': progressIndeterminate }">
            <div
              class="progress__fill"
              :class="{ 'progress__fill--idle': progressIndeterminate }"
              :style="progressIndeterminate ? undefined : { width: `${progressPercent}%` }"
            />
          </div>
          <div class="progress__text">{{ task?.message }}</div>
        </div>

        <p v-if="summaryError" class="alert alert--error">{{ summaryError }}</p>
        <p v-else-if="frameError" class="alert alert--error">{{ frameError }}</p>
        <p v-else-if="task?.status === 'failed' && task.error" class="alert alert--error">{{ task.error }}</p>
        <p v-else-if="task?.status === 'cancelled'" class="alert alert--warn">已取消本次总结</p>
        <p v-if="taskOwnerMismatch" class="alert alert--error">
          这份总结记录的视频是 {{ task?.videoKey }}，与当前视频 {{ videoKey }} 不一致，已隐藏以免误读。请点「重新生成总结」在本视频上重新生成。
        </p>

        <div v-if="task?.result && !taskOwnerMismatch" class="result">
          <p class="result__overview">{{ task.result.overview }}</p>

          <div v-if="task.result.highlights.length > 0" class="block">
            <div class="block__title">关键要点</div>
            <ul class="points">
              <li v-for="(item, index) in task.result.highlights" :key="index">{{ item }}</li>
            </ul>
          </div>

          <div v-if="task.result.chapters.length > 0" class="block">
            <div class="block__title">章节</div>
            <ul class="chapters">
              <li v-for="(chapter, index) in task.result.chapters" :key="index" class="chapters__item">
                <button class="chapters__time" type="button" @click="seek(chapter.startMs)">
                  {{ clock(chapter.startMs) }}
                </button>
                <div class="chapters__main">
                  <div class="chapters__title">{{ chapter.title }}</div>
                  <ul v-if="chapter.points.length > 0" class="points points--tight">
                    <li v-for="(point, pi) in chapter.points" :key="pi">{{ point }}</li>
                  </ul>
                </div>
              </li>
            </ul>
          </div>

          <div v-if="mindMap" class="block">
            <div class="block__title">思维导图</div>
            <div class="mindmap__bar">
              <span class="mindmap__size">{{ mindMap.width }} × {{ mindMap.height }} 像素</span>
              <button class="link-btn" type="button" @click="mindMapZoom = !mindMapZoom">
                {{ mindMapZoom ? '缩小到适配宽度' : '放大到原始大小' }}
              </button>
            </div>
            <div class="mindmap" :class="{ 'mindmap--zoom': mindMapZoom }">
              <img
                class="mindmap__img"
                :src="mindMap.dataUrl"
                :width="mindMap.width"
                :height="mindMap.height"
                alt="本视频的思维导图"
              />
            </div>
            <div class="actions actions--export">
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="exportBusy !== 'idle'"
                @click="downloadMindMapSvg"
              >
                {{ exportBusy === 'svg' ? '导出中…' : '下载 .svg' }}
              </button>
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="exportBusy !== 'idle'"
                @click="downloadMindMapPng"
              >
                {{ exportBusy === 'png' ? '导出中…' : '下载 .png' }}
              </button>
            </div>
          </div>

          <div class="footnote">
            共 {{ task.result.chunkCount }} 段 · {{ resultEntryLabel }} ·
            总耗时 {{ totalElapsedSeconds }} 秒
            <template v-if="task.result.model"> · {{ task.result.model }}</template>
          </div>

          <div v-if="materialNote" class="footnote footnote--material">{{ materialNote }}</div>

          <p v-if="chapterCoverageNote" class="hint hint--warn">{{ chapterCoverageNote }}</p>

          <div class="actions actions--export">
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="exportBusy !== 'idle'"
              @click="downloadMarkdown"
            >
              {{ exportBusy === 'markdown' ? '导出中…' : '下载 .md' }}
            </button>
            <button
              class="btn btn--ghost"
              type="button"
              :disabled="exportBusy !== 'idle'"
              @click="copyToMubu"
            >
              {{ exportBusy === 'mubu' ? '复制中…' : '复制到幕布' }}
            </button>
          </div>
          <p v-if="exportError" class="alert alert--error">{{ exportError }}</p>
          <p v-else-if="exportNotice" class="hint hint--ok">{{ exportNotice }}</p>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.head__status {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.head__dot--ok {
  background: var(--ok);
}

.head__dot--idle {
  background: var(--muted);
}

.icon-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}

.icon-btn:hover {
  background: var(--bg-soft);
  color: var(--text);
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 11px 12px;
}

.card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.card__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.card__title-main {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}

.tag {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--muted);
  flex: none;
}

.tag--ok {
  color: var(--ok);
  border-color: color-mix(in srgb, var(--ok) 40%, transparent);
  background: color-mix(in srgb, var(--ok) 10%, transparent);
}

/* 来源标签：让用户一眼看出结论依据的是「听到的」还是「看到的」 */
.tag--source {
  color: var(--accent-strong);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  background: var(--accent-soft);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--muted);
}

.meta--actions {
  align-items: center;
  gap: 8px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: var(--accent-strong);
  font-size: 11.5px;
  font-family: inherit;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.link-btn:hover {
  color: var(--accent);
}

.hint--warn {
  color: var(--warn);
  margin-top: 8px;
}

.hint {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--muted);
}

/* 导出成功提示：与错误提示共用位置，改用主题成功色以示区别 */
.hint--ok {
  margin-top: 8px;
  color: var(--ok);
}

/* 导出按钮排在脚注下方，与结果内容拉开一点距离 */
.actions--export {
  margin-top: 12px;
}

.cues {
  list-style: none;
  margin: 8px 0 0;
  padding: 7px 9px;
  border-radius: 8px;
  background: var(--bg-soft);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.cues__item {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
}

.cues__time {
  flex: none;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

/* 展开全文后时间戳可点击跳转，需要清掉按钮默认样式 */
.cues__time--btn {
  border: 0;
  background: none;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  text-align: left;
}

.cues__time--btn:hover {
  text-decoration: underline;
}

/* 展开态：限高滚动，避免几百条字幕把面板撑成瀑布 */
.cues--full {
  max-height: 260px;
  overflow-y: auto;
}

.cues__text {
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.btn {
  border-radius: 7px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s, opacity 0.16s;
  font-family: inherit;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-strong);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}

.btn--primary:hover:not(:disabled) {
  background: var(--accent-strong);
  color: #fff;
}

.btn--wide {
  flex: 1;
}

.alert {
  margin: 9px 0 0;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 11.5px;
  line-height: 1.55;
}

.alert--warn {
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  color: var(--warn);
}

.alert--error {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.progress {
  margin-top: 10px;
}

.progress__bar {
  height: 5px;
  border-radius: 3px;
  background: var(--bg-soft);
  overflow: hidden;
}

.progress__fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

/* 抽帧阶段没有分块进度可算，用往返扫光表示「在动但进度未知」 */
.progress__bar--idle {
  position: relative;
}

.progress__fill--idle {
  width: 40%;
  animation: sweep 1.15s ease-in-out infinite;
}

@keyframes sweep {
  0% {
    margin-left: -40%;
  }
  100% {
    margin-left: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress__fill--idle {
    animation: none;
    width: 100%;
    opacity: 0.4;
  }
}

.progress__text {
  margin-top: 5px;
  font-size: 11px;
  color: var(--muted);
}

.result {
  margin-top: 12px;
  padding-top: 11px;
  border-top: 1px dashed var(--border);
}

.result__overview {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--text-2);
}

.block {
  margin-top: 13px;
}

.block__title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 6px;
  letter-spacing: 0.02em;
}

.points {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-2);
}

.points--tight {
  margin-top: 3px;
  gap: 2px;
  font-size: 11.5px;
  color: var(--muted);
}

.chapters {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.chapters__item {
  display: flex;
  gap: 9px;
}

.chapters__time {
  flex: none;
  height: fit-content;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  background: var(--accent-soft);
  color: var(--accent-strong);
  border-radius: 6px;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  font-family: inherit;
}

.chapters__time:hover {
  background: var(--accent);
  color: #fff;
}

.chapters__main {
  min-width: 0;
  flex: 1;
}

.chapters__title {
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.5;
}

/* 思维导图预览：限制高度并允许滚动，长视频的图会比面板高很多 */
.mindmap__bar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.mindmap__size {
  font-size: 10.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.mindmap {
  margin-top: 6px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}

.mindmap__img {
  display: block;
  width: 100%;
  height: auto;
}

/* 原始大小：不再压扁，靠容器横向滚动读文字 */
.mindmap--zoom .mindmap__img {
  width: auto;
  max-width: none;
}

.footnote {
  margin-top: 12px;
  font-size: 10.5px;
  color: var(--muted);
}

/* 素材指纹：与耗时统计分开一行，便于把总结内容与字幕原文对照 */
.footnote--material {
  margin-top: 4px;
  line-height: 1.5;
  word-break: break-word;
}

.hidden {
  display: none;
}
</style>
