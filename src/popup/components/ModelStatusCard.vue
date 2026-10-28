<script setup lang="ts">
import { computed } from 'vue';
import { Cpu, Setting } from '@element-plus/icons-vue';
import { extractHostName, maskSecret } from '@/core/utils/format';
import type { ExtensionSettings } from '@/core/settings/types';

const props = defineProps<{
  settings: ExtensionSettings | null;
  configured: boolean;
}>();

const emit = defineEmits<{ openSettings: [] }>();

const modelName = computed(() => props.settings?.model.model ?? '');
const host = computed(() => {
  const baseUrl = props.settings?.model.baseUrl ?? '';
  return baseUrl ? extractHostName(baseUrl) : '';
});
const maskedKey = computed(() => maskSecret(props.settings?.model.apiKey ?? ''));
</script>

<template>
  <section class="app-card">
    <div class="app-card__header">
      <span class="app-card__title">
        <el-icon><Cpu /></el-icon>
        模型服务
      </span>
      <el-tag disable-transitions size="small" :type="configured ? 'success' : 'warning'" effect="light" round>
        {{ configured ? '已配置' : '待配置' }}
      </el-tag>
    </div>

    <template v-if="configured">
      <div class="model-row">
        <span class="model-row__label">模型</span>
        <span class="model-row__value mono">{{ modelName }}</span>
      </div>
      <div class="model-row">
        <span class="model-row__label">服务地址</span>
        <span class="model-row__value mono" :title="settings?.model.baseUrl">{{ host }}</span>
      </div>
      <div class="model-row">
        <span class="model-row__label">API Key</span>
        <span class="model-row__value mono">{{ maskedKey }}</span>
      </div>
      <p class="model-note">配置保存在扩展本地存储，不随账号同步，也不会写入页面。</p>
    </template>

    <template v-else>
      <p class="model-empty">
        需要填写 Base URL、API Key 与模型名称后才能调用模型。密钥仅保存在浏览器本地存储中，不等同于系统级密钥库。
      </p>
      <el-button size="small" type="primary" plain :icon="Setting" @click="emit('openSettings')">
        去配置模型
      </el-button>
    </template>
  </section>
</template>

<style scoped>
.model-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  line-height: 22px;
}

.model-row__label {
  width: 56px;
  flex: none;
  color: var(--app-text-muted);
}

.model-row__value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-text);
}

.model-note,
.model-empty {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--app-text-muted);
}

.model-empty {
  margin: 0 0 10px;
}
</style>
