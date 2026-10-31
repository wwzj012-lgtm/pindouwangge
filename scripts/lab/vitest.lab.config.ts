import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': repoRoot } },
  test: {
    include: [fileURLToPath(new URL('./*.lab.test.ts', import.meta.url))],
    testTimeout: 120000,
  },
});
