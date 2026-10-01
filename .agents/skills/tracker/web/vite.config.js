import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: vite on 5173 proxies API calls to the board.mjs server on 4517.
// Build: relative base so board.mjs can serve dist/ from any path.
export default defineConfig({
  base: './',
  // Ship smaller deterministic files with the prebuilt skill instead of one
  // large vendor/app bundle. This changes packaging only, not runtime features.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/pdfjs-dist/')) return 'pdf';
          if (id.includes('/node_modules/framer-motion/') || id.includes('/node_modules/motion-')) return 'motion';
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) return 'react';
        },
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:4517',
      '/files': 'http://localhost:4517',
    },
  },
});
