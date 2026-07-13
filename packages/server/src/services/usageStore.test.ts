import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initUsageTable,
  getGlobalCount,
  incrementGlobalCount,
  globalRemaining,
  GLOBAL_LIMIT,
  tryReserveGlobal,
  refundGlobal,
} from './usageStore.ts'

test('全局计数:初始 0,自增,剩余递减', () => {
  const db = new Database(':memory:')
  initUsageTable(db)
  assert.equal(getGlobalCount(), 0)
  assert.equal(globalRemaining(), GLOBAL_LIMIT)
  incrementGlobalCount()
  incrementGlobalCount()
  assert.equal(getGlobalCount(), 2)
  assert.equal(globalRemaining(), GLOBAL_LIMIT - 2)
})

test('tryReserveGlobal:原子占用,达到上限后拒绝,refundGlobal 归还且不低于0', () => {
  const db = new Database(':memory:')
  initUsageTable(db)

  assert.equal(tryReserveGlobal(), true)
  assert.equal(getGlobalCount(), 1)

  db.prepare('UPDATE usage SET total_count = ?').run(GLOBAL_LIMIT)
  assert.equal(tryReserveGlobal(), false)
  assert.equal(getGlobalCount(), GLOBAL_LIMIT) // 拒绝时计数不变

  refundGlobal()
  assert.equal(getGlobalCount(), GLOBAL_LIMIT - 1)

  // 归还不应低于 0
  db.prepare('UPDATE usage SET total_count = 0').run()
  refundGlobal()
  assert.equal(getGlobalCount(), 0)
})
