// 单独一个文件:AUTH_DISABLED 在 auth.ts 模块顶层只求值一次,同一进程里
// 没法既「跳过登录」又「未登录」。node:test 每个文件跑独立子进程。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fastify from 'fastify'
import multipart from '@fastify/multipart'

process.env.RAW_DIR = mkdtempSync(join(tmpdir(), 'documents-auth-'))
process.env.DB_PATH = ':memory:'
delete process.env.AUTH_DISABLED

const { initDb } = await import('../services/db.ts')
const { initDocumentTable, saveDocument } = await import('../services/documentStore.ts')
const { initChunkFtsTable } = await import('../services/chunkFts.ts')
const { initIndexStateTable } = await import('../services/indexState.ts')
const { initWatchlistTable } = await import('../services/watchlistStore.ts')
const { documentRoutes } = await import('./documents.ts')

const db = initDb()
initDocumentTable(db)
initChunkFtsTable(db)
initIndexStateTable(db)
initWatchlistTable(db)
const doc = saveDocument({ filename: '贵州茅台（600519.SH）投资研究报告', size_bytes: 1, chunk_count: 1, kind: 'company' })

const app = fastify()
await app.register(multipart)
await app.register(documentRoutes, { prefix: '/api' })
await app.ready()

test('读列表公开;改类型、上传、删除未登录一律 401,类型不会被改', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/documents' })).statusCode, 200)

  for (const [method, url, payload] of [
    ['PATCH', `/api/documents/${doc.id}`, { kind: 'industry' }],
    ['POST', '/api/documents', undefined],
    ['POST', '/api/documents/similar', undefined],
    ['DELETE', `/api/documents/${doc.id}`, undefined],
  ] as const) {
    const res = await app.inject({ method, url, payload })
    assert.equal(res.statusCode, 401, `${method} ${url} 应该 401`)
  }

  const list = (await app.inject({ method: 'GET', url: '/api/documents' })).json().documents
  assert.equal(list.find((d: { id: string }) => d.id === doc.id).kind, 'company')
})
