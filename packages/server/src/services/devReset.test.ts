import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { planReset, applyReset, RESET_SCOPES } from './devReset.ts'

/** 建一套最小 schema,只关心行数,不关心字段细节。 */
function freshDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE traces (id TEXT PRIMARY KEY);
    CREATE TABLE trace_spans (
      id TEXT PRIMARY KEY, trace_id TEXT NOT NULL,
      FOREIGN KEY (trace_id) REFERENCES traces(id) ON DELETE CASCADE
    );
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, content TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY);
  `)
  db.prepare("INSERT INTO traces VALUES ('t1'),('t2')").run()
  db.prepare("INSERT INTO trace_spans VALUES ('s1','t1'),('s2','t1'),('s3','t2')").run()
  db.prepare("INSERT INTO chat_messages (content) VALUES ('问'),('答')").run()
  db.prepare("INSERT INTO documents VALUES ('d1')").run()
  return db
}

const count = (db: Database.Database, t: string) =>
  (db.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n

test('planReset 只统计,一行都不删', () => {
  const db = freshDb()
  const plan = planReset(db, ['chat', 'traces'])
  assert.deepEqual(plan, [
    { table: 'chat_messages', rows: 2 },
    { table: 'trace_spans', rows: 3 },
    { table: 'traces', rows: 2 },
  ])
  assert.equal(count(db, 'chat_messages'), 2)
  assert.equal(count(db, 'traces'), 2)
})

test('applyReset chat 只清空 chat_messages', () => {
  const db = freshDb()
  applyReset(db, ['chat'])
  assert.equal(count(db, 'chat_messages'), 0)
  assert.equal(count(db, 'traces'), 2)
  assert.equal(count(db, 'trace_spans'), 3)
})

test('applyReset traces 清空 traces 和 trace_spans', () => {
  const db = freshDb()
  applyReset(db, ['traces'])
  assert.equal(count(db, 'traces'), 0)
  assert.equal(count(db, 'trace_spans'), 0)
  assert.equal(count(db, 'chat_messages'), 2)
})

test('未点名的表一律不动', () => {
  const db = freshDb()
  applyReset(db, ['chat', 'traces'])
  assert.equal(count(db, 'documents'), 1)
})

test('applyReset 返回实际删除的行数', () => {
  const db = freshDb()
  const done = applyReset(db, ['chat'])
  assert.deepEqual(done, [{ table: 'chat_messages', rows: 2 }])
})

// 子表必须先于父表删除。若顺序反了,开启外键时父表的 DELETE 会被约束拒绝。
test('开启外键约束时,清空 traces 不会因子表引用而失败', () => {
  const db = freshDb()
  db.pragma('foreign_keys = ON')
  assert.doesNotThrow(() => applyReset(db, ['traces']))
  assert.equal(count(db, 'traces'), 0)
})

test('任一表出错时整体回滚,不留下删一半的状态', () => {
  const db = freshDb()
  db.exec('DROP TABLE trace_spans')          // 让 traces 这一组中途失败
  assert.throws(() => applyReset(db, ['chat', 'traces']))
  assert.equal(count(db, 'chat_messages'), 2, 'chat 应随事务一起回滚')
  assert.equal(count(db, 'traces'), 2)
})

test('未知 scope 抛错而不是静默跳过', () => {
  const db = freshDb()
  // @ts-expect-error 故意传非法 scope
  assert.throws(() => applyReset(db, ['everything']), /未知 scope/)
})

test('RESET_SCOPES 暴露可选范围,供 CLI 校验参数', () => {
  assert.deepEqual(Object.keys(RESET_SCOPES), ['chat', 'traces'])
})
