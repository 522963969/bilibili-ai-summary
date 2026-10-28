<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Document, Upload } from '@element-plus/icons-vue';
import { formatCueClock } from '@/core/subtitle/timestamp';
import { formatDurationHuman } from '@/core/utils/format';
import { useSubtitleStore } from '@/stores/subtitle';

const props = defineProps<{
  tabId: number;
  videoKey: string;
}>();

const store = useSubtitleStore();
const fileInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.videoKey,
  (key) => {
    if (key) void store.loadCached(key);
  },
  { immediate: true }
);

const busyLabel = computed(() => {
  if (store.busy === 'discover') return '正在读取字幕列表…';
  if (store.busy === 'fetch') return '正在下载并解析字幕…';
  if (store.busy === 'import') return '正在导入字幕…';
  return '';
});

const trackOptions = computed(() =>
  store.availableTracks.map((track) => ({
    id: track.id,
    label: track.isAiGenerated ? `${track.label}（AI）` : track.label,
    lang: track.lang
  }))
);

const sourceLabel = computed(() => {
  const current = store.subtitle;
  if (!current) return '';
  if (current.source === 'import') {
    return `导入文件：${current.importedFileName ?? '未命名'}`;
  }
  return `来源：B 站 · ${current.label}`;
});

async function onFetch(): Promise<void> {
  await store.discoverAndFetch(props.tabId);
  if (store.hasSubtitle) {
    ElMessage.success(`已获取 ${store.subtitle?.stats.cueCount ?? 0} 条字幕`);
    return;
  }
  if (!store.error && store.statusMessage) {
    ElMessage.warning(store.statusMessage);
  }
}

async function onTrackChange(trackId: string): Promise<void> {
  if (!trackId) return;
  await store.fetchTrack(props.tabId, trackId);
  if (store.hasSubtitle) ElMessage.success(`已切换字幕轨道`);
}

function pickFile(): void {
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const result = await store.importFile(props.tabId, file);
  if (result) {
    ElMessage.success(`已导入 ${result.stats.cueCount} 条字幕`);
  } else if (store.error) {
    ElMessage.error(store.error);
  }
}

async function onClear(): Promise<void> {
  const cleared = await store.clear(props.videoKey);
  if (cleared) {
    store.discovery = null;
    ElMessage.success('已清除该视频的字幕缓存');
  }
}
</script>

<template>
  <section class="app-card">
    <div class="app-card__header">
      <span class="app-card__title">
        <el-icon><Document /></el-icon>
        字幕
      </span>
      <el-tag v-if="store.hasSubtitle" disable-transitions size="small" type="success" effect="light" round>
        已获取
      </el-tag>
      <el-tag v-else-if="store.isLoading" disable-transitions size="small" type="info" effect="light" round>
        处理中
      </el-tag>
      <el-tag v-else disable-transitions size="small" type="info" effect="plain" round>未获取</el-tag>
    </div>

    <p v-if="busyLabel" class="sub-busy">{{ busyLabel }}</p>

    <!-- 已获取字幕：展示真实统计与前几条时间戳 -->
    <template v-if="store.hasSubtitle && store.subtitle">
      <div class="sub-meta">
        <span class="mono">{{ store.subtitle.stats.cueCount }} 条</span>
        <span class="sub-dot">·</span>
        <span>{{ formatDurationHuman(store.subtitle.stats.totalDurationMs / 1000) }}</span>
      </div>
      <p class="sub-source">{{ sourceLabel }}</p>

      <ul class="cue-list">
        <li v-for="cue in store.previewCues" :key="cue.index" class="cue-item">
          <span class="cue-time mono">{{ formatCueClock(cue.startMs) }}</span>
          <span class="cue-text">{{ cue.text }}</span>
        </li>
      </ul>
      <p v-if="store.subtitle.cues.length > store.previewCues.length" class="sub-note">
        仅预览前 {{ store.previewCues.length }} 条，共 {{ store.subtitle.stats.cueCount }} 条
      </p>

      <p
        v-if="store.subtitle.stats.repairedCues > 0 || store.subtitle.stats.droppedCues > 0"
        class="sub-note"
      >
        规范化：修正 {{ store.subtitle.stats.repairedCues }} 条时间，丢弃
        {{ store.subtitle.stats.droppedCues }} 条空文本
      </p>

      <div class="sub-actions">
        <el-button size="small" :loading="store.isLoading" @click="onFetch">重新获取</el-button>
        <el-button size="small" text :icon="Upload" @click="pickFile">导入文件</el-button>
        <el-button size="small" text type="danger" @click="onClear">清除</el-button>
      </div>
    </template>

    <!-- 未获取：获取或导入 -->
    <template v-else>
      <p class="sub-hint">
        字幕只从当前浏览器会话可访问的 B 站字幕接口读取，不绕过登录与权限；读取不到时可导入本地 SRT / VTT / JSON。
      </p>

      <div class="sub-actions">
        <el-button
          size="small"
          type="primary"
          :loading="store.busy === 'discover' || store.busy === 'fetch'"
          @click="onFetch"
        >
          获取字幕
        </el-button>
        <el-button size="small" text :icon="Upload" @click="pickFile">导入本地字幕</el-button>
      </div>

      <div v-if="trackOptions.length > 0" class="track-row">
        <span class="track-row__label">轨道</span>
        <el-select
          :model-value="store.selectedTrackId ?? undefined"
          size="small"
          placeholder="选择字幕轨道"
          style="flex: 1"
          @change="onTrackChange"
        >
          <el-option
            v-for="option in trackOptions"
            :key="option.id"
            :label="option.label"
            :value="option.id"
          />
        </el-select>
      </div>

      <el-alert
        v-if="store.statusMessage"
        class="sub-alert"
        :title="store.statusMessage"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-alert
        v-if="store.error"
        class="sub-alert"
        :title="store.error"
        type="error"
        :closable="false"
        show-icon
      />
    </template>

    <input
      ref="fileInput"
      type="file"
      accept=".srt,.vtt,.json,text/plain,application/json"
      class="hidden-input"
      @change="onFileChange"
    />
  </section>
</template>

<style scoped>
.sub-busy {
  font-size: 11.5px;
  color: var(--app-text-muted);
  margin-bottom: 8px;
}

.sub-hint {
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--app-text-muted);
}

.sub-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--app-text);
}

.sub-dot {
  color: var(--app-text-muted);
}

.sub-source {
  margin-top: 3px;
  font-size: 11px;
  color: var(--app-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cue-list {
  list-style: none;
  margin: 9px 0 0;
  padding: 8px 10px;
  border-radius: var(--app-radius-md);
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cue-item {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.5;
}

.cue-time {
  flex: none;
  color: var(--app-accent-strong);
  font-size: 11px;
  padding-top: 1px;
}

.cue-text {
  color: var(--app-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.sub-note {
  margin-top: 6px;
  font-size: 10.5px;
  color: var(--app-text-muted);
}

.sub-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.track-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.track-row__label {
  font-size: 11.5px;
  color: var(--app-text-muted);
  flex: none;
}

.sub-alert {
  margin-top: 10px;
}

.sub-alert :deep(.el-alert__title) {
  font-size: 11.5px;
  line-height: 1.6;
}

.hidden-input {
  display: none;
}
</style>
