// 配了 MCP_UPLOAD_KEY 之后的上传。和 mcp.test.ts 分开:那个文件不配密钥,
// 断言工具列表保持只读。本文件串行,避免用例同时改同一份库。
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify from 'fastify'

process.env.RAW_DIR = mkdtempSync(join(tmpdir(), 'mcp-upload-'))
process.env.DB_PATH = ':memory:'
process.env.AUTH_DISABLED = 'true'
process.env.APP_URL = 'https://arh.example'
process.env.SIGNALS = 'off'
process.env.DISABLE_EMBEDDING = 'true'
process.env.MCP_UPLOAD_KEY = 'test-mcp-upload-key'

const KEY = process.env.MCP_UPLOAD_KEY

const { initDb } = await import('../services/db.ts')
const { initDocumentTable } = await import('../services/documentStore.ts')
const { initChunkFtsTable } = await import('../services/chunkFts.ts')
const { initIndexStateTable } = await import('../services/indexState.ts')
const { initWatchlistTable, listWatchlist } = await import('../services/watchlistStore.ts')
const { mcpRoutes } = await import('./mcp.ts')
const { MARKDOWN_MAX_CHARS } = await import('../services/mcpServer.ts')
const { NOTE_MAX } = await import('../services/publishReport.ts')

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)
initIndexStateTable(db)
initWatchlistTable(db)

const app = fastify()
await app.register(mcpRoutes, { prefix: '/api' })
await app.ready()

let rpcId = 0
async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  })
  assert.equal(res.statusCode, 200, res.body)
  return res.json()
}

const auth = { authorization: `Bearer ${KEY}` }

async function call(name: string, args: Record<string, unknown> = {}, headers: Record<string, string> = auth) {
  const body = await rpc('tools/call', { name, arguments: args }, headers)
  assert.ok(body.result, JSON.stringify(body))
  return { text: body.result.content[0].text as string, isError: body.result.isError === true }
}

async function titles(): Promise<string[]> {
  const list = JSON.parse((await call('list_reports', {}, {})).text) as { title: string }[]
  return list.map(r => r.title)
}

describe('mcp upload', { concurrency: false }, () => {
  test('密钥不对或没带头时看不到上传工具,也不会落库', async () => {
    const cases: Record<string, string>[] = [{}, { authorization: 'Bearer wrong-key' }, { authorization: 'Basic abc' }]
    for (const headers of cases) {
      const { result } = await rpc('tools/list', {}, headers)
      const names = result.tools.map((t: { name: string }) => t.name)
      assert.deepEqual(names.sort(), ['get_report_outline', 'list_reports', 'read_report'])
      assert.ok(result.tools.every((t: { annotations?: { readOnlyHint?: boolean } }) => t.annotations?.readOnlyHint))
      const res = await call('upload_report', { markdown: '# 不该出现\n\n正文。\n' }, headers)
      assert.ok(res.isError)
      assert.match(res.text, /not found/)
    }
    assert.deepEqual(await titles(), [])
  })

  test('空白密钥等于没配,不出现上传工具', async () => {
    process.env.MCP_UPLOAD_KEY = '   '
    try {
      const { result } = await rpc('tools/list', {}, auth)
      assert.ok(!result.tools.some((t: { name: string }) => t.name === 'upload_report'))
    } finally {
      process.env.MCP_UPLOAD_KEY = KEY
    }
  })

  test('带对密钥可以上传,读工具能读到,标题里的美股进自选股', async () => {
    const { result } = await rpc('tools/list', {}, auth)
    const upload = result.tools.find((t: { name: string }) => t.name === 'upload_report')
    assert.equal(upload.annotations.readOnlyHint, false)
    assert.ok(result.tools.filter((t: { name: string }) => t.name !== 'upload_report').every(
      (t: { annotations?: { readOnlyHint?: boolean } }) => t.annotations?.readOnlyHint,
    ))

    const md = '# Albemarle（NYSE: ALB）\n\n盐湖提锂。\n'
    const saved = JSON.parse((await call('upload_report', { markdown: md, note: 'n'.repeat(NOTE_MAX + 50) })).text)
    assert.equal(saved.saved, true)
    assert.equal(saved.title, 'Albemarle（NYSE: ALB）')
    assert.equal(saved.kind, '公司')
    assert.equal(saved.version, 1)
    assert.equal(saved.note.length, NOTE_MAX)
    assert.equal(saved.url, `https://arh.example/reports/${saved.id}`)

    const read = await call('read_report', { id: saved.id }, {})
    assert.match(read.text, /盐湖提锂/)
    assert.ok(listWatchlist().some(e => e.symbol === 'ALB'))

    const outline = JSON.parse((await call('get_report_outline', { id: saved.id }, {})).text)
    assert.equal(outline.versions[0].note.length, NOTE_MAX)
  })

  test('没有一级标题时用 title;空正文、超长、非法类型都不落库', async () => {
    const before = await titles()

    const named = JSON.parse((await call('upload_report', {
      markdown: '没有标题的正文。\n',
      title: '手工标题',
      kind: 'industry',
    })).text)
    assert.equal(named.saved, true)
    assert.equal(named.title, '手工标题')
    assert.equal(named.kind, '行业')

    const empty = await call('upload_report', { markdown: ' \n\t ' })
    assert.ok(empty.isError)
    assert.match(empty.text, /空/)

    const missingTitle = await call('upload_report', { markdown: '只有正文,没有标题。\n' })
    assert.ok(missingTitle.isError)
    assert.match(missingTitle.text, /title/)

    const tooLong = await call('upload_report', { markdown: 'a'.repeat(MARKDOWN_MAX_CHARS + 1) })
    assert.ok(tooLong.isError)
    assert.match(tooLong.text, /没有写入/)

    const badKind = await call('upload_report', { markdown: '# 类型不对\n\n正文。\n', kind: 'other' })
    assert.ok(badKind.isError)

    const after = await titles()
    assert.deepEqual(after.filter(t => !before.includes(t)), ['手工标题'])
  })

  test('疑似旧篇不落库,confirmNew 之后才新建', async () => {
    const original = '# 锂电产业链\n\n盐湖扩产是主线。\n'
    const first = JSON.parse((await call('upload_report', { markdown: original })).text)
    assert.equal(first.saved, true)

    const md = '# 锂电产业链\n\n这是另一份正文,确认前不该落库。\n'
    const blocked = JSON.parse((await call('upload_report', { markdown: md })).text)
    assert.equal(blocked.saved, false)
    assert.equal(blocked.reason, 'similar')
    assert.equal(blocked.candidates[0].id, first.id)
    assert.equal(blocked.candidates[0].title, '锂电产业链')
    assert.equal(blocked.candidates[0].url, `https://arh.example/reports/${first.id}`)
    assert.ok(blocked.candidates[0].reasons.includes('标题相同'))
    assert.equal((await titles()).filter(t => t === '锂电产业链').length, 1)

    const created = JSON.parse((await call('upload_report', { markdown: md, confirmNew: true })).text)
    assert.equal(created.saved, true)
    assert.notEqual(created.id, first.id)
    assert.equal((await titles()).filter(t => t === '锂电产业链').length, 2)
    const read = await call('read_report', { id: created.id }, {})
    assert.match(read.text, /确认前不该落库/)
  })
})
