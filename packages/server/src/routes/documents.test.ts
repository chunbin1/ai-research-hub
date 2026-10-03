// 上传、上传新版本、按版本读取。向量库不初始化(isDocVectorAvailable 为 false),
// 只走 BM25 那一路 —— 版本相关的行为都在 SQLite 和文件上,不依赖 Chroma。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify from 'fastify'
import multipart from '@fastify/multipart'

// 这些都在各模块顶层求值一次,必须先于 import 设好。
process.env.RAW_DIR = mkdtempSync(join(tmpdir(), 'documents-route-'))
process.env.DB_PATH = ':memory:'
process.env.AUTH_DISABLED = 'true'

const { initDb } = await import('../services/db.ts')
const { initDocumentTable } = await import('../services/documentStore.ts')
const { initChunkFtsTable, searchBm25 } = await import('../services/chunkFts.ts')
const { initIndexStateTable, getIndexState, planRetrieval } = await import('../services/indexState.ts')
const { initWatchlistTable } = await import('../services/watchlistStore.ts')
const { documentRoutes } = await import('./documents.ts')

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)
initIndexStateTable(db)
initWatchlistTable(db)

const app = fastify()
await app.register(multipart)
await app.register(documentRoutes, { prefix: '/api' })
await app.ready()

/** 手拼 multipart。note / kind 必须在 file 前面 —— 服务端只读得到文件之前的字段。 */
function form(filename: string, content: string, note?: string, kind?: string) {
  const boundary = '----arhtest'
  const parts: string[] = []
  if (note !== undefined) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n${note}\r\n`)
  }
  if (kind !== undefined) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`)
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/markdown\r\n\r\n${content}\r\n`,
  )
  parts.push(`--${boundary}--\r\n`)
  return {
    payload: Buffer.from(parts.join(''), 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}

const V1 = '# 腾讯生态\n\n## 2.2 生意特征\n\n游戏毛利率 61%。\n'
const V2 = '# 腾讯生态(Q3 更新)\n\n## 2.2 生意特征\n\n游戏毛利率 65%,广告回暖。\n'

async function upload(md = V1) {
  const res = await app.inject({ method: 'POST', url: '/api/documents', ...form('tx.md', md) })
  assert.equal(res.statusCode, 200)
  return res.json().document as { id: string; latest_version: number }
}

test('上传即为 v1,GET 返回版本列表', async () => {
  const doc = await upload()
  assert.equal(doc.latest_version, 1)
  const res = (await app.inject({ method: 'GET', url: `/api/documents/${doc.id}` })).json()
  assert.equal(res.version, 1)
  assert.equal(res.markdown, V1)
  assert.deepEqual(res.versions.map((v: { version: number }) => v.version), [1])
})

test('上传新版本:带更新说明,默认读到最新版,?version= 读到旧版', async () => {
  const doc = await upload()
  const up = await app.inject({
    method: 'POST', url: `/api/documents/${doc.id}/versions`, ...form('whatever.md', V2, '加入 Q3 数据'),
  })
  assert.equal(up.statusCode, 200)
  assert.equal(up.json().version.version, 2)
  assert.equal(up.json().version.note, '加入 Q3 数据')
  assert.equal(up.json().document.filename, '腾讯生态(Q3 更新)')

  const latest = (await app.inject({ method: 'GET', url: `/api/documents/${doc.id}` })).json()
  assert.equal(latest.version, 2)
  assert.equal(latest.markdown, V2)
  assert.equal(latest.versions.length, 2)

  const old = (await app.inject({ method: 'GET', url: `/api/documents/${doc.id}?version=1` })).json()
  assert.equal(old.version, 1)
  assert.equal(old.markdown, V1)

  // 两个版本的关键词索引各查各的
  const g1 = planRetrieval(getIndexState(db, doc.id, 1)).gen
  const g2 = planRetrieval(getIndexState(db, doc.id, 2)).gen
  assert.match(searchBm25(db, doc.id, '毛利率', 10, g1)[0].content, /61%/)
  assert.match(searchBm25(db, doc.id, '毛利率', 10, g2)[0].content, /65%/)
})

test('内容没变的新版本返回 409', async () => {
  const doc = await upload()
  const res = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/versions`, ...form('tx.md', V1) })
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error, 'same_content')
})

