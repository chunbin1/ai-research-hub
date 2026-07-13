import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initUsageTable, getGlobalCount, incrementGlobalCount, globalRemaining, GLOBAL_LIMIT } from './usageStore.ts'

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
