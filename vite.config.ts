import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 打包时把角色写死进代码：APP_ROLE=frame 打相框包，APP_ROLE=family 打子女端包。
  // 不依赖运行时读文件——那套在 Capacitor 的 WebView 里不一定能拿到。
  define: {
    __APP_ROLE__: JSON.stringify(process.env.APP_ROLE || ''),
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
