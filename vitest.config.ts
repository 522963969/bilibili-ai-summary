import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/**
 * 单元测试配置独立于扩展构建：不加载 CRXJS，避免 manifest 处理干扰测试环境。
 * 被测对象以纯逻辑模块为主（解析、规范化、路由、格式化），不依赖浏览器 API。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    restoreMocks: true,
    reporters: ['default']
  }
});
