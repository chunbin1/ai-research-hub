import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initIndexStateTable, getIndexState, putIndexState, setFtsGen,
  deleteIndexState, isConsistent, planRetrieval,
} from './indexState.ts'

function freshDb() {
  const db = new Database(':memory:')
  initIndexStateTable(db)
  return db
}

const row = (over: Partial<Record<string, string>> = {}) => ({
  doc_id: 'doc_a',
  active_gen: 'g1',
  vec_gen: 'g1',
  fts_gen: 'g1',
  embed_model: 'embedding-3',
  ...over,
})

test('没有行时返回 null —— 调用方要当 legacy 处理,不是错误', () => {
  assert.equal(getIndexState(freshDb(), 'doc_a'), null)
})

test('写入后读得回来,重复写是就地更新', () => {
  const db = freshDb()
  putIndexState(db, row())
  putIndexState(db, row({ active_gen: 'g2', vec_gen: 'g2', fts_gen: 'g2' }))
  assert.equal(getIndexState(db, 'doc_a')?.active_gen, 'g2')
  const { n } = db.prepare('SELECT count(*) AS n FROM doc_index_state').get() as { n: number }
  assert.equal(n, 1)
})

// 这是关键约定:单独重建 FTS 就是会造成错位,状态表必须如实记录,
// 而不是顺手把 active_gen 也改掉——那等于把错位藏起来。
test('setFtsGen 只动 fts_gen,故意不碰 active_gen', () => {
  const db = freshDb()
  putIndexState(db, row())
  setFtsGen(db, 'doc_a', 'g2')
  const s = getIndexState(db, 'doc_a')!
  assert.equal(s.fts_gen, 'g2')
  assert.equal(s.active_gen, 'g1')
  assert.equal(s.vec_gen, 'g1')
})

test('setFtsGen 对没有状态行的文档是空操作', () => {
  const db = freshDb()
  setFtsGen(db, 'doc_missing', 'g2')
  assert.equal(getIndexState(db, 'doc_missing'), null)
})

test('deleteIndexState 清掉该文档', () => {
  const db = freshDb()
  putIndexState(db, row())
  deleteIndexState(db, 'doc_a')
  assert.equal(getIndexState(db, 'doc_a'), null)
})

test('三个代次一致才算一致;legacy(null)算一致', () => {
  assert.equal(isConsistent(null), true)
  assert.equal(isConsistent({ ...row(), updated_at: '' } as never), true)
  assert.equal(isConsistent({ ...row({ vec_gen: 'g0' }), updated_at: '' } as never), false)
})

test('legacy 文档不过滤代次,两路照常融合', () => {
  assert.deepEqual(planRetrieval(null), { gen: null, restrict: null })
})

test('两路一致时按 active_gen 过滤并融合', () => {
  const s = { ...row(), updated_at: '' } as never
  assert.deepEqual(planRetrieval(s), { gen: 'g1', restrict: null })
})

// 向量落后(典型:--no-vectors 重建过,或上传后向量还没建完)→ 只走 BM25
test('向量代次落后时退成纯 BM25,绝不融合', () => {
  const s = { ...row({ vec_gen: 'g0' }), updated_at: '' } as never
  assert.deepEqual(planRetrieval(s), { gen: 'g1', restrict: 'bm25' })
})

// FTS 被单独重建过(跑了 pnpm reindex)→ 只走向量
test('FTS 代次对不上 active 时退成纯向量,绝不融合', () => {
  const s = { ...row({ fts_gen: 'g2' }), updated_at: '' } as never
  assert.deepEqual(planRetrieval(s), { gen: 'g1', restrict: 'vector' })
})
