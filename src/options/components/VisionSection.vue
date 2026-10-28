<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { AiTestResult } from '@/core/ai/types';
import { AppError } from '@/core/errors/app-error';
import { messageClient } from '@/core/messaging/client';
import { buildOriginPattern } from '@/core/settings/origin';
import type { VisionSettings } from '@/core/settings/types';
import SettingsSection from './SettingsSection.vue';

const vision = defineModel<VisionSettings>({ required: true });

const props = defineProps<{
  dirty?: boolean;
  /** 主模型 Base URL，用于展示「留空则沿用」的实际地址 */
  fallbackBaseUrl?: string;
}>();

const effectiveBaseUrl = computed(() => vision.value.baseUrl.trim() || props.fallbackBaseUrl || '');
const originPattern = computed(() => buildOriginPattern(effectiveBaseUrl.value));
const enabled = computed(() => vision.value.model.trim().length > 0);

const permissionState = ref<'unknown' | 'granted' | 'missing'>('unknown');
const requesting = ref(false);
const testing = ref(false);
const testResult = ref<AiTestResult | null>(null);

async function refreshPermission(): Promise<void> {
  const pattern = originPattern.value;
  if (!pattern || typeof chrome === 'undefined' || !chrome.permissions) {
    permissionState.value = 'unknown';
    return;
  }
  try {
    const granted = await chrome.permissions.contains({ origins: [pattern] });
    permissionState.value = granted ? 'granted' : 'missing';
  } catch {
    permissionState.value = 'unknown';
  }
}

async function requestPermission(): Promise<void> {
  const pattern = originPattern.value;
  if (!pattern) {
    ElMessage.warning('请先填写合法的 Base URL');
    return;
  }
  requesting.value = true;
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    permissionState.value = granted ? 'granted' : 'missing';
    if (granted) ElMessage.success('已获得该域名的访问授权');
    else ElMessage.warning('未授权，画面识别会因为缺少权限而失败');
  } catch (error) {
    ElMessage.error(`授权失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    requesting.value = false;
  }
}

const permissionTag = computed(() => {
  if (permissionState.value === 'granted') return { type: 'success' as const, text: '已授权' };
  if (permissionState.value === 'missing') return { type: 'warning' as const, text: '未授权' };
  return { type: 'info' as const, text: '待填写地址' };
});

/**
 * 测试结论的展示口径。
 *
 * 「接口通」和「模型真的看了图」是两件事：中转站可能静默丢掉图片部分，
 * 返回 200 但内容为空。此前只要 ok 就显示绿色「图片输入可用」，
 * 与实际能力不符——现在按 imageAccepted 分三档，未验证也不假装成功。
 */
const testAlert = computed<{ type: 'success' | 'warning' | 'error'; title: string }>(() => {
  const result = testResult.value;
  if (!result) return { type: 'success', title: '' };
  if (!result.ok) return { type: 'error', title: '测试失败' };
  if (result.imageAccepted === true) return { type: 'success', title: '图片输入可用' };
  if (result.imageAccepted === false) return { type: 'warning', title: '接口可用，但模型不看图' };
  return { type: 'warning', title: '接口可用（图片能力未验证）' };
});

async function testVision(): Promise<void> {
  if (props.dirty) {
    ElMessage.warning('有未保存的修改。测试使用已保存的设置，请先点击底部「保存设置」');
    testResult.value = null;
    return;
  }
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await messageClient.send('ai.testVision');
  } catch (cause) {
    const error = AppError.from(cause);
    testResult.value = {
      ok: false,
      model: null,
      latencyMs: 0,
      message: error.message,
      errorCode: error.code
    };
  } finally {
    testing.value = false;
  }
}

/** 配置一旦改动，上一次的测试结论就不再可信。 */
watch(
  () => [vision.value.baseUrl, vision.value.apiKey, vision.value.model].join('\u0000'),
  () => {
    testResult.value = null;
  }
);

watch(originPattern, () => {
  void refreshPermission();
  testResult.value = null;
});

onMounted(() => {
  void refreshPermission();
});
</script>

<template>
  <SettingsSection
    title="视觉模型（可选）"
    description="视频没有字幕时，扩展会抽取关键画面交给视觉模型描述，再据此生成总结。只有填写了模型名称才会启用该能力。"
  >
    <div class="status-row">
      <span class="status-row__label">画面识别</span>
      <el-tag size="small" :type="enabled ? 'success' : 'info'" effect="light">
        {{ enabled ? '已启用' : '未启用' }}
      </el-tag>
      <span class="field-hint" style="margin: 0">
        {{ enabled ? `将使用 ${vision.model}` : '填写下方模型名称即可启用' }}
      </span>
    </div>

    <el-form-item label="视觉模型 Base URL（留空则沿用主模型）">
      <el-input
        v-model="vision.baseUrl"
        :placeholder="fallbackBaseUrl || 'https://api.openai.com/v1'"
        spellcheck="false"
      />
    </el-form-item>
    <p class="field-hint">
      当前实际请求地址：<span class="mono">{{ effectiveBaseUrl || '未填写' }}</span>
    </p>

    <el-form-item label="视觉模型 API Key（留空则沿用主模型）">
      <el-input
        v-model="vision.apiKey"
        type="password"
        show-password
        autocomplete="off"
        spellcheck="false"
        placeholder="留空即使用主模型的 API Key"
      />
    </el-form-item>

    <el-form-item label="视觉模型名称">
      <el-input v-model="vision.model" placeholder="例如 qwen3.5-flash、gpt-4o" spellcheck="false" />
    </el-form-item>
    <p class="field-hint">
      必须是<strong>支持图片输入</strong>的模型。注意：纯文本模型或中转站上的别名可能<strong>不报错</strong>，
      而是返回 200 加空内容——务必用下方「测试图片能力」确认它真的能看图。
    </p>

    <div class="permission-row">
      <span class="permission-row__status">域名授权</span>
      <el-tag size="small" :type="permissionTag.type" effect="light">{{ permissionTag.text }}</el-tag>
      <span v-if="originPattern" class="permission-row__pattern mono muted">{{ originPattern }}</span>
      <el-button
        size="small"
        type="primary"
        plain
        :loading="requesting"
        :disabled="!originPattern || permissionState === 'granted'"
        style="margin-left: auto"
        @click="requestPermission"
      >
        {{ permissionState === 'granted' ? '已授权' : '授权该域名' }}
      </el-button>
    </div>

    <div class="test-row">
      <el-button type="primary" :loading="testing" :disabled="!enabled" @click="testVision">
        测试图片能力
      </el-button>
      <span class="field-hint" style="margin: 0">
        会真实发送一张测试图片，确认该模型接受图片输入；使用<strong>已保存</strong>的设置。
      </span>
    </div>

    <el-alert
      v-if="testResult"
      class="test-result"
      :type="testAlert.type"
      :closable="false"
      show-icon
      :title="testAlert.title"
    >
      <p class="test-result__message">{{ testResult.message }}</p>
      <p class="test-result__meta muted">
        <span v-if="testResult.model">模型 <span class="mono">{{ testResult.model }}</span> · </span>
        <span>耗时 {{ testResult.latencyMs }} ms</span>
        <span v-if="testResult.errorCode"> · 错误码 <span class="mono">{{ testResult.errorCode }}</span></span>
      </p>
    </el-alert>
  </SettingsSection>
</template>

<style scoped>
.status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.status-row__label {
  font-size: 12.5px;
  color: var(--text-2);
}

.test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.test-result {
  margin-top: 12px;
}

.test-result__message {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-word;
}

.test-result__meta {
  margin: 4px 0 0;
  font-size: 12px;
}
</style>
