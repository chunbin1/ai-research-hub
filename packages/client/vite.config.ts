/// <reference types="vitest/config" />
import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * SPA fallback 会把不存在的路径回成 index.html。
 * Lighthouse 的 agentic 审计会请求这份清单,拿到 HTML 就算失败。
 * 站点没有 ARD catalog,明确 404。
 */
function aiCatalogNotFound(): Plugin {
  const deny: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split('?')[0] ?? ''
    if (path === '/ai-catalog.json' || path === '/.well-known/ai-catalog.json') {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end('{"error":"not_found"}')
      return
    }
    next()
  }
  return {
    name: 'ai-catalog-404',
    configureServer(server) { server.middlewares.use(deny) },
    configurePreviewServer(server) { server.middlewares.use(deny) },
  }
}

/**
 * 把入口 CSS 内联进 index.html。
 * 单独的 stylesheet 在慢速网络上仍是渲染阻塞(移动端大约再等 300ms),
 * 而首页 CSS 压缩后只有大约 8KB,跟着本来就不能缓存的 HTML 走更划算。
 * antd 的运行时样式不在这份文件里。
 */
function inlineEntryCss(): Plugin {
  return {
    name: 'inline-entry-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const html of Object.values(bundle)) {
        if (html.type !== 'asset' || !html.fileName.endsWith('.html')) continue
        let source = String(html.source)
        source = source.replace(
          /<link rel="stylesheet" crossorigin href="(\/assets\/[^"]+\.css)">/g,
          (tag, href: string) => {
            const asset = bundle[href.slice(1)]
            if (!asset || asset.type !== 'asset') return tag
            const css = String(asset.source).replace(/<\/style/gi, '<\\/style')
            delete bundle[href.slice(1)]
            return `<style>${css}</style>`
          },
        )
        html.source = source
      }
    },
  }
}

function manualChunks(id: string): string | undefined {
  const p = id.replace(/\\/g, '/')
  if (!p.includes('/node_modules/')) return
  // react-markdown 的路径里带 react,必须先于 react 包名判断
  if (/\/node_modules\/(react-markdown|remark-|rehype-|micromark|mdast|hast-|unist-|unified|vfile|property-information|decode-named-character-reference|character-entities|github-slugger|mdast-util-|hast-util-|unist-util-|micromark-)/.test(p)) {
    return 'markdown'
  }
  if (p.includes('/node_modules/diff/')) return 'diff'
  if (/\/node_modules\/(react|react-dom|scheduler|react-is)\//.test(p)) return 'react'
  if (p.includes('/node_modules/react-router') || p.includes('/node_modules/@remix-run/router/')) return 'router'
  // antd 不在这里合并成一个包:首页根本不引用它,Rollup 会按路由把它拆开。
  // 合成一个 chunk 的话,打开阅读页也要把 Table / Select 整份下下来。
}

export default defineConfig({
  plugins: [react(), tailwindcss(), aiCatalogNotFound(), inlineEntryCss()],
  build: {
    // Lighthouse best-practices「Missing source maps」。
    // 映射文件带内容 hash,走 /assets/ 的长期缓存;浏览器不打开开发者工具时不会请求。
    sourcemap: true,
    target: 'es2022',
    rollupOptions: { output: { manualChunks } },
  },
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
