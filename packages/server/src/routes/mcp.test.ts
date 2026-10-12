// MCP 入口走真实的 JSON-RPC 往返:initialize → tools/list → tools/call。
// 研报经上传接口落库,版本和原文都在 SQLite + 临时目录里,不依赖 Chroma。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify from 'fastify'
import multipart from '@fastify/multipart'

process.env.RAW_DIR = mkdtempSync(join(tmpdir(), 'mcp-route-'))
process.env.DB_PATH = ':memory:'
process.env.AUTH_DISABLED = 'true'
process.env.APP_URL = 'https://arh.example'
delete process.env.SIGNALS

const { initDb } = await import('../services/db.ts')
const { initDocumentTable } = await import('../services/documentStore.ts')
const { initChunkFtsTable } = await import('../services/chunkFts.ts')
const { initIndexStateTable } = await import('../services/indexState.ts')
const { initWatchlistTable } = await import('../services/watchlistStore.ts')
const { initSignalTables } = await import('../services/signalStore.ts')
const { documentRoutes } = await import('./documents.ts')
const { mcpRoutes } = await import('./mcp.ts')
const { PAGE_CHARS } = await import('../services/mcpServer.ts')

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)
initIndexStateTable(db)
initWatchlistTable(db)
initSignalTables(db)

const app = fastify()
await app.register(multipart)
await app.register(documentRoutes, { prefix: '/api' })
await app.register(mcpRoutes, { prefix: '/api' })
await app.ready()

function form(filename: string, content: string) {
  const boundary = '----arhtest'
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/markdown\r\n\r\n${content}\r\n--${boundary}--\r\n`, 'utf8')
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

async function upload(md: string, url = '/api/documents'): Promise<string> {
  const res = await app.inject({ method: 'POST', url, ...form('r.md', md) })
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json()
  return body.document?.id ?? body.id
}

let rpcId = 0
async function rpc(method: string, params: unknown = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const { result } = await rpc('tools/call', { name, arguments: args })
  return { text: result.content[0].text as string, isError: result.isError === true }
}

const V1 = '# 锂电产业链\n\n导言。\n\n## 1 供给\n\n盐湖扩产。\n\n### 1.1 澳洲矿\n\n品位下滑。\n\n## 2 需求\n\n储能 45GWh。\n'
const V2 = V1.replace('储能 45GWh', '储能 60GWh')
const docId = await upload(V1)
await upload(V2, `/api/documents/${docId}/versions`)

test('initialize 握手成功,无状态模式不发会话 id', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    payload: {
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } },
    },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().result.serverInfo.name, 'ai-research-hub')
  assert.equal(res.headers['mcp-session-id'], undefined)
})

test('tools/list 列出四个只读工具', async () => {
  const { result } = await rpc('tools/list')
  const names = result.tools.map((t: { name: string }) => t.name).sort()
  assert.deepEqual(names, ['get_report_outline', 'get_signals', 'list_reports', 'read_report'])
  assert.ok(result.tools.every((t: { annotations?: { readOnlyHint?: boolean } }) => t.annotations?.readOnlyHint))
})

test('list_reports 带最新版本号和阅读页链接', async () => {
  const list = JSON.parse((await call('list_reports')).text)
  const r = list.find((x: { id: string }) => x.id === docId)
  assert.equal(r.latestVersion, 2)
  assert.equal(r.url, `https://arh.example/reports/${docId}`)
})

test('get_report_outline 给出层级、slug、版本历史', async () => {
  const o = JSON.parse((await call('get_report_outline', { id: docId })).text)
  assert.equal(o.version, 2)
  assert.deepEqual(o.versions.map((v: { version: number }) => v.version), [1, 2])
  assert.deepEqual(o.outline.map((x: { slug: string }) => x.slug), ['锂电产业链', '1-供给', '11-澳洲矿', '2-需求'])
})

test('read_report 按章节读,含子节,不越过下一个同级标题', async () => {
  const { text } = await call('read_report', { id: docId, section: '1-供给' })
  assert.match(text, /盐湖扩产/)
  assert.match(text, /品位下滑/)
  assert.doesNotMatch(text, /储能/)
  assert.match(text, new RegExp(`链接:https://arh\\.example/reports/${docId}#1-%E4%BE%9B%E7%BB%99`))
})

test('read_report 读指定旧版本,链接带 ?v=', async () => {
  const { text } = await call('read_report', { id: docId, version: 1, section: '2-需求' })
  assert.match(text, /45GWh/)
  assert.match(text, /最新是 v2/)
  assert.match(text, /\?v=1#/)
})

test('read_report 超长时分页,给出下一页 offset', async () => {
  const long = `# 长文\n\n${'字'.repeat(PAGE_CHARS + 500)}\n`
  const id = await upload(long)
  const first = await call('read_report', { id })
  assert.match(first.text, new RegExp(`继续读传 offset=${PAGE_CHARS}`))
  const second = await call('read_report', { id, offset: PAGE_CHARS })
  assert.match(second.text, /已读完/)
})

test('找不到研报 / 版本 / 章节时返回 isError,并告诉模型下一步怎么查', async () => {
  const a = await call('read_report', { id: 'nope' })
  assert.ok(a.isError)
  assert.match(a.text, /list_reports/)
  const b = await call('get_report_outline', { id: docId, version: 9 })
  assert.ok(b.isError)
  assert.match(b.text, /v1、v2/)
  const c = await call('read_report', { id: docId, section: '不存在' })
  assert.ok(c.isError)
  assert.match(c.text, /get_report_outline/)
})

test('GET /mcp 返回 405(无状态模式没有推送流)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/mcp' })
  assert.equal(res.statusCode, 405)
})

test('get_signals 按代码过滤,来源研报带链接;不在自选股里时报错', async () => {
  const { addWatchlistEntry } = await import('../services/watchlistStore.ts')
  const { replaceStates } = await import('../services/signalStore.ts')
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: docId, sourceText: '## Albemarle（NYSE: ALB）' })
  replaceStates('ALB', '1d', [{
    symbol: 'ALB', timeframe: '1d', bar_date: '2026-10-09', trend: 1,
    stop_line: 90, close_adj: 99, close_raw: 99, atr: 3,
  }])
  const rows = JSON.parse((await call('get_signals', { symbol: 'alb' })).text)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].daily.trend, 1)
  assert.equal(rows[0].sourceDoc.url, `https://arh.example/reports/${docId}`)
  assert.ok(!('enabled' in rows[0]))
  const miss = await call('get_signals', { symbol: 'TSLA' })
  assert.ok(miss.isError)
})

test('offset 超出正文长度时报错,而不是返回空正文说「已读完」', async () => {
  const r = await call('read_report', { id: docId, section: '2-需求', offset: 9999 })
  assert.ok(r.isError)
  assert.match(r.text, /超出范围/)
})

test('首个标题前的引言能单独读,链接指向篇首', async () => {
  const id = await upload('数据截至 2026-09,单位亿元。\n\n# 有引言的研报\n\n## 1 正文\n\n内容。\n')
  const o = JSON.parse((await call('get_report_outline', { id })).text)
  assert.deepEqual(o.outline[0], { level: 0, title: '引言', slug: '_intro', chars: '数据截至 2026-09,单位亿元。\n\n'.length })
  const { text } = await call('read_report', { id, section: '_intro' })
  assert.match(text, /单位亿元/)
  assert.doesNotMatch(text, /内容。/)
  assert.match(text, new RegExp(`链接:https://arh\\.example/reports/${id}\\n`))
})
