<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { AiTestResult } from '@/core/ai/types';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@/core/config/defaults';
import { AppError } from '@/core/errors/app-error';
import { messageClient } from '@/core/messaging/client';
import { buildOriginPattern } from '@/core/settings/origin';
import type { ModelSettings } from '@/core/settings/types';
import SettingsSection from './SettingsSection.vue';

const model = defineModel<ModelSettings>({ required: true });

/** 「恢复推荐值」用的基准，直接取全局默认值的模型段，避免两处各写一份。 */
const DEFAULT_MODEL_DEFAULTS = DEFAULT_SETTINGS.model;

/**
 * dirty 由父级传入：连接测试走 Service Worker 读取已保存的设置，
 * 页面里未保存的修改不会生效，因此需要提前拦下并说明原因。
 */
const props = defineProps<{ dirty?: boolean }>();

const originPattern = computed(() => buildOriginPattern(model.value.baseUrl));
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
    if (granted) {
      ElMessage.success('已获得该域名的访问授权');
    } else {
      ElMessage.warning('未授权，调用模型时会因为缺少权限而失败');
    }
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

function updateTemperature(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) model.value.temperature = value;
}

function onMaxOutputTokens(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    model.value.maxOutputTokens = Math.round(value);
  }
}

/**
 * 超时对外用「秒」。
 *
 * 存储仍是毫秒（和请求层一致），只在界面上换算——用户看到 120000 需要心算，
 * 看到 120 秒 / 2 分钟则一眼就懂，不必为了可读性去动已落盘的配置。
 */
const timeoutSeconds = computed(() => Math.round(model.value.timeoutMs / 1000));

function onTimeoutSeconds(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    model.value.timeoutMs = Math.round(value) * 1000;
  }
}

/** 灵活程度的通俗读数：用户不需要理解 0~2 的量纲，只需要知道「偏稳还是偏放」。 */
const temperatureReadout = computed(() => {
  const value = model.value.temperature;
  if (value < 0.4) return '偏稳定：更贴近原话，多次结果接近';
  if (value < 0.8) return '均衡：略有变化，适合日常总结';
  if (value < 1.2) return '偏发散：措辞更自由，会加入自己的表述';
  return '很发散：结果差异大，可能出现无关联想';
});

/** 长度上限的通俗读数：按本项目 token 估算口径（一个汉字约 1 token）折算成字数。 */
const maxOutputReadout = computed(() => {
  const tokens = model.value.maxOutputTokens;
  const chars = tokens;
  return `约 ${chars.toLocaleString('zh-CN')} 字`;
});

/** 超时的通俗读数：超过 1 分钟就用「X 分 Y 秒」，避免用户自己除。 */
const timeoutReadout = computed(() => {
  const total = timeoutSeconds.value;
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
});

/** 一键回到默认值，省得用户自己去记「推荐是多少」。 */
const resetToken = ref(0);

function resetAdvanced(): void {
  model.value.temperature = DEFAULT_MODEL_DEFAULTS.temperature;
  model.value.maxOutputTokens = DEFAULT_MODEL_DEFAULTS.maxOutputTokens;
  model.value.timeoutMs = DEFAULT_MODEL_DEFAULTS.timeoutMs;
  /**
   * 强制重建两个数字输入框。
   *
   * el-input-number 会把用户手输的内容留在内部 userInput 里直到失焦，
   * 程序化改 modelValue 时它不会刷新显示——实测点「恢复推荐值」后，
   * 读数已经变回「约 2 分钟」，输入框里却还停在用户刚敲的 60，
   * 保存下来的却是 120000。这种「看到的数字和实际存的不一致」必须消掉。
   */
  resetToken.value += 1;
}

const isAdvancedDefault = computed(
  () =>
    model.value.temperature === DEFAULT_MODEL_DEFAULTS.temperature &&
    model.value.maxOutputTokens === DEFAULT_MODEL_DEFAULTS.maxOutputTokens &&
    model.value.timeoutMs === DEFAULT_MODEL_DEFAULTS.timeoutMs
);

