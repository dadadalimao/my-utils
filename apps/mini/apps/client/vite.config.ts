import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/**
 * H5：/ai-proxy/* 代理厂商 API，缓解 CORS。
 * 微信小程序上线需配置 request 合法域名：
 * api.deepseek.com / api.moonshot.cn / 自有后端 HTTPS。
 * 开发期可在微信开发者工具关闭域名校验。
 */
export default defineConfig({
  plugins: [uni()],
  css: {
    preprocessorOptions: {
      scss: {
        // 消除 legacy-js-api 弃用警告
        api: 'modern-compiler',
      },
    },
  },
  server: {
    proxy: {
      '/ai-proxy/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-proxy\/deepseek/, ''),
      },
      '/ai-proxy/kimi': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-proxy\/kimi/, ''),
      },
      '/api-proxy': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-proxy/, ''),
      },
    },
  },
})
