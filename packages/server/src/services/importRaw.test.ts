import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initChunkFtsTable, searchBm25 } from './chunkFts.ts'
import { initDocumentTable, getDocument } from './documentStore.ts'
import { importRawDocs } from './importRaw.ts'

const MD_A = `# 腾讯生态产业链投资研究报告

## 2.2 各环节生意特征

| 环节 | 毛利率区间 |
|---|---|
| 游戏 | 61% |
`

const MD_NO_TITLE = `## 只有二级标题

正文一段。
`

function freshDb() {
  const db = new Database(':memory:')
  initChunkFtsTable(db)
  initDocumentTable(db)
  return db
}

function reader(map: Record<string, string>) {
  return (id: string) => map[id] ?? null
}

test('建出 documents 行,标题取自 H1', () => {
  const db = freshDb()
  const out = importRawDocs(db, ['doc_a'], reader({ doc_a: MD_A }))

  assert.equal(out[0].status, 'ok')
  assert.equal(out[0].filename, '腾讯生态产业链投资研究报告')
  const row = getDocument('doc_a')
  assert.equal(row?.filename, '腾讯生态产业链投资研究报告')
  assert.equal(row?.chunk_count, out[0].chunks)
  // 字节数而非字符数 —— 中文一个字三字节,用 length 会把体积算少三分之二。
  assert.equal(row?.size_bytes, Buffer.byteLength(MD_A, 'utf8'))
})

// doc_id 必须保留:data/raw/<id>.md 是靠它对应的,重编号会让原文全部失联。
test('沿用传入的 doc_id,不另生成', () => {
  const db = freshDb()
  importRawDocs(db, ['doc_1785581340014_8pha'], reader({ doc_1785581340014_8pha: MD_A }))
  assert.ok(getDocument('doc_1785581340014_8pha'))
})

test('没有 H1 时退回用 doc_id 当标题', () => {
  const db = freshDb()
  const out = importRawDocs(db, ['doc_b'], reader({ doc_b: MD_NO_TITLE }))
  assert.equal(out[0].filename, 'doc_b')
})

test('同时写好 BM25 索引', () => {
  const db = freshDb()
  importRawDocs(db, ['doc_a'], reader({ doc_a: MD_A }))
  assert.equal(searchBm25(db, 'doc_a', '毛利率', 10).length, 1)
})

// 这个脚本是要反复跑的(改了切块规则、换了原文),第二次跑不能变成两行。
test('重复导入不产生重复行,且保留首次的 created_at', () => {
  const db = freshDb()
  importRawDocs(db, ['doc_a'], reader({ doc_a: MD_A }))
  const first = getDocument('doc_a')!

  importRawDocs(db, ['doc_a'], reader({ doc_a: MD_A + '\n## 新增一节\n\n补充内容。\n' }))
  const second = getDocument('doc_a')!

  const { n } = db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number }
  assert.equal(n, 1)
  assert.equal(second.created_at, first.created_at)
  assert.ok(second.chunk_count > first.chunk_count)
})

test('原文缺失时标记 missing,不写行也不抛错', () => {
  const db = freshDb()
  const out = importRawDocs(db, ['gone'], reader({}))
  assert.equal(out[0].status, 'missing')
  assert.equal(getDocument('gone'), null)
})

test('一篇缺失不影响其他篇', () => {
  const db = freshDb()
  const out = importRawDocs(db, ['gone', 'doc_a'], reader({ doc_a: MD_A }))
  assert.equal(out[0].status, 'missing')
  assert.equal(out[1].status, 'ok')
})
