<script setup lang="ts">
import { CAPABILITIES } from '@/core/config/roadmap';

const items = CAPABILITIES;
</script>

<template>
  <section class="app-card">
    <div class="app-card__header">
      <span class="app-card__title">功能状态</span>
      <span class="muted" style="font-size: 11px">当前版本</span>
    </div>

    <ul class="roadmap">
      <li v-for="item in items" :key="item.id" class="roadmap__item">
        <span class="tag-dot" :class="item.ready ? 'tag-dot--ok' : 'tag-dot--idle'" />
        <span class="roadmap__label">{{ item.label }}</span>
        <el-tag disable-transitions
          size="small"
          effect="plain"
          :type="item.ready ? 'success' : 'info'"
          class="roadmap__tag"
        >
          {{ item.ready ? '已支持' : '暂未支持' }}
        </el-tag>
      </li>
    </ul>

    <p class="roadmap__note">标为「暂未支持」的功能不会出现在可点击操作里，避免点了没反应。</p>
  </section>
</template>

<style scoped>
.roadmap {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.roadmap__item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--app-text-secondary);
}

.roadmap__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roadmap__tag {
  flex: none;
  transform: scale(0.92);
  transform-origin: right center;
}

.roadmap__note {
  margin-top: 9px;
  font-size: 11px;
  color: var(--app-text-muted);
  line-height: 1.6;
}
</style>
