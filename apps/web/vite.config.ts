import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, envDir, '');
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
