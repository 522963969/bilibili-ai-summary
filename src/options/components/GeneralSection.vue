<script setup lang="ts">
import type { GeneralSettings } from '@/core/settings/types';
import SettingsSection from './SettingsSection.vue';

const general = defineModel<GeneralSettings>({ required: true });

function updateTheme(value: string | number | boolean | undefined): void {
  if (value === 'auto' || value === 'light' || value === 'dark') {
    general.value.theme = value;
  }
}
</script>

<template>
  <SettingsSection title="界面" description="主题偏好会应用到 Popup 与本设置页，并随设置一起保存。">
    <el-form-item label="主题">
      <el-radio-group :model-value="general.theme" @update:model-value="updateTheme">
        <el-radio-button value="auto">跟随系统</el-radio-button>
        <el-radio-button value="light">浅色</el-radio-button>
        <el-radio-button value="dark">深色</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <p class="field-hint">选择后立即预览，保存后写入本地存储。</p>
  </SettingsSection>
</template>
