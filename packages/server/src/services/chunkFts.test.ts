import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initChunkFtsTable, upsertChunkFts, deleteChunkFts, searchBm25, toMatchExpr, countChunkFts } from './chunkFts.ts'
import type { MdChunk } from './markdownParser.ts'

function chunk(chunk_index: number, section_title: string, content: string): MdChunk {
  return { content, chunk_index, section_title, section_slug: section_title, section_path: section_title, char_start: 0, char_end: content.length }
}

function freshDb() {
  const db = new Database(':memory:')
  initChunkFtsTable(db)
  return db
}

// ---------- toMatchExpr:中文没有空格,靠 trigram 分词器 ----------

test('把查询切成所有 3-gram 并 OR 起来', () => {
  assert.equal(toMatchExpr('毛利率是多少'), '"毛利率" OR "利率是" OR "率是多" OR "是多少"')
})

test('正好 3 字 → 单个 gram', () => {
  assert.equal(toMatchExpr('毛利率'), '"毛利率"')
})

test('不足 3 字无法构造 trigram → 返回 null,调用方退化为纯向量', () => {
  assert.equal(toMatchExpr('毛利'), null)
  assert.equal(toMatchExpr(''), null)
  assert.equal(toMatchExpr('  '), null)
})

test('重复的 gram 只保留一个', () => {
  assert.equal(toMatchExpr('abababab'.slice(0, 5)), '"aba" OR "bab"')
})

test('忽略空白,避免把空格也编进 gram', () => {
  assert.equal(toMatchExpr('毛 利 率'), '"毛利率"')
})

test('查询里的双引号被转义,不会破坏 MATCH 表达式', () => {
  assert.ok(toMatchExpr('各环节"生意"')?.includes('""'))
})

// ---------- FTS 读写 ----------

test('写入后能按关键词查到', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, '2.2 生意特征', '游戏毛利率 61%,广告毛利率 57%')])
  const hits = searchBm25(db, 'd1', '毛利率', 10)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].chunk_index, 0)
})

test('同一文档重复写入是覆盖,不是追加', () => {
  const db = freshDb()
  const c = [chunk(0, 'A', '游戏毛利率 61%')]
  upsertChunkFts(db, 'd1', c)
  upsertChunkFts(db, 'd1', c)
  assert.equal(searchBm25(db, 'd1', '毛利率', 10).length, 1)
})

// 与向量路一致:doc_id 必须参与候选选择,不能查完再在应用层删 ——
// 否则前 K 名全是别的文档时会得到空结果。
test('doc_id 是预过滤:查 d1 不会命中 d2 的块', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '游戏毛利率 61%')])
  upsertChunkFts(db, 'd2', [chunk(0, 'B', '游戏毛利率 99%')])
  const hits = searchBm25(db, 'd1', '毛利率', 10)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].doc_id, 'd1')
})

test('删除只影响指定文档', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '游戏毛利率 61%')])
  upsertChunkFts(db, 'd2', [chunk(0, 'B', '游戏毛利率 99%')])
  deleteChunkFts(db, 'd1')
  assert.equal(searchBm25(db, 'd1', '毛利率', 10).length, 0)
  assert.equal(searchBm25(db, 'd2', '毛利率', 10).length, 1)
})

test('无匹配返回空数组', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '游戏毛利率 61%')])
  assert.deepEqual(searchBm25(db, 'd1', '碳酸锂价格走势', 10), [])
})

test('查询不足 3 字时返回空数组,不抛错', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '游戏毛利率 61%')])
  assert.deepEqual(searchBm25(db, 'd1', '毛利', 10), [])
})

// FTS5 的 MATCH 里裸写 42.3 会报 `fts5: syntax error near "."`。
// 线上研报满是数字和代码,这条不过关整个 BM25 路会在真实查询上崩掉。
test('含数字和标点的查询不触发 FTS5 语法错误', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '毛利率 42.3%,代码 NYSE: ALB,错误码 ERR_AUTH_1042')])
  assert.doesNotThrow(() => searchBm25(db, 'd1', '毛利率 42.3% 是多少', 10))
  assert.equal(searchBm25(db, 'd1', '42.3', 10).length, 1)
  assert.equal(searchBm25(db, 'd1', 'ERR_AUTH_1042', 10).length, 1)
})

test('按相关性排序:命中更集中的块排前面', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [
    chunk(0, 'A', '本节讨论公司的整体经营情况以及许多其他与本次提问无关的内容,篇幅很长'.repeat(6) + '毛利率'),
    chunk(1, 'B', '毛利率 61%'),
  ])
  const hits = searchBm25(db, 'd1', '毛利率', 10)
  assert.equal(hits[0].chunk_index, 1, '短块含同一词应排前(BM25 长度归一化)')
})

test('limit 生效', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '毛利率高'), chunk(1, 'B', '毛利率低'), chunk(2, 'C', '毛利率中')])
  assert.equal(searchBm25(db, 'd1', '毛利率', 2).length, 2)
})

test('章节标题也参与检索', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, '2.2 各环节生意特征', '正文与查询词无关')])
  assert.equal(searchBm25(db, 'd1', '生意特征', 10).length, 1)
})

// section_slug 是前端溯源回链的锚点(点来源跳回原文并高亮)。
// BM25 单路命中的块如果没有 slug,那条来源链接就是死的。
test('返回 section_slug,供溯源回链使用', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [{ ...chunk(0, '2.2 生意特征', '游戏毛利率 61%'), section_slug: '22-生意特征' }])
  assert.equal(searchBm25(db, 'd1', '毛利率', 10)[0].section_slug, '22-生意特征')
})

// FTS 是派生索引(原文在 data/raw/,随时可重建),所以 schema 变更直接重建即可。
// 但必须真的重建 —— CREATE TABLE IF NOT EXISTS 遇到旧表会静默跳过,
// 之后每次查询都会因缺列而报错。
test('遇到列不匹配的旧表时重建,而不是静默沿用', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE VIRTUAL TABLE chunk_fts USING fts5(
    doc_id UNINDEXED, chunk_index UNINDEXED, section_title, content, tokenize='trigram')`)
  db.prepare('INSERT INTO chunk_fts VALUES (?,?,?,?)').run('d1', 0, 'A', '游戏毛利率 61%')

  initChunkFtsTable(db)   // 应识别出缺 section_slug 并重建

  assert.doesNotThrow(() => searchBm25(db, 'd1', '毛利率', 10))
  assert.equal(searchBm25(db, 'd1', '毛利率', 10).length, 0, '重建后是空表,等待 reindex 回填')
  upsertChunkFts(db, 'd1', [{ ...chunk(0, 'A', '游戏毛利率 61%'), section_slug: 'a' }])
  assert.equal(searchBm25(db, 'd1', '毛利率', 10)[0].section_slug, 'a')
})

test('schema 已是最新时不重建,保留已有数据', () => {
  const db = freshDb()
  upsertChunkFts(db, 'd1', [chunk(0, 'A', '游戏毛利率 61%')])
  initChunkFtsTable(db)
  assert.equal(searchBm25(db, 'd1', '毛利率', 10).length, 1, '数据不该被抹掉')
})

test('countChunkFts 报告索引里的行数,供启动时自愈判断', () => {
  const db = freshDb()
  assert.equal(countChunkFts(db), 0)
  upsertChunkFts(db, 'd1', [chunk(0, 'A', 'x'), chunk(1, 'B', 'y')])
  assert.equal(countChunkFts(db), 2)
})
