import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.BACKEND_PORT || '8001';
const backendTarget = process.env.VITE_API_TARGET || `http://localhost:${backendPort}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': {
        target: backendTarget,
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