async function testConnection(): Promise<void> {
  if (props.dirty) {
    ElMessage.warning('有未保存的修改。连接测试使用已保存的设置，请先点击底部「保存设置」');
    testResult.value = null;
    return;
  }
  testing.value = true;
  testResult.value = null;
  try {
    testResult.value = await messageClient.send('ai.testConnection');
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
  () => [model.value.baseUrl, model.value.apiKey, model.value.model].join('\u0000'),
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
    title="模型服务"
    description="兼容 OpenAI Chat Completions 协议的任意服务（OpenAI、DeepSeek、Moonshot、本地 vLLM / Ollama 等）。"
  >
    <el-form-item label="API Base URL" prop="model.baseUrl">
      <el-input v-model="model.baseUrl" placeholder="https://api.openai.com/v1" spellcheck="false" />
    </el-form-item>
    <p class="field-hint">
      填写到版本路径为止（如 /v1）。请求路径为 <span class="mono">/chat/completions</span>。
    </p>

    <el-form-item label="API Key">
      <el-input
        v-model="model.apiKey"
        type="password"
        show-password
        autocomplete="off"
        spellcheck="false"
        placeholder="sk-..."
      />
    </el-form-item>
    <p class="field-hint">
      密钥仅保存在扩展的本地存储（chrome.storage.local）中，不会发送给除上述服务地址之外的任何一方。本地存储不等同于系统级密钥库，请勿在共享电脑上保存生产密钥。
    </p>

    <el-form-item label="模型名称" prop="model.model">
      <el-input v-model="model.model" placeholder="gpt-4o-mini" spellcheck="false" />
    </el-form-item>

    <div class="field-group">
      <div class="field-group__head">
        <div>
          <span class="field-group__title">回答风格与等待时间</span>
          <span class="field-group__hint">下面三项通常不用改，默认值适合大多数视频</span>
        </div>
        <el-button link size="small" :disabled="isAdvancedDefault" @click="resetAdvanced">
          恢复推荐值
        </el-button>
      </div>

      <div class="field-grid field-grid--three">
        <el-form-item label="回答灵活程度">
          <div style="width: 100%">
            <el-slider
              :model-value="model.temperature"
              :min="SETTINGS_LIMITS.temperature.min"
              :max="SETTINGS_LIMITS.temperature.max"
              :step="SETTINGS_LIMITS.temperature.step"
              :show-tooltip="false"
              @update:model-value="updateTemperature"
            />
            <div class="readout">
              <span class="readout__value mono">{{ model.temperature.toFixed(1) }}</span>
              <span class="readout__text">{{ temperatureReadout }}</span>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="单次回答长度上限">
          <el-input-number
            :key="`out-${resetToken}`"
            :model-value="model.maxOutputTokens"
            :min="SETTINGS_LIMITS.maxOutputTokens.min"
            :max="SETTINGS_LIMITS.maxOutputTokens.max"
            :step="SETTINGS_LIMITS.maxOutputTokens.step"
            controls-position="right"
            style="width: 100%"
            @update:model-value="onMaxOutputTokens"
          />
          <div class="readout">
            <span class="readout__text">{{ maxOutputReadout }}，超出会被截断</span>
          </div>
        </el-form-item>

        <el-form-item label="等待回复的最长时间（秒）">
          <el-input-number
            :key="`timeout-${resetToken}`"
            :model-value="timeoutSeconds"
            :min="SETTINGS_LIMITS.timeoutMs.min / 1000"
            :max="SETTINGS_LIMITS.timeoutMs.max / 1000"
            :step="1"
            controls-position="right"
            style="width: 100%"
            @update:model-value="onTimeoutSeconds"
          />
          <div class="readout">
            <span class="readout__text">约 {{ timeoutReadout }}，超时会报错</span>
          </div>
        </el-form-item>
      </div>

      <p class="field-hint">
        长视频的总结要等模型逐段回复，网络慢或模型排队久时可以把「等待回复的最长时间」调大；
        「单次回答长度上限」只影响一段摘要写多长，调小容易把结论写半截。
      </p>
    </div>

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
    <p class="field-hint">
      扩展默认不持有任何模型域名权限，首次调用前需要在此授权。更换 Base URL 后需重新授权。
    </p>

    <div class="test-row">
      <el-button type="primary" :loading="testing" @click="testConnection">测试连接</el-button>
      <span class="field-hint" style="margin: 0">
        向模型发一条最小请求验证地址、密钥与模型名，使用<strong>已保存</strong>的设置。
      </span>
    </div>

    <el-alert
      v-if="testResult"
      class="test-result"
      :type="testResult.ok ? 'success' : 'error'"
      :closable="false"
      show-icon
      :title="testResult.ok ? '连接成功' : '连接失败'"
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
