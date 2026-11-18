// 端到端走一遍路由:研报从库里和原文文件读,APP_URL 决定绝对地址。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify from 'fastify'

// 这些都在各模块顶层求值一次,必须先于 import 设好。
process.env.RAW_DIR = mkdtempSync(join(tmpdir(), 'seo-route-'))
process.env.DB_PATH = ':memory:'
process.env.APP_URL = 'https://example.test/'

const { initDb } = await import('../services/db.ts')
const { initDocumentTable, saveDocument, saveRawMarkdown } = await import('../services/documentStore.ts')
const { insertVersion } = await import('../services/versionStore.ts')
const { seoRoutes } = await import('./seo.ts')

const db = initDb()
initDocumentTable(db)
const doc = saveDocument({ filename: '碳酸锂 <深度>', size_bytes: 10, chunk_count: 1 })
saveRawMarkdown(doc.id, '# 碳酸锂\n\n> 免责声明\n\n锂价完成了第二次探底。')

const app = fastify()
await app.register(seoRoutes, { prefix: '/api' })
await app.ready()

test('head:研报页出标题、正文摘要和 canonical', async () => {
  const res = await app.inject({ url: `/api/seo/head/reports/${doc.id}?version=1` })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'] as string, /^text\/html/)
  assert.ok(res.body.includes('<title>碳酸锂 &lt;深度&gt; — 研报站</title>'))
  assert.ok(res.body.includes('<meta name="description" content="锂价完成了第二次探底。" />'))
  assert.ok(res.body.includes(`<link rel="canonical" href="https://example.test/reports/${doc.id}" />`))
  assert.ok(res.body.includes('og:type" content="article"'))
})

test('head:首页(路径为空)出站点描述', async () => {
  const res = await app.inject({ url: '/api/seo/head/' })
  assert.ok(res.body.includes('<title>研报站</title>'))
  assert.ok(res.body.includes('<link rel="canonical" href="https://example.test/" />'))
})

test('head:不存在的研报和后台页都 noindex', async () => {
  for (const url of ['/api/seo/head/reports/doc_missing', '/api/seo/head/admin', `/api/seo/head/reports/${doc.id}/diff`]) {
    const res = await app.inject({ url })
    assert.ok(res.body.includes('content="noindex"'), url)
  }
})

test('robots.txt 与 sitemap.xml', async () => {
  const robots = await app.inject({ url: '/api/seo/robots.txt' })
  assert.match(robots.headers['content-type'] as string, /^text\/plain/)
  assert.ok(robots.body.includes('Sitemap: https://example.test/sitemap.xml'))

  const sitemap = await app.inject({ url: '/api/seo/sitemap.xml' })
  assert.match(sitemap.headers['content-type'] as string, /^application\/xml/)
  assert.ok(sitemap.body.includes(`<loc>https://example.test/reports/${doc.id}</loc>`))
  assert.ok(sitemap.body.includes('<loc>https://example.test/whales</loc>'))
  assert.ok(sitemap.body.includes('<loc>https://example.test/whales/hhlr</loc>'))
})

test('head:名家持仓可收录，未知 slug 不收录', async () => {
  const list = await app.inject({ url: '/api/seo/head/whales' })
  assert.ok(list.body.includes('<title>名家持仓 — 研报站</title>'))
  assert.ok(list.body.includes('多家机构向美国 SEC 申报的 13F 持仓'))
  assert.equal(list.body.includes('巴菲特、李录'), false)
  assert.ok(!list.body.includes('noindex'))
  const detail = await app.inject({ url: '/api/seo/head/whales/berkshire' })
  assert.ok(detail.body.includes('<title>巴菲特持仓 — 研报站</title>'))
  const missing = await app.inject({ url: '/api/seo/head/whales/nope' })
  assert.ok(missing.body.includes('noindex'))
})

test('WHALES=off 时名家持仓 noindex 且不进 sitemap', async () => {
  const saved = process.env.WHALES
  process.env.WHALES = 'off'
  try {
    const head = await app.inject({ url: '/api/seo/head/whales' })
    assert.ok(head.body.includes('noindex'))
    const sitemap = await app.inject({ url: '/api/seo/sitemap.xml' })
    assert.equal(sitemap.body.includes('/whales'), false)
  } finally {
    if (saved === undefined) delete process.env.WHALES
    else process.env.WHALES = saved
  }
})

test('head:摘要按 updated_at 缓存,传了新版本才重新读原文', async () => {
  const d = saveDocument({ filename: '缓存', size_bytes: 1, chunk_count: 1 })
  saveRawMarkdown(d.id, '第一版正文。')
  const url = `/api/seo/head/reports/${d.id}`
  assert.ok((await app.inject({ url })).body.includes('第一版正文。'))

  // 原文变了但 updated_at 没变:还是缓存里的
  saveRawMarkdown(d.id, '第二版正文。')
  assert.ok((await app.inject({ url })).body.includes('第一版正文。'))

  // 登记了新版本,updated_at 变了:重新读
  insertVersion(db, { doc_id: d.id, filename: '缓存', size_bytes: 1, chunk_count: 1, created_at: '2099-01-01T00:00:00.000Z' })
  assert.ok((await app.inject({ url })).body.includes('第二版正文。'))
})
