import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initChunkFtsTable, searchBm25 } from './chunkFts.ts'
import { initIndexStateTable } from './indexState.ts'
import { initVersionTable, insertVersion } from './versionStore.ts'
import { reindexFts } from './reindex.ts'

const MD_A = `# 腾讯生态

## 2.2 各环节生意特征

| 环节 | 毛利率区间 |
|---|---|
| 游戏 | 61% |
`

const MD_B = `# 碳酸锂

## 1.1 价格走势

碳酸锂现货 16.79 万元/吨。
`

function freshDb() {
  const db = new Database(':memory:')
  initChunkFtsTable(db)
  initIndexStateTable(db)
  initVersionTable(db)
  return db
}

/** 用内存里的 map 冒充 data/raw/*.md,测试不碰文件系统。 */
function reader(map: Record<string, string>) {
  return (id: string) => map[id] ?? null
}

test('重建后能用 BM25 查到内容', () => {
  const db = freshDb()
  reindexFts(db, ['a'], reader({ a: MD_A }))
  assert.equal(searchBm25(db, 'a', '毛利率', 10).length, 1)
})

test('返回每篇实际写入的块数', () => {
  const db = freshDb()
  const out = reindexFts(db, ['a', 'b'], reader({ a: MD_A, b: MD_B }))
  assert.equal(out.length, 2)
  assert.equal(out[0].docId, 'a')
  assert.equal(out[0].status, 'ok')
  assert.ok(out[0].chunks > 0)
})

// 原文文件可能被手工删掉,或上传时写盘失败。一篇取不到不该让整次重建崩掉。
test('原文缺失时标记 missing,不抛错', () => {
  const db = freshDb()
  const out = reindexFts(db, ['gone'], reader({}))
  assert.deepEqual(out, [{ docId: 'gone', version: 1, chunks: 0, status: 'missing', gen: null, mismatch: false }])
})

test('一篇缺失不影响其他篇', () => {
  const db = freshDb()
  const out = reindexFts(db, ['gone', 'a'], reader({ a: MD_A }))
  assert.equal(out[0].status, 'missing')
  assert.equal(out[1].status, 'ok')
  assert.equal(searchBm25(db, 'a', '毛利率', 10).length, 1)
})

test('重复运行是幂等的,不会插出重复行', () => {
  const db = freshDb()
  reindexFts(db, ['a'], reader({ a: MD_A }))
  reindexFts(db, ['a'], reader({ a: MD_A }))
  assert.equal(searchBm25(db, 'a', '毛利率', 10).length, 1)
})

// 原文改短后,旧块必须消失 —— 否则 BM25 会召回文档里已经不存在的内容。
test('重建会清掉该文档过时的旧块', () => {
  const db = freshDb()
  reindexFts(db, ['a'], reader({ a: MD_A }))
  assert.equal(searchBm25(db, 'a', '毛利率', 10).length, 1)
  reindexFts(db, ['a'], reader({ a: '# 腾讯生态\n\n改写后不再提那个词。\n' }))
  assert.equal(searchBm25(db, 'a', '毛利率', 10).length, 0)
})

test('空文档列表返回空结果', () => {
  assert.deepEqual(reindexFts(freshDb(), [], reader({})), [])
})

test('逐个版本重建,各版本的块互不覆盖', () => {
  const db = freshDb()
  for (let i = 0; i < 2; i++) insertVersion(db, { doc_id: 'a', filename: 'a', size_bytes: 1, chunk_count: 1 })
  const byVersion = (id: string, v: number) => (v === 1 ? MD_A : MD_A + '\n## 3.1 新增\n\n补充的正文内容。\n')
  const out = reindexFts(db, ['a'], byVersion)
  assert.deepEqual(out.map(o => o.version), [1, 2])
  assert.notEqual(out[0].gen, out[1].gen)
  assert.equal(searchBm25(db, 'a', '补充的正文内容', 10, out[0].gen).length, 0)
  assert.equal(searchBm25(db, 'a', '补充的正文内容', 10, out[1].gen).length, 1)
})
