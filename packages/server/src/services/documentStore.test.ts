import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initDocumentTable, saveDocument, getAllDocuments, getDocument, deleteDocument, uploadedAtFromId, fixCreatedAtFromIds,
  setDocumentKind, backfillDocumentKinds,
} from './documentStore.ts'
import { insertVersion, getVersion } from './versionStore.ts'

test('save/get/list/delete 往返', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const doc = saveDocument({ filename: '碳酸锂', size_bytes: 100, chunk_count: 5 })
  assert.equal(getDocument(doc.id)?.filename, '碳酸锂')
  assert.equal(getAllDocuments().length, 1)
  deleteDocument(doc.id)
  assert.equal(getAllDocuments().length, 0)
})

test('上传时刻能从 id 里读回来,且和 created_at 一致', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const doc = saveDocument({ filename: 'x', size_bytes: 1, chunk_count: 1 })
  assert.equal(uploadedAtFromId(doc.id), doc.created_at)
  assert.equal(uploadedAtFromId('doc_a'), null)
})

// import:raw 曾把老研报的 created_at 写成导入那一刻,它们就压在了之前上传的新研报上面。
test('一次性迁移把被导入时刻顶掉的 created_at 校正回上传时刻,新上传的排最前', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const insert = db.prepare('INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, 1, 1, ?)')
  const importedAt = '2026-09-03T14:24:59.600Z'
  insert.run('doc_1785584414151_6vk8', '8/1 上传、9/3 被重导', importedAt)
  insert.run('doc_1787992051140_njd1', '8/29 上传', '2026-08-29T08:27:31.140Z')
  insert.run('doc_a', '非标准 id,不动', importedAt)

  fixCreatedAtFromIds(db)

  assert.deepEqual(getAllDocuments().map(d => d.id), [
    'doc_a', 'doc_1787992051140_njd1', 'doc_1785584414151_6vk8',
  ])
  assert.equal(getDocument('doc_1785584414151_6vk8')?.created_at, '2026-08-01T11:40:14.151Z')
  assert.equal(getDocument('doc_a')?.created_at, importedAt)

  const fresh = saveDocument({ filename: '刚上传', size_bytes: 1, chunk_count: 1 })
  assert.equal(getAllDocuments()[0].id, fresh.id)
})

// 首页按更新时间排:老研报传了新版本,就该回到最前面。
test('传了新版本的老研报排到最前', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const old = saveDocument({ filename: '老的', size_bytes: 1, chunk_count: 1 })
  insertVersion(db, { doc_id: old.id, filename: '老的', size_bytes: 1, chunk_count: 1, created_at: '2026-08-01T00:00:00.000Z' })
  const newer = saveDocument({ filename: '新的', size_bytes: 1, chunk_count: 1 })
  insertVersion(db, { doc_id: newer.id, filename: '新的', size_bytes: 1, chunk_count: 1, created_at: '2026-09-01T00:00:00.000Z' })
  assert.deepEqual(getAllDocuments().map(d => d.id), [newer.id, old.id])

  insertVersion(db, { doc_id: old.id, filename: '老的 v2', size_bytes: 1, chunk_count: 1, created_at: '2026-09-20T00:00:00.000Z' })
  assert.deepEqual(getAllDocuments().map(d => d.id), [old.id, newer.id])
})

// 版本迁移把错的 created_at 抄成了 v1 的时间,不一起校正的话 updated_at 还是错的。
test('v1 的时间也校正回上传时刻,后续版本不动', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const importedAt = '2026-09-03T14:24:59.600Z'
  db.prepare('INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, 1, 1, ?)').run('doc_1785584414151_6vk8', 'x', importedAt)
  insertVersion(db, { doc_id: 'doc_1785584414151_6vk8', filename: 'x', size_bytes: 1, chunk_count: 1, created_at: importedAt })
  insertVersion(db, { doc_id: 'doc_1785584414151_6vk8', filename: 'x', size_bytes: 1, chunk_count: 1, created_at: '2026-09-20T00:00:00.000Z' })

  fixCreatedAtFromIds(db)

  assert.equal(getVersion(db, 'doc_1785584414151_6vk8', 1)?.created_at, '2026-08-01T11:40:14.151Z')
  assert.equal(getVersion(db, 'doc_1785584414151_6vk8', 2)?.created_at, '2026-09-20T00:00:00.000Z')
  assert.equal(getDocument('doc_1785584414151_6vk8')?.updated_at, '2026-09-20T00:00:00.000Z')
})

