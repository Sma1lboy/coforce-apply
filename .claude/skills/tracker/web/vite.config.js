import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: vite on 5173 proxies API calls to the board.mjs server on 4517.
// Build: relative base so board.mjs can serve dist/ from any path.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:4517',
      '/files': 'http://localhost:4517',
    },
  },
});
