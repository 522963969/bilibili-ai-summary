<script setup lang="ts">
/**
 * 品牌标识：与扩展图标同一图形（播放三角 + 字幕线，透明底）。
 * 路径直接取自 design/icons/icon-a-coral.svg，改图形时这里同步改。
 *
 * 颜色不写死：统一取全局强调色 --app-accent（B 站粉），
 * 与页面内入口按钮、面板强调色保持同一来源。
 * 扩展图标（public/icons/*.png）仍是设计稿的朱红，属有意区分，不随此处变化。
 */
withDefaults(defineProps<{ size?: number }>(), { size: 30 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    role="img"
    aria-label="B站 AI 总结"
    class="brand-mark"
    fill="currentColor"
  >
    <path d="M106 178 L198 256 L106 334 Z" stroke="currentColor" stroke-width="28" stroke-linejoin="round" />
    <rect x="244" y="164" width="176" height="44" rx="22" />
    <rect x="244" y="234" width="128" height="44" rx="22" />
    <rect x="244" y="304" width="88" height="44" rx="22" />
  </svg>
</template>

<style scoped>
.brand-mark {
  display: block;
  flex: none;
  /* 唯一色源：全局强调色变量，浅色/深色主题各自覆盖 */
  color: var(--app-accent);
}
</style>
