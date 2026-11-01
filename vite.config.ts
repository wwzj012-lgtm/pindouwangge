import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

const rootDirectory = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  return {
    define: {
      'import.meta.env.VITE_DEV_ALGORITHM_TEST': JSON.stringify(
        process.env.VITE_DEV_ALGORITHM_TEST ?? 'false'
      ),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDirectory,
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api': {
          // Use the production Pages API gateway for local UI work.
          // The pinned preview host (ff02bb0e...) no longer serves Functions - it
          // returns index.html, which the admin console reads as "无效响应".
          // Set VITE_DEV_API_PROXY_TARGET=http://127.0.0.1:8787 when running the Worker locally.
          target: process.env.VITE_DEV_API_PROXY_TARGET ?? 'https://stellabean.pages.dev',
          changeOrigin: true,
          secure: true,
        },
      },
    },
    test: {
      include: ['src/**/*.test.ts', 'functions/api/**/*.test.ts'],
      // backend-review is a temporary Worker checkout, not part of this Vite project.
      exclude: ['**/node_modules/**', '**/dist/**', '**/backend-review/**'],
    },
  };
});
