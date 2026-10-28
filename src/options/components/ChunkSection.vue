<script setup lang="ts">
/**
 * 长视频分块设置。
 *
 * 这一组参数原本直接用引擎里的字段名（目标块大小 / token / 并发数），
 * 但用户要回答的问题其实只有三个：切多大、同时问几段、失败了怎么办。
 * 因此标签改成人话，数字下面补一句读数把量纲翻译出来。
 */
import { computed, ref } from 'vue';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@/core/config/defaults';
import type { ChunkSettings } from '@/core/settings/types';
import SettingsSection from './SettingsSection.vue';

const chunk = defineModel<ChunkSettings>({ required: true });

const CHUNK_DEFAULTS = DEFAULT_SETTINGS.chunk;

/**
 * 口播语速按 250 字/分钟粗估。
 * 本项目按「1 个汉字约 1 token」折算，所以 token 数可以直接当字数读——
 * 用户不知道 token 是什么也没关系，他要判断的是「一段大概多长」。
 */
const CHARS_PER_MINUTE = 250;

const targetReadout = computed(() => {
  const chars = chunk.value.targetTokens;
  const minutes = Math.max(1, Math.round(chars / CHARS_PER_MINUTE));
  return `约 ${chars.toLocaleString('zh-CN')} 字 · 约 ${minutes} 分钟口播`;
});

const maxReadout = computed(() => `再长也不超过 ${chunk.value.maxTokens.toLocaleString('zh-CN')} 字`);

const overlapReadout = computed(() =>
  chunk.value.overlapSeconds === 0
    ? '相邻两段不重叠，衔接处可能漏掉半句话'
    : `相邻两段重复 ${chunk.value.overlapSeconds} 秒`
);

const concurrencyReadout = computed(() => `同时向模型发 ${chunk.value.concurrency} 个请求`);

const retriesReadout = computed(() =>
  chunk.value.maxRetries === 0 ? '失败就直接停下' : `失败最多重试 ${chunk.value.maxRetries} 次`
);

/** 与 ModelSection 一致：重置时自增，用来强制重建 el-input-number。 */
const resetToken = ref(0);

const isDefault = computed(() =>
  (Object.keys(CHUNK_DEFAULTS) as (keyof ChunkSettings)[]).every(
    (key) => chunk.value[key] === CHUNK_DEFAULTS[key]
  )
);

function resetChunk(): void {
  Object.assign(chunk.value, CHUNK_DEFAULTS);
  /**
   * el-input-number 会把用户手输的内容留在内部 userInput 里直到失焦，
   * 程序化改 modelValue 时它不刷新显示——必须换 key 重建，
   * 否则会出现「显示旧数字、存的是新数字」。
   */
  resetToken.value += 1;
}

function onTargetTokens(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    chunk.value.targetTokens = Math.round(value);
  }
}

function onMaxTokens(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    chunk.value.maxTokens = Math.round(value);
  }
}

function onOverlapSeconds(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    chunk.value.overlapSeconds = Math.round(value);
  }
}

function onConcurrency(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    chunk.value.concurrency = Math.round(value);
  }
}

function onMaxRetries(value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    chunk.value.maxRetries = Math.round(value);
  }
}
</script>

<template>
  <SettingsSection
    title="长视频分块"
    description="视频太长、一次放不下时，会按句子和时间点切成几段分别总结，再合并成一份。下面这些决定切多大、同时问几段。"
  >
    <template #extra>
      <el-button link size="small" :disabled="isDefault" @click="resetChunk">
        恢复推荐值
      </el-button>
    </template>

    <div class="field-grid field-grid--three">
      <el-form-item label="每段内容量">
        <el-input-number
          :key="`target-${resetToken}`"
          :model-value="chunk.targetTokens"
          :min="SETTINGS_LIMITS.targetTokens.min"
          :max="SETTINGS_LIMITS.targetTokens.max"
          :step="SETTINGS_LIMITS.targetTokens.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="onTargetTokens"
        />
        <div class="readout">
          <span class="readout__text">{{ targetReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="单段上限">
        <el-input-number
          :key="`max-${resetToken}`"
          :model-value="chunk.maxTokens"
          :min="SETTINGS_LIMITS.maxTokens.min"
          :max="SETTINGS_LIMITS.maxTokens.max"
          :step="SETTINGS_LIMITS.maxTokens.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="onMaxTokens"
        />
        <div class="readout">
          <span class="readout__text">{{ maxReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="相邻段重复（秒）">
        <el-input-number
          :key="`overlap-${resetToken}`"
          :model-value="chunk.overlapSeconds"
          :min="SETTINGS_LIMITS.overlapSeconds.min"
          :max="SETTINGS_LIMITS.overlapSeconds.max"
          :step="SETTINGS_LIMITS.overlapSeconds.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="onOverlapSeconds"
        />
        <div class="readout">
          <span class="readout__text">{{ overlapReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="同时处理几段">
        <el-input-number
          :key="`concurrency-${resetToken}`"
          :model-value="chunk.concurrency"
          :min="SETTINGS_LIMITS.concurrency.min"
          :max="SETTINGS_LIMITS.concurrency.max"
          :step="SETTINGS_LIMITS.concurrency.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="onConcurrency"
        />
        <div class="readout">
          <span class="readout__text">{{ concurrencyReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="失败重试次数">
        <el-input-number
          :key="`retries-${resetToken}`"
          :model-value="chunk.maxRetries"
          :min="SETTINGS_LIMITS.maxRetries.min"
          :max="SETTINGS_LIMITS.maxRetries.max"
          :step="SETTINGS_LIMITS.maxRetries.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="onMaxRetries"
        />
        <div class="readout">
          <span class="readout__text">{{ retriesReadout }}</span>
        </div>
      </el-form-item>
    </div>

    <p class="field-hint">
      字数按「1 个汉字约 1 token」估算，实际以句子和时间点为界，段数由视频长度决定。每段内容量不能超过单段上限；
      相邻段重复 20–40 秒比较稳妥。重试仍失败的段会保留进度，重新生成时不必从头等。
    </p>
  </SettingsSection>
</template>
