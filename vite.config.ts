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
    },
    test: {
      include: ['src/**/*.test.ts'],
      // backend-review is a temporary Worker checkout, not part of this Vite project.
      exclude: ['**/node_modules/**', '**/dist/**', '**/backend-review/**'],
    },
  };
});
