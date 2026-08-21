import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldBackfill, BACKFILL_GATE_MS, CRON_EXPR } from './dailyScan.ts'

const NOW = Date.parse('2026-08-21T10:00:00.000Z')

test('从未扫描过 → 补扫', () => {
  assert.equal(shouldBackfill(null, NOW), true)
})

test('距上次扫描超过闸门 → 补扫', () => {
  const long = new Date(NOW - BACKFILL_GATE_MS - 1000).toISOString()
  assert.equal(shouldBackfill(long, NOW), true)
  // 停机一周同样只走这一条路径,不需要知道缺了几天
  assert.equal(shouldBackfill('2026-08-14T10:00:00.000Z', NOW), true)
})

test('刚扫过 → 跳过(防开发期反复重启)', () => {
  const recent = new Date(NOW - 60_000).toISOString()
  assert.equal(shouldBackfill(recent, NOW), false)
})

test('时间戳损坏时按需要补扫处理', () => {
  assert.equal(shouldBackfill('不是时间', NOW), true)
  assert.equal(shouldBackfill('', NOW), true)
})

test('cron 表达式:工作日 21:30', () => {
  assert.equal(CRON_EXPR, '30 21 * * 1-5')
})