test('不存在的版本号返回 404', async () => {
  const doc = await upload()
  for (const v of ['9', 'abc', '1.5']) {
    const res = await app.inject({ method: 'GET', url: `/api/documents/${doc.id}?version=${v}` })
    assert.equal(res.statusCode, 404, `?version=${v}`)
  }
})

test('给不存在的文档传新版本返回 404', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/documents/doc_nope/versions', ...form('tx.md', V2) })
  assert.equal(res.statusCode, 404)
})

test('删除文档清掉所有版本', async () => {
  const doc = await upload()
  await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/versions`, ...form('tx.md', V2) })
  const del = await app.inject({ method: 'DELETE', url: `/api/documents/${doc.id}` })
  assert.equal(del.statusCode, 200)
  assert.equal((await app.inject({ method: 'GET', url: `/api/documents/${doc.id}` })).statusCode, 404)
  assert.equal(getIndexState(db, doc.id, 1), null)
  assert.equal(getIndexState(db, doc.id, 2), null)
  assert.equal(searchBm25(db, doc.id, '毛利率', 10).length, 0)
  const { n } = db.prepare('SELECT count(*) AS n FROM document_versions WHERE doc_id = ?').get(doc.id) as { n: number }
  assert.equal(n, 0)
})

test('没有版本记录的旧文档(原文缺失、迁移不出来)照旧能打开,不 404', async () => {
  db.prepare('INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?,?,?,?,?)')
    .run('doc_orphan', '原文丢了', 0, 0, new Date().toISOString())
  const res = await app.inject({ method: 'GET', url: '/api/documents/doc_orphan' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().markdown, '')
  assert.equal(res.json().version, 1)
})

test('查重:报出可能是旧版本的那篇,且不落任何东西', async () => {
  const doc = await upload()
  const before = (await app.inject({ method: 'GET', url: '/api/documents' })).json().documents.length

  const res = await app.inject({ method: 'POST', url: '/api/documents/similar', ...form('tx-q3.md', V2) })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.title, '腾讯生态(Q3 更新)')
  const hit = body.candidates.find((c: { document: { id: string } }) => c.document.id === doc.id)
  assert.ok(hit, '应当报出刚上传的那篇')
  assert.equal(hit.titleScore, 1)
  assert.equal(hit.likely, true)
  // 测试里没有 embedding key,主题相近度不算,查重照样成功;这时只列很可能是旧版本的
  assert.equal(hit.topicScore, null)
  assert.ok(body.candidates.every((c: { likely: boolean }) => c.likely))
  assert.equal(hit.document.latest_version, 1)

  const after = (await app.inject({ method: 'GET', url: '/api/documents' })).json().documents.length
  assert.equal(after, before)
})

test('查重:格式不对照样 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/documents/similar', ...form('a.pdf', '%PDF') })
  assert.equal(res.statusCode, 400)
})

// ── 研报类型(行业 / 公司)────────────────────────────────────────────────

const CNOOC_INDUSTRY = '# 中国海洋石油（CNOOC）产业链投资研究报告\n\n## 2.2 生意特征\n\n上游毛利率 30-50%。\n'
const CNOOC_COMPANY = '# 中国海洋石油（0883.HK / 600938.SH）投资研究报告\n\n## 1 生意本质\n\n桶油成本 $27.9。\n'

async function uploadKind(md: string, kind?: string) {
  const res = await app.inject({ method: 'POST', url: '/api/documents', ...form('x.md', md, undefined, kind) })
  assert.equal(res.statusCode, 200, res.body)
  return res.json().document as { id: string; kind: string }
}

test('上传:管理员选的类型为准,覆盖按标题的推断', async () => {
  assert.equal((await uploadKind(CNOOC_COMPANY, 'industry')).kind, 'industry')
  assert.equal((await uploadKind(CNOOC_INDUSTRY, 'company')).kind, 'company')
})

test('上传:不带类型时按标题推断,推不出来按行业研报', async () => {
  assert.equal((await uploadKind(CNOOC_COMPANY)).kind, 'company')
  assert.equal((await uploadKind(CNOOC_INDUSTRY)).kind, 'industry')
  assert.equal((await uploadKind('# 投研方法论\n\n正文。\n')).kind, 'industry')
  // 「年份 + HK」不是港股代码
  assert.equal((await uploadKind('# 2026 HK 科技股中期策略\n\n正文。\n')).kind, 'industry')
  assert.equal((await uploadKind('# 港股 2026 hk 展望\n\n正文。\n')).kind, 'industry')
})

test('上传:非法类型 400,什么都不落', async () => {
  const before = (await app.inject({ method: 'GET', url: '/api/documents' })).json().documents.length
  const res = await app.inject({ method: 'POST', url: '/api/documents', ...form('x.md', CNOOC_COMPANY, undefined, 'other') })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'invalid_kind')
  assert.equal((await app.inject({ method: 'GET', url: '/api/documents' })).json().documents.length, before)
})

test('列表带出 kind;上传新版本继承原文档的类型', async () => {
  const doc = await uploadKind(CNOOC_COMPANY)
  const v2 = CNOOC_COMPANY.replace('27.9', '28.5')
  const res = await app.inject({ method: 'POST', url: `/api/documents/${doc.id}/versions`, ...form('x.md', v2, undefined, 'industry') })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().document.kind, 'company', '新版本不改类型,即使带了 kind')
  const row = (await app.inject({ method: 'GET', url: '/api/documents' })).json().documents
    .find((d: { id: string }) => d.id === doc.id)
  assert.equal(row.kind, 'company')
})

test('查重:公司研报不把同一家公司的产业链报告当旧版本,但建议类型随响应返回', async () => {
  // 用库里别的测试没碰过的公司,免得它们留下的同名研报挤掉候选的 3 个名额
  const industryMd = '# 宁德时代产业链投资研究报告\n\n## 1 电池\n\n动力电池装机量。\n'
  const companyMd = '# 宁德时代（300750.SZ）投资研究报告\n\n## 1 生意本质\n\n储能毛利率。\n'
  const industry = await uploadKind(industryMd, 'industry')

  const res = await app.inject({ method: 'POST', url: '/api/documents/similar', ...form('co.md', companyMd) })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().suggestedKind, 'company')
  const ids = (b: { candidates: { document: { id: string } }[] }) => b.candidates.map(c => c.document.id)
  assert.ok(!ids(res.json()).includes(industry.id), '推断为公司研报 → 不和产业链报告比')

  // 管理员在弹窗里把它改选成行业研报,再查就能看到那篇
  const asIndustry = await app.inject({ method: 'POST', url: '/api/documents/similar', ...form('co.md', companyMd, undefined, 'industry') })
  assert.ok(ids(asIndustry.json()).includes(industry.id))
})

test('查重:类型推不出来时不过滤', async () => {
  const doc = await upload()
  const res = await app.inject({ method: 'POST', url: '/api/documents/similar', ...form('tx-q3.md', V2) })
  assert.equal(res.json().suggestedKind, null)
  assert.ok(res.json().candidates.some((c: { document: { id: string } }) => c.document.id === doc.id))
})

test('PATCH 改类型;不存在 404,非法值 400', async () => {
  const doc = await uploadKind(CNOOC_INDUSTRY, 'industry')
  const ok = await app.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, payload: { kind: 'company' } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json().document.kind, 'company')

  const bad = await app.inject({ method: 'PATCH', url: `/api/documents/${doc.id}`, payload: { kind: 'x' } })
  assert.equal(bad.statusCode, 400)
  const missing = await app.inject({ method: 'PATCH', url: '/api/documents/doc_nope', payload: { kind: 'company' } })
  assert.equal(missing.statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/api/documents/${doc.id}` })).json().document.kind, 'company')
})
