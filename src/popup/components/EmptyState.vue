<script setup lang="ts">
import { Monitor } from '@element-plus/icons-vue';

defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <section class="app-card empty">
    <div class="empty__icon">
      <el-icon :size="22"><Monitor /></el-icon>
    </div>
    <h2 class="empty__title">{{ title }}</h2>
    <p class="empty__desc">{{ description }}</p>
    <div class="empty__actions">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--app-accent-strong);
  background: var(--app-accent-soft);
  margin-bottom: 2px;
}

.empty__title {
  font-size: 13px;
  font-weight: 600;
}

.empty__desc {
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--app-text-secondary);
}

.empty__actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
</style>
