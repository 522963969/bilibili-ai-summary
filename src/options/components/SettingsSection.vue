<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <section class="app-card settings-section">
    <header class="settings-section__header">
      <div>
        <h2 class="settings-section__title">{{ title }}</h2>
        <p v-if="description" class="settings-section__desc">{{ description }}</p>
      </div>
      <div v-if="$slots.extra" class="settings-section__extra">
        <slot name="extra" />
      </div>
    </header>
    <slot />
  </section>
</template>
