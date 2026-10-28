<script setup lang="ts">
import { computed } from 'vue';
import { Link, VideoPlay } from '@element-plus/icons-vue';
import { formatClock } from '@/core/utils/format';
import type { ResolvedVideo } from '@/core/video/types';

const props = defineProps<{ video: ResolvedVideo }>();

const title = computed(() => props.video.pageContext?.title ?? props.video.fallbackTitle);
const author = computed(() => props.video.pageContext?.author ?? null);
const duration = computed(() => props.video.pageContext?.durationSeconds ?? null);
const identity = computed(() => props.video.identity);

const chips = computed(() => {
  const items: Array<{ label: string; value: string }> = [];
  if (identity.value.bvid) {
    items.push({ label: 'BV', value: identity.value.bvid });
  } else if (identity.value.aid) {
    items.push({ label: 'AV', value: `av${identity.value.aid}` });
  }
  if (identity.value.page > 1) {
    items.push({ label: '分P', value: `P${identity.value.page}` });
  }
  if (duration.value !== null) {
    items.push({ label: '时长', value: formatClock(duration.value) });
  }
  return items;
});
</script>

<template>
  <section class="app-card video-card">
    <div class="app-card__header">
      <span class="app-card__title">
        <el-icon><VideoPlay /></el-icon>
        当前视频
      </span>
      <el-tag disable-transitions size="small" type="success" effect="light" round>已识别</el-tag>
    </div>

    <h2 class="video-card__title" :title="title">{{ title }}</h2>

    <p v-if="author" class="video-card__author">UP 主：{{ author }}</p>

    <div class="video-card__chips">
      <span v-for="chip in chips" :key="chip.label" class="video-chip">
        <span class="video-chip__label">{{ chip.label }}</span>
        <span class="video-chip__value mono">{{ chip.value }}</span>
      </span>
      <span v-if="chips.length === 0" class="video-chip video-chip--empty">未读取到编号</span>
    </div>

    <div class="video-card__status">
      <span class="tag-dot" :class="video.contentScriptAvailable ? 'tag-dot--ok' : 'tag-dot--warn'" />
      <span v-if="video.contentScriptAvailable">页面脚本已连接，可读取页面上下文</span>
      <span v-else>页面脚本未连接，标题取自标签页；请刷新视频页后重试</span>
    </div>

    <a class="video-card__link" :href="video.identity.canonicalUrl" target="_blank" rel="noreferrer">
      <el-icon><Link /></el-icon>
      在浏览器中打开规范链接
    </a>
  </section>
</template>

<style scoped>
.video-card__title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.video-card__author {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--app-text-secondary);
}

.video-card__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.video-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  font-size: 11px;
  line-height: 18px;
}

.video-chip__label {
  color: var(--app-text-muted);
}

.video-chip__value {
  color: var(--app-text);
  font-weight: 500;
}

.video-chip--empty {
  color: var(--app-text-muted);
}

.video-card__status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed var(--app-border);
  font-size: 11.5px;
  color: var(--app-text-secondary);
}

.video-card__link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--app-accent-strong);
}
</style>
