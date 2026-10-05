import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// In the browser (without Tauri) the Steam Web API is reached through this
// proxy, because api.steampowered.com sends no CORS headers.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  // The in-game overlay is its own small page, so it doesn't load the whole app.
  build: {
    rollupOptions: {
      input: { main: 'index.html', overlay: 'overlay.html' },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    // The Rust build output changes constantly and is locked while compiling.
    watch: { ignored: ['**/src-tauri/**'] },
    proxy: {
      '/steam-api': {
        target: 'https://api.steampowered.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/steam-api/, ''),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