// documents 行先被校正过、v1 是后来迁移才抄错的:v1 不能因为和 documents 对不上就漏掉。
test('documents 行已经对了、只有 v1 错,也能校正', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  db.prepare('INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, 1, 1, ?)').run('doc_1785584414151_6vk8', 'x', '2026-08-01T11:40:14.151Z')
  insertVersion(db, { doc_id: 'doc_1785584414151_6vk8', filename: 'x', size_bytes: 1, chunk_count: 1, created_at: '2026-09-03T14:24:59.600Z' })

  fixCreatedAtFromIds(db)

  assert.equal(getDocument('doc_1785584414151_6vk8')?.updated_at, '2026-08-01T11:40:14.151Z')
})

// 修历史数据,不是长期规则:跑过一次之后,created_at 和 id 对不上也不再改写。
test('校正只跑一次:返回改了哪几篇,第二次返回 null 且不再改写', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const insert = db.prepare('INSERT INTO documents (id, filename, size_bytes, chunk_count, created_at) VALUES (?, ?, 1, 1, ?)')
  insert.run('doc_1785584414151_6vk8', 'x', '2026-09-03T14:24:59.600Z')
  insert.run('doc_1787992051140_njd1', '本来就对', '2026-08-29T08:27:31.140Z')

  assert.deepEqual(fixCreatedAtFromIds(db), ['doc_1785584414151_6vk8'])

  // 之后有人有意把日期改成和 id 不一致,重启也不该被改回去
  db.prepare('UPDATE documents SET created_at = ? WHERE id = ?').run('2026-07-01T00:00:00.000Z', 'doc_1785584414151_6vk8')
  initDocumentTable(db)
  assert.equal(fixCreatedAtFromIds(db), null)
  assert.equal(getDocument('doc_1785584414151_6vk8')?.created_at, '2026-07-01T00:00:00.000Z')
})

// ── 研报类型(行业 / 公司)────────────────────────────────────────────────

test('kind 缺省是行业研报,可以改成公司研报', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const doc = saveDocument({ filename: '碳酸锂产业链', size_bytes: 1, chunk_count: 1 })
  assert.equal(doc.kind, 'industry')
  const co = saveDocument({ filename: '贵州茅台（600519.SH）', size_bytes: 1, chunk_count: 1, kind: 'company' })
  assert.equal(getDocument(co.id)?.kind, 'company')
  setDocumentKind(doc.id, 'company')
  assert.equal(getDocument(doc.id)?.kind, 'company')
  assert.throws(() => db.prepare("UPDATE documents SET kind = 'other'").run(), /CHECK/)
})

test('没有 kind 列的老库启动时补上列,存量按行业研报', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE documents (
    id TEXT PRIMARY KEY, filename TEXT NOT NULL, size_bytes INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO documents VALUES ('doc_old', '旧研报', 1, 1, '2026-08-01T00:00:00.000Z');`)
  initDocumentTable(db)
  initDocumentTable(db) // 再跑一次不能因为列已存在而报错
  assert.equal(getDocument('doc_old')?.kind, 'industry')
})

test('存量回填只把标题里带代码的改成公司研报,且只跑一次', () => {
  const db = new Database(':memory:')
  initDocumentTable(db)
  const industry = saveDocument({ filename: '碳酸锂产业链投资研究报告', size_bytes: 1, chunk_count: 1 })
  const method = saveDocument({ filename: '投研方法论:如何读懂一份看空报告', size_bytes: 1, chunk_count: 1 })
  const company = saveDocument({ filename: '贵州茅台（600519.SH）投资研究报告', size_bytes: 1, chunk_count: 1 })

  assert.deepEqual(backfillDocumentKinds(db), [company.id])
  assert.equal(getDocument(industry.id)?.kind, 'industry')
  assert.equal(getDocument(method.id)?.kind, 'industry')
  assert.equal(getDocument(company.id)?.kind, 'company')

  // 管理员手动改回行业后,重启不能再被规则改走
  setDocumentKind(company.id, 'industry')
  assert.equal(backfillDocumentKinds(db), null)
  assert.equal(getDocument(company.id)?.kind, 'industry')
})
