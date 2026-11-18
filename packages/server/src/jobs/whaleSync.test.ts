import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldWhaleBackfill, WHALE_BACKFILL_GATE_MS } from './whaleSync.ts'

const NOW = Date.parse('2026-10-27T06:00:00.000Z')

test('从未拉取过 → 补拉', () => {
  assert.equal(shouldWhaleBackfill(null, NOW), true)
})

test('距上次拉取超过闸门 → 补拉', () => {
  const long = new Date(NOW - WHALE_BACKFILL_GATE_MS - 1000).toISOString()
  assert.equal(shouldWhaleBackfill(long, NOW), true)
})

test('刚拉过 → 跳过', () => {
  const recent = new Date(NOW - 60_000).toISOString()
  assert.equal(shouldWhaleBackfill(recent, NOW), false)
})

test('时间戳损坏时按需要补拉处理', () => {
  assert.equal(shouldWhaleBackfill('不是时间', NOW), true)
  assert.equal(shouldWhaleBackfill('', NOW), true)
})
