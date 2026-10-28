<script setup lang="ts">
/**
 * 画面抽帧设置。
 *
 * 这组参数原本是「采样频率（帧/秒）」「保留帧最小间隔」这类引擎术语。
 * 用户真正关心的是：看得多密、最多看几张、图清不清楚、要等多久。
 * 因此标签改成人话，并把开销换算成可以判断的量（张数 / 秒数）。
 */
import { computed, ref } from 'vue';
import { DEFAULT_SETTINGS, SETTINGS_LIMITS } from '@/core/config/defaults';
import { FRAME_LIMITS } from '@/core/frames/types';
import type { FrameSettings } from '@/core/settings/types';
import SettingsSection from './SettingsSection.vue';

const frames = defineModel<FrameSettings>({ required: true });

const FRAME_DEFAULTS = DEFAULT_SETTINGS.frames;

/** 单次抽帧的候选采样点上限，与 sampler 中的预算公式保持一致。 */
const sampleBudget = computed(() => frames.value.maxFrames * FRAME_LIMITS.samplesPerFrameBudget);
/** 每次 seek 实测约 80ms，用于给用户一个数量级的耗时预期。 */
const estimatedSeconds = computed(() => Math.round((sampleBudget.value * 80) / 1000));

/** 少于 1 帧/秒时换个说法，避免「每秒取 0.5 帧」这种需要脑内换算的表达。 */
const densityReadout = computed(() => {
  const fps = frames.value.sampleFps;
  if (fps >= 1) return `每秒取 ${fps} 帧当候选`;
  const seconds = Math.round(1 / fps);
  return `每 ${seconds} 秒取 1 帧当候选`;
});

const gapReadout = computed(() => `至少隔 ${frames.value.minGapSeconds} 秒留一张`);

const maxFramesReadout = computed(
  () => `最多保留 ${frames.value.maxFrames.toLocaleString('zh-CN')} 张`
);

const widthReadout = computed(() => `宽 ${frames.value.imageWidth} 像素`);

/** 与 ModelSection 一致：重置时自增，用来强制重建 el-input-number。 */
const resetToken = ref(0);

const isDefault = computed(() =>
  (Object.keys(FRAME_DEFAULTS) as (keyof FrameSettings)[]).every(
    (key) => frames.value[key] === FRAME_DEFAULTS[key]
  )
);

function resetFrames(): void {
  Object.assign(frames.value, FRAME_DEFAULTS);
  // 见 ModelSection 的说明：不换 key，输入框会停在用户手输的旧数字上
  resetToken.value += 1;
}

function setNumber(key: keyof FrameSettings, value: number | undefined, integer = true): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  frames.value[key] = integer ? Math.round(value) : Number(value.toFixed(1));
}
</script>

<template>
  <SettingsSection
    title="画面抽帧"
    description="没有字幕时，扩展会截图让模型看画面。下面这些决定截多少张、截得多清楚。"
  >
    <template #extra>
      <el-button link size="small" :disabled="isDefault" @click="resetFrames">
        恢复推荐值
      </el-button>
    </template>

    <div class="field-grid">
      <el-form-item label="抽帧密度（每秒几帧）">
        <el-input-number
          :key="`fps-${resetToken}`"
          :model-value="frames.sampleFps"
          :min="SETTINGS_LIMITS.sampleFps.min"
          :max="SETTINGS_LIMITS.sampleFps.max"
          :step="SETTINGS_LIMITS.sampleFps.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => setNumber('sampleFps', value, false)"
        />
        <div class="readout">
          <span class="readout__text">{{ densityReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="两张图的间隔（秒）">
        <el-input-number
          :key="`gap-${resetToken}`"
          :model-value="frames.minGapSeconds"
          :min="SETTINGS_LIMITS.minGapSeconds.min"
          :max="SETTINGS_LIMITS.minGapSeconds.max"
          :step="SETTINGS_LIMITS.minGapSeconds.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => setNumber('minGapSeconds', value)"
        />
        <div class="readout">
          <span class="readout__text">{{ gapReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="最多看几张图">
        <el-input-number
          :key="`maxFrames-${resetToken}`"
          :model-value="frames.maxFrames"
          :min="SETTINGS_LIMITS.maxFrames.min"
          :max="SETTINGS_LIMITS.maxFrames.max"
          :step="SETTINGS_LIMITS.maxFrames.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => setNumber('maxFrames', value)"
        />
        <div class="readout">
          <span class="readout__text">{{ maxFramesReadout }}</span>
        </div>
      </el-form-item>

      <el-form-item label="图片宽度（像素）">
        <el-input-number
          :key="`width-${resetToken}`"
          :model-value="frames.imageWidth"
          :min="SETTINGS_LIMITS.imageWidth.min"
          :max="SETTINGS_LIMITS.imageWidth.max"
          :step="SETTINGS_LIMITS.imageWidth.step"
          controls-position="right"
          style="width: 100%"
          @update:model-value="(value: number | undefined) => setNumber('imageWidth', value)"
        />
        <div class="readout">
          <span class="readout__text">{{ widthReadout }}</span>
        </div>
      </el-form-item>
    </div>

    <p class="field-hint">
      抽帧密度决定「看得多密」，最多看几张决定「看得多全」。视频太长放不下时，会按上限自动拉大间隔，
      而不是只截前半段；两张图的间隔不能小于采样周期，调太小会被自动抬回。
    </p>
    <p class="field-hint">
      当前配置最多取 <strong>{{ sampleBudget }}</strong> 个候选时间点、保留不超过
      <strong>{{ frames.maxFrames }}</strong> 张，抽帧通常在一分钟内完成（实测每次定位约 80 ms，预计
      {{ estimatedSeconds }} 秒）。
    </p>
  </SettingsSection>
</template>
