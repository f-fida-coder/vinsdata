import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        // path includes the query string; appending '.php' to it would break
        // GETs like /api/upload?artifact_id=1 (→ /upload?artifact_id=1.php).
        rewrite: (path) => {
          const q = path.indexOf('?');
          const base  = q >= 0 ? path.slice(0, q) : path;
          const query = q >= 0 ? path.slice(q)    : '';
          return base.replace(/^\/api/, '') + '.php' + query;
        },
      },
    },
  },
})
