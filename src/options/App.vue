<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import { APP_VERSION } from '@/core/config/app';
import { DEFAULT_SETTINGS } from '@/core/config/defaults';
import { AppError } from '@/core/errors/app-error';
import { messageClient } from '@/core/messaging/client';
import type { ExtensionSettings } from '@/core/settings/types';
import { formatDateTime } from '@/core/utils/format';
import { useTheme } from '@/composables/use-theme';
import BrandMark from '@/components/BrandMark.vue';
import AboutSection from './components/AboutSection.vue';
import ChunkSection from './components/ChunkSection.vue';
import FrameSection from './components/FrameSection.vue';
import GeneralSection from './components/GeneralSection.vue';
import ModelSection from './components/ModelSection.vue';
import VisionSection from './components/VisionSection.vue';
import { createSettingsRules } from './rules';

const form = ref<ExtensionSettings>(structuredClone(DEFAULT_SETTINGS));
const formRef = ref<FormInstance>();
const baseline = ref('');
const loading = ref(true);
const loadError = ref<string | null>(null);
const saving = ref(false);
const issues = ref<string[]>([]);
const lastSavedAt = ref(0);

useTheme(computed(() => form.value.general.theme));

const rules = createSettingsRules(() => form.value);

function serialize(value: ExtensionSettings): string {
  return JSON.stringify({
    model: value.model,
    vision: value.vision,
    chunk: value.chunk,
    frames: value.frames,
    general: value.general
  });
}

const dirty = computed(() => baseline.value.length > 0 && serialize(form.value) !== baseline.value);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const snapshot = await messageClient.send('settings.get');
    form.value = snapshot.settings;
    baseline.value = serialize(snapshot.settings);
    lastSavedAt.value = snapshot.settings.updatedAt;
  } catch (cause) {
    loadError.value = AppError.from(cause).message;
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().then(
    () => true,
    () => false
  );
  if (!valid) {
    ElMessage.warning('请先修正标红的配置项');
    return;
  }

  saving.value = true;
  try {
    const result = await messageClient.send('settings.update', {
      patch: {
        model: { ...form.value.model },
        vision: { ...form.value.vision },
        chunk: { ...form.value.chunk },
        frames: { ...form.value.frames },
        general: { ...form.value.general }
      }
    });
    form.value = result.settings;
    baseline.value = serialize(result.settings);
    lastSavedAt.value = result.settings.updatedAt;
    issues.value = result.issues;
    if (result.issues.length > 0) {
      ElMessage.warning(`已保存，但有 ${result.issues.length} 项被自动修正`);
    } else {
      ElMessage.success('设置已保存');
    }
  } catch (cause) {
    ElMessage.error(AppError.from(cause).message);
  } finally {
    saving.value = false;
  }
}

async function reset(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将清除已保存的模型地址、API Key 与分块参数，并恢复默认值。是否继续？',
      '恢复默认设置',
      { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }

  try {
    const snapshot = await messageClient.send('settings.reset');
    form.value = snapshot.settings;
    baseline.value = serialize(snapshot.settings);
    lastSavedAt.value = snapshot.settings.updatedAt;
    issues.value = [];
    ElMessage.success('已恢复默认设置');
  } catch (cause) {
    ElMessage.error(AppError.from(cause).message);
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload);
  void load();
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload);
});
</script>

<template>
  <div class="options-page">
    <header class="options-header">
      <BrandMark class="options-header__brand" :size="40" />
      <div>
        <h1 class="options-header__title">B站 AI 视频总结 · 设置</h1>
        <p class="options-header__subtitle">模型服务、长视频分块与界面偏好</p>
      </div>
      <span class="options-header__spacer" />
      <el-tag disable-transitions type="info" effect="plain" round>v{{ APP_VERSION }}</el-tag>
    </header>

    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      show-icon
      :closable="false"
      description="设置无法读取时，请尝试重新加载扩展或重开本页面。"
    >
      <el-button size="small" type="primary" plain style="margin-top: 8px" @click="load">
        重试
      </el-button>
    </el-alert>

    <el-skeleton v-else-if="loading" :rows="8" animated />

    <template v-else>
      <el-alert
        class="stage-alert"
        type="info"
        show-icon
        :closable="false"
        title="三步开始使用"
      >
        <ol class="start-steps">
          <li>在下方「模型服务」填入服务地址与 API Key，点「测试连接」确认能通，再点底部「保存设置」。</li>
          <li>点「授权该域名」，允许扩展访问这个模型服务；不授权时请求会被浏览器拦下。</li>
          <li>回到 B 站视频页，点右侧信息栏的「AI 总结视频」，选字幕来源后开始总结。</li>
        </ol>
      </el-alert>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="save"
      >
        <div class="settings-stack">
          <ModelSection v-model="form.model" :dirty="dirty" />
          <VisionSection v-model="form.vision" :dirty="dirty" :fallback-base-url="form.model.baseUrl" />
          <ChunkSection v-model="form.chunk" />
          <FrameSection v-model="form.frames" />
          <GeneralSection v-model="form.general" />
          <AboutSection />
        </div>
      </el-form>

      <el-alert
        v-if="issues.length > 0"
        class="stage-alert"
        type="warning"
        show-icon
        :closable="false"
        title="保存时已自动修正以下字段"
      >
        <ul style="margin: 4px 0 0; padding-left: 18px">
          <li v-for="issue in issues" :key="issue">{{ issue }}</li>
        </ul>
      </el-alert>

      <div class="options-footer">
        <span class="options-footer__state">
          <template v-if="dirty">有未保存的修改</template>
          <template v-else-if="lastSavedAt">
            已保存于 <strong>{{ formatDateTime(lastSavedAt) }}</strong>
          </template>
          <template v-else>尚未保存过设置，当前显示默认值</template>
        </span>
        <el-button @click="reset">恢复默认</el-button>
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">
          保存设置
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stage-alert {
  margin-bottom: 14px;
}

.stage-alert :deep(.el-alert__description) {
  line-height: 1.7;
  font-size: 12.5px;
}

/* 首次使用的三步指引：编号列表比一整段话更容易照着做 */
.start-steps {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
