import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  initEtfMonitorTables, listUniverse, addUniverseEntry, updateUniverseEntry,
  deleteUniverseEntry, upsertDailyMetrics, getExistingMetricsForCode,
  upsertDailySummaries, getBoardByDate, getTimelineSummaries, getCodeHistory,
} from './etfMonitorStore.js'

test('initEtfMonitorTables 首次种入 18 只宽基 ETF 且重复初始化幂等', () => {
  const db = new Database(':memory:')
  initEtfMonitorTables(db)
  assert.equal(listUniverse().length, 18)
  // 再次调用不重复插入也不覆盖用户修改
  updateUniverseEntry('159952', { enabled: false })
  initEtfMonitorTables(db)
  assert.equal(listUniverse().length, 18)
  assert.equal(listUniverse({ enabledOnly: true }).length, 17)
})

test('upsertDailyMetrics 保留已有历史快照 total_shares 不被 null 覆盖', () => {
  const db = new Database(':memory:')
  initEtfMonitorTables(db)
  upsertDailyMetrics([{
    code: '159952', trade_date: '2026-11-17', open: 1.4, close: 1.399, pct_change: -1.3,
    volume: 5e9, amount: 7.12e9, vol_ratio_5: 4.48, vol_ratio_20: 4.1,
    nav: 1.4015, nav_source: 'official', premium_rate: -0.18,
    total_shares: 14165584900, share_source: 'snapshot', share_delta: 1e8, net_inflow_yi: 1.4,
    signal_level: 'volume_only', updated_at: '2026-11-18T00:45:00Z',
  }])
  // 模拟日常重算时新拉取对象里深市该历史日未带出 total_shares
  upsertDailyMetrics([{
    code: '159952', trade_date: '2026-11-17', open: 1.4, close: 1.399, pct_change: -1.3,
    volume: 5e9, amount: 7.12e9, vol_ratio_5: 4.48, vol_ratio_20: 4.1,
    nav: 1.4015, nav_source: 'official', premium_rate: -0.18,
    total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null,
    signal_level: 'volume_only', updated_at: '2026-11-18T07:10:00Z',
  }])
  const saved = getExistingMetricsForCode('159952')
  assert.equal(saved[0].total_shares, 14165584900)
  assert.equal(saved[0].share_source, 'snapshot')
})

test('universe CRUD 与 board / timeline / history 查询', () => {
  const db = new Database(':memory:')
  initEtfMonitorTables(db)
  addUniverseEntry({ code: '510350', market: 'SH', name: '沪深300ETF工银', tier: 'mega' })
  assert.equal(listUniverse().length, 19)

  upsertDailyMetrics([{
    code: '510300', trade_date: '2026-11-17', open: 4.0, close: 4.042, pct_change: -0.5,
    volume: 2e9, amount: 8.115e9, vol_ratio_5: 1.57, vol_ratio_20: 1.6,
    nav: 4.0513, nav_source: 'official', premium_rate: -0.23,
    total_shares: 48343087700, share_source: 'sse_history', share_delta: 1341900000, net_inflow_yi: 54.36,
    signal_level: 'inflow_only', updated_at: '2026-11-18T01:00:00Z',
  }])
  upsertDailySummaries([{
    trade_date: '2026-11-17', resonance_level: 'strong', active_count: 18,
    volume_spike_count: 2, support_etf_count: 5, support_tier_count: 3,
    total_amount_yi: 502.6, aggregate_vol_ratio: 1.45, total_net_inflow_yi: 115.8,
    data_stage: 'partial_shares', updated_at: '2026-11-18T01:00:00Z',
  }])

  const board = getBoardByDate()
  assert.equal(board.summary?.trade_date, '2026-11-17')
  assert.equal(board.metrics.length, 1)
  assert.deepEqual(board.availableDates, ['2026-11-17'])
  assert.equal(getTimelineSummaries(90).length, 1)
  assert.equal(getCodeHistory('510300', 60).length, 1)

  assert.equal(deleteUniverseEntry('510350'), true)
  assert.equal(listUniverse().length, 18)
})
