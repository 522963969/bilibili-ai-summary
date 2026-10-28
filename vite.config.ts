import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.config';

export default defineConfig({
  plugins: [vue(), crx({ manifest })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      /**
       * 页面内面板是通过 iframe 加载的独立 HTML，manifest 里的
       * web_accessible_resources 只声明可访问性、不产生构建入口，
       * 因此需要在这里显式加入，否则 HTML 里的 main.ts 不会被编译。
       */
      input: {
        panel: fileURLToPath(new URL('./src/panel/index.html', import.meta.url))
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 }
  }
});
