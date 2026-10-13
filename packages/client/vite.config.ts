/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      // 生产由 nginx 转发,dev 照样转一下方便自查
      '^/(robots\\.txt|sitemap\\.xml)$': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => `/api/seo${path}`,
      },
    },
  },
  test: { environment: 'happy-dom', setupFiles: ['./src/test/setup.ts'] },
})
