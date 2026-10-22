import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 /api/* 요청을 FastAPI(127.0.0.1:8000)로 넘겨 CORS 설정 없이 동작하게 합니다.
// 백엔드 주소가 다르면: VITE_BACKEND_URL=http://host:port npm run dev
const backend = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
