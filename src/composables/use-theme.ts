import { onScopeDispose, watch, type Ref } from 'vue';
import type { ThemeMode } from '@/core/settings/types';

const DARK_CLASS = 'dark';

function resolveIsDark(mode: ThemeMode, prefersDark: boolean): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return prefersDark;
}

/**
 * 主题应用：auto 跟随系统，light/dark 强制。
 * 同时把 Element Plus 的 dark 类挂在 html 上，使其 CSS 变量生效。
 */
export function useTheme(mode: Ref<ThemeMode | undefined>): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = (): void => {
    const isDark = resolveIsDark(mode.value ?? 'auto', media.matches);
    document.documentElement.classList.toggle(DARK_CLASS, isDark);
  };

  const onMediaChange = (): void => {
    if ((mode.value ?? 'auto') === 'auto') apply();
  };

  media.addEventListener('change', onMediaChange);
  watch(mode, apply, { immediate: true });

  onScopeDispose(() => {
    media.removeEventListener('change', onMediaChange);
  });
}
