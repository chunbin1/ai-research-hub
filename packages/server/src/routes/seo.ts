// packages/server/src/routes/seo.ts
//
// 三个给搜索引擎的端点,都不鉴权(与公开的 GET /documents 同权限):
//   GET /seo/head/<SPA 路径>  —— 一段 <head> 片段。client 的 nginx 用 SSI 把它拼进
//                               index.html,替换掉写死的 <title>研报站</title>
//   GET /seo/robots.txt       —— nginx 把 /robots.txt 转到这里
//   GET /seo/sitemap.xml      —— nginx 把 /sitemap.xml 转到这里,新上传的研报自动出现
// 后两个放后端而不是 public/ 静态文件,是因为里面要写绝对地址,域名只有 APP_URL 知道。
import type { FastifyPluginAsync } from 'fastify'
import { getAllDocuments, getDocument, readRawMarkdown } from '../services/documentStore.js'
import {
  SITE_NAME, SITE_DESCRIPTION, classifyPath, excerpt, renderHead, robotsTxt, sitemapXml,
  type HeadInput,
} from '../services/seo.js'

function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
}

function headFor(path: string, site: string): HeadInput {
  const page = classifyPath(path)
  switch (page.kind) {
    case 'home':
      return { title: SITE_NAME, description: SITE_DESCRIPTION, url: `${site}/` }
    case 'signals':
      return {
        title: `股票信号 — ${SITE_NAME}`,
        description: '研报覆盖的美股与港股标的,每日收盘后计算日线 / 周线 SuperTrend 信号,看趋势方向、共振与近期翻转。',
        url: `${site}/signals`,
      }
    case 'report': {
      const doc = getDocument(page.id)
      // 研报不存在时页面照样是 200(SPA),只能靠 noindex 让它别进索引
      if (!doc) return { title: SITE_NAME, noindex: true }
      const md = readRawMarkdown(doc.id) ?? ''
      return {
        // 与 ReaderPage 里 document.title 的写法一致,免得渲染前后标题不同
        title: `${doc.filename} — ${SITE_NAME}`,
        description: excerpt(md) || SITE_DESCRIPTION,
        url: `${site}/reports/${encodeURIComponent(doc.id)}`,
        article: { publishedAt: doc.created_at, modifiedAt: doc.updated_at },
      }
    }
    case 'noindex':
      return { title: SITE_NAME, noindex: true }
  }
}

export const seoRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { '*': string } }>('/seo/head/*', async (request, reply) => {
    const site = appUrl()
    reply.type('text/html; charset=utf-8')
    return renderHead(headFor(request.params['*'], site), site)
  })

  app.get('/seo/robots.txt', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8')
    return robotsTxt(appUrl())
  })

  app.get('/seo/sitemap.xml', async (_request, reply) => {
    reply.type('application/xml; charset=utf-8')
    return sitemapXml(appUrl(), getAllDocuments())
  })
}
