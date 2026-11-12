import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 5181,
    // tauri.conf.json aponta para esta porta exata.
    strictPort: true,
    watch: { ignored: ['**/target/**', '**/src-tauri/**', '**/dist/**', '**/.git/**'] },
  },
  build: {
    target: 'chrome105',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode !== 'production',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
