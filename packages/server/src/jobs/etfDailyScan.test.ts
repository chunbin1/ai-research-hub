import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ETF_CRON_EXPRS, ETF_TIMEZONE, ETF_BACKFILL_GATE_MS, shouldEtfBackfill,
} from './etfDailyScan.js'

test('ETF 定时调度表达式与时区正确', () => {
  assert.deepEqual([...ETF_CRON_EXPRS], ['10 15 * * 1-5', '0 20 * * 1-5', '45 8 * * 1-5'])
  assert.equal(ETF_TIMEZONE, 'Asia/Shanghai')
})

test('shouldEtfBackfill 按 4 小时闸门决定启动补扫', () => {
  const now = Date.parse('2026-11-18T06:00:00.000Z')
  assert.equal(shouldEtfBackfill(null, now), true)
  assert.equal(shouldEtfBackfill('bad-date', now), true)
  assert.equal(shouldEtfBackfill(new Date(now - ETF_BACKFILL_GATE_MS + 1000).toISOString(), now), false)
  assert.equal(shouldEtfBackfill(new Date(now - ETF_BACKFILL_GATE_MS).toISOString(), now), true)
})
