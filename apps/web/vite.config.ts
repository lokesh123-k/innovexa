import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  // Vercel builds: VITE_* values are baked in at build time. Without VITE_API_URL the app would
  // call /api/v1 on its own static domain, which answers every POST with HTTP 405.
  if (process.env.VERCEL && mode === 'production') {
    if (!env.VITE_API_URL) {
      throw new Error(
        'VITE_API_URL is not set for this Vercel build. Set it to the API base URL ' +
          '(e.g. https://<api-domain>/api/v1) in the project environment variables and redeploy.',
      );
    }
    // A Vercel-hosted API has no Socket.IO server; opt back in with VITE_REALTIME=true.
    process.env.VITE_REALTIME ??= 'false';
  }
  // Same-origin proxy in dev/preview so auth cookies stay first-party.
  const target = env.API_PROXY_TARGET || 'http://localhost:4000';
  const proxy = {
    '/api': { target, changeOrigin: true },
    // Realtime messages/notifications (WebSocket upgrade).
    '/socket.io': { target, changeOrigin: true, ws: true },
  };
  return {
    envDir,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
  };
});
