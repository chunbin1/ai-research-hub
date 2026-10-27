// packages/server/src/routes/seo.ts
//
// 三个给搜索引擎的端点,都不鉴权(与公开的 GET /documents 同权限):
//   GET /seo/head/<SPA 路径>  —— 一段 <head> 片段。client 的 nginx 用 SSI 把它拼进
//                               index.html,替换掉写死的 <title>研报站</title>
//   GET /seo/robots.txt       —— nginx 把 /robots.txt 转到这里
//   GET /seo/sitemap.xml      —— nginx 把 /sitemap.xml 转到这里,新上传的研报自动出现
// 后两个放后端而不是 public/ 静态文件,是因为里面要写绝对地址,域名只有 APP_URL 知道。
import type { FastifyPluginAsync } from 'fastify'
import { describeRoute } from '../openapi/doc.js'
import { getAllDocuments, getDocument, readRawMarkdown } from '../services/documentStore.js'
import type { Document } from '../types.js'
import { isWhalesEnabled } from '../services/whales/enabled.js'
import { WHALE_SEEDS } from '../services/whales/seed.js'
import { listInstitutions } from '../services/whales/store.js'
import {
  SITE_NAME, SITE_DESCRIPTION, classifyPath, excerpt, renderHead, robotsTxt, sitemapXml,
  type HeadInput,
} from '../services/seo.js'

function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '')
}

/**
 * 每篇的摘要缓存。每次打开页面都会走一次 head 子请求,不缓存就是每次把整篇
 * markdown 读进来只为截 150 字。按 updated_at 失效:传了新版本它就变,
 * 下一次请求自然重算。条目数等于研报篇数,不用淘汰。
 */
const descriptionCache = new Map<string, { updatedAt: string; text: string }>()

function reportDescription(doc: Document): string {
  const hit = descriptionCache.get(doc.id)
  if (hit?.updatedAt === doc.updated_at) return hit.text
  const text = excerpt(readRawMarkdown(doc.id) ?? '') || SITE_DESCRIPTION
  descriptionCache.set(doc.id, { updatedAt: doc.updated_at, text })
  return text
}

function indexedWhales(): { slug: string; manager: string; nameZh: string }[] {
  try {
    return listInstitutions().map(row => ({ slug: row.slug, manager: row.manager, nameZh: row.nameZh }))
  } catch {
    return WHALE_SEEDS.map(row => ({ slug: row.slug, manager: row.manager, nameZh: row.nameZh }))
  }
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
    case 'whales': {
      if (!isWhalesEnabled()) return { title: SITE_NAME, noindex: true }
      if (page.slug === null) {
        return {
          title: `大佬持仓 — ${SITE_NAME}`,
          description: '多家机构向美国 SEC 申报的 13F 持仓，以及相对上一报告期的增减。',
          url: `${site}/whales`,
        }
      }
      const institution = indexedWhales().find(item => item.slug === page.slug)
      if (!institution) return { title: SITE_NAME, noindex: true }
      return {
        title: `${institution.manager}持仓 — ${SITE_NAME}`,
        description: `${institution.manager}（${institution.nameZh}）向美国 SEC 申报的 13F 持仓，以及相对上一报告期的增减。`,
        url: `${site}/whales/${institution.slug}`,
      }
    }
    case 'report': {
      const doc = getDocument(page.id)
      // 研报不存在时页面照样是 200(SPA),只能靠 noindex 让它别进索引
      if (!doc) return { title: SITE_NAME, noindex: true }
      return {
        // 与 ReaderPage 里 document.title 的写法一致,免得渲染前后标题不同
        title: `${doc.filename} — ${SITE_NAME}`,
        description: reportDescription(doc),
        url: `${site}/reports/${encodeURIComponent(doc.id)}`,
        article: { publishedAt: doc.created_at, modifiedAt: doc.updated_at },
      }
    }
    case 'noindex':
      return { title: SITE_NAME, noindex: true }
  }
}

export const seoRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { '*': string } }>('/seo/head/*', describeRoute(
    ['seo'],
    '页面 head 片段',
    '给 nginx SSI 拼进 index.html 的 HTML 片段，不是给第三方调用的 JSON API。按原始路径返回标题、摘要和 canonical；未知路径（含 /holdings、/api/docs）只出 noindex。',
  ), async (request, reply) => {
    const site = appUrl()
    reply.type('text/html; charset=utf-8')
    return renderHead(headFor(request.params['*'], site), site)
  })

  app.get('/seo/robots.txt', describeRoute(
    ['seo'],
    'robots.txt',
    '纯文本。站点对外的地址由环境变量 APP_URL 生成。nginx 把它挂在 /robots.txt。',
  ), async (_request, reply) => {
    reply.type('text/plain; charset=utf-8')
    return robotsTxt(appUrl())
  })

  app.get('/seo/sitemap.xml', describeRoute(
    ['seo'],
    'sitemap.xml',
    'XML。列出首页、信号页、大佬持仓和每篇研报。实盘持仓和接口文档不进站点地图。WHALES=off 时也不列大佬持仓。nginx 把它挂在 /sitemap.xml。',
  ), async (_request, reply) => {
    reply.type('application/xml; charset=utf-8')
    const whalePaths = isWhalesEnabled()
      ? ['/whales', ...indexedWhales().map(item => `/whales/${item.slug}`)]
      : []
    return sitemapXml(appUrl(), getAllDocuments(), whalePaths)
  })
}
