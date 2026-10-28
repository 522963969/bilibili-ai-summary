<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Setting } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { APP_VERSION, BILIBILI_ORIGIN } from '@/core/config/app';
import type { ContentRequestMessage, OpenPanelResult } from '@/core/messaging/contracts';
import { useTheme } from '@/composables/use-theme';
import { useSettingsStore } from '@/stores/settings';
import { useVideoStore } from '@/stores/video';
import BrandMark from '@/components/BrandMark.vue';
import EmptyState from './components/EmptyState.vue';
import ModelStatusCard from './components/ModelStatusCard.vue';
import RoadmapCard from './components/RoadmapCard.vue';
import SubtitleCard from './components/SubtitleCard.vue';
import VideoCard from './components/VideoCard.vue';

const settingsStore = useSettingsStore();
const videoStore = useVideoStore();

useTheme(computed(() => settingsStore.theme));

const unsupportedReason = computed(() => {
  const current = videoStore.resolution;
  return current?.status === 'unsupported-page' ? current.reason : '请在浏览器中打开任意 B 站视频播放页。';
});

const emptyTitle = computed(() => {
  const current = videoStore.resolution;
  if (current?.status === 'no-active-tab') return '未找到当前标签页';
  return '当前页面不是 B 站视频';
});

const emptyDescription = computed(() => {
  const current = videoStore.resolution;
  if (current?.status === 'no-active-tab') {
    return '扩展无法读取当前窗口的活动标签页，请关闭本面板后重新点击工具栏图标。';
  }
  return unsupportedReason.value;
});

function openOptions(): void {
  void chrome.runtime.openOptionsPage();
}

const openingPanel = ref(false);

const footerHint = computed(() =>
  videoStore.video
    ? '字幕、摘要与章节都在 B 站页面右侧面板中'
    : '打开 B 站视频页后即可在右侧信息栏使用总结'
);

const OPEN_PANEL_REASON: Record<string, string> = {
  'not-video-page': '当前标签页不是 B 站视频播放页',
  'entry-unavailable': '页面入口尚未就绪，请稍等一秒或刷新页面后重试',
  'identity-unresolved': '暂时识别不出当前视频（可能是分 P 尚未加载完成），请稍后重试'
};

/**
 * 直接展开页面内侧边面板。
 * Popup 只有 activeTab 权限，但用户点击扩展图标即已授予，
 * 因此可以对该标签页的内容脚本发消息。
 */
async function openPanelOnPage(): Promise<void> {
  const tabId = videoStore.video?.tabId;
  if (tabId === undefined || tabId === null) return;

  openingPanel.value = true;
  try {
    const message: ContentRequestMessage = { type: 'content.openPanel', payload: undefined };
    const result = await chrome.tabs.sendMessage<ContentRequestMessage, OpenPanelResult>(
      tabId,
      message
    );
    if (result?.opened) {
      window.close();
      return;
    }
    ElMessage.warning(OPEN_PANEL_REASON[result?.reason ?? ''] ?? '页面侧边面板未能打开');
  } catch {
    ElMessage.error('与页面通信失败，请刷新 B 站页面后重试');
  } finally {
    openingPanel.value = false;
  }
}

function openBilibili(): void {
  void chrome.tabs.create({ url: BILIBILI_ORIGIN });
}

onMounted(() => {
  void Promise.allSettled([settingsStore.load(), videoStore.refresh()]);
});
</script>

<template>
  <div class="popup">
    <header class="popup__header">
      <BrandMark class="popup__brand" :size="30" />
      <div style="flex: 1; min-width: 0">
        <h1 class="popup__title">B站 AI 视频总结</h1>
        <p class="popup__subtitle">v{{ APP_VERSION }}</p>
      </div>
      <el-tooltip content="打开设置" placement="bottom">
        <el-button circle text :icon="Setting" aria-label="打开设置" @click="openOptions" />
      </el-tooltip>
    </header>

    <main class="popup__body">
      <template v-if="videoStore.loading">
        <div class="app-card">
          <el-skeleton :rows="3" animated />
        </div>
      </template>

      <el-alert
        v-else-if="videoStore.error"
        :title="videoStore.error"
        type="error"
        show-icon
        :closable="false"
      >
        <el-button size="small" text type="primary" @click="videoStore.refresh()">重试</el-button>
      </el-alert>

      <template v-else-if="videoStore.video">
        <VideoCard :video="videoStore.video" />
        <SubtitleCard :tab-id="videoStore.video.tabId" :video-key="videoStore.video.identity.key" />
      </template>

      <EmptyState v-else :title="emptyTitle" :description="emptyDescription">
        <el-button size="small" type="primary" plain @click="openBilibili">打开 B 站</el-button>
        <el-button size="small" text @click="videoStore.refresh()">重新检测</el-button>
      </EmptyState>

      <el-alert
        v-if="settingsStore.error"
        :title="settingsStore.error"
        type="warning"
        show-icon
        :closable="false"
      />

      <ModelStatusCard
        :settings="settingsStore.settings"
        :configured="settingsStore.modelConfigured"
        @open-settings="openOptions"
      />

      <RoadmapCard />
    </main>

    <footer class="popup__footer">
      <div style="flex: 1">
        <p class="popup__footer-hint">{{ footerHint }}</p>
        <el-button
          type="primary"
          style="width: 100%"
          :loading="openingPanel"
          :disabled="!videoStore.video"
          @click="openPanelOnPage"
        >
          打开页面侧边面板
        </el-button>
      </div>
      <el-button text @click="openOptions">设置</el-button>
    </footer>
  </div>
</template>
