import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { runOnce } from './migrations.ts'

test('同名迁移只跑一次,第二次返回 null', () => {
  const db = new Database(':memory:')
  let runs = 0
  assert.equal(runOnce(db, 'm1', () => ++runs), 1)
  assert.equal(runOnce(db, 'm1', () => ++runs), null)
  assert.equal(runs, 1)
  // 不同名字互不影响
  assert.equal(runOnce(db, 'm2', () => 'ok'), 'ok')
})

// 改了一半就抛错时,数据回滚、也不记成已执行 —— 下次启动会重来
test('迁移抛错:改动回滚,不记成已执行', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE t (v INTEGER)')
  assert.throws(() => runOnce(db, 'boom', () => {
    db.prepare('INSERT INTO t VALUES (1)').run()
    throw new Error('中途失败')
  }))
  assert.equal((db.prepare('SELECT count(*) n FROM t').get() as { n: number }).n, 0)
  assert.equal(runOnce(db, 'boom', () => 'retried'), 'retried')
})
