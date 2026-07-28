import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the built site can be served from any path (GitHub Pages
// project sites, a subdirectory, or a plain file:// open) — same reason the
// console's vite config sets it.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
