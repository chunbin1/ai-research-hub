import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ETF_PARAMS, computeCodeMetrics, computeDailySummary, type MergedBarInput,
} from './metrics.js'
import type { EtfUniverseEntry } from '../etfMonitorStore.js'

function makeBars(count: number, amount = 1e9): MergedBarInput[] {
  return Array.from({ length: count }, (_, i) => ({
    tradeDate: `2026-10-${String(i + 1).padStart(2, '0')}`,
    open: 1, close: 1, pctChange: 0, volume: 1e9, amount,
    nav: 1, navSource: 'official', totalShares: 1e10, shareSource: 'sse_history',
  }))
}

test('前 20 根历史数据不足时 vol_ratio_20 严格为 null（不回退），第 21 根起正常计算', () => {
  const bars = makeBars(21, 10e8)
  bars[10].amount = 50e8 // 第 11 根放 5 倍量，但前 20 根未满
  bars[20].amount = 25e8 // 第 21 根对比前 20 根
  const rows = computeCodeMetrics('510300', bars, DEFAULT_ETF_PARAMS, '2026-11-18T00:00:00Z')
  assert.equal(rows[10].vol_ratio_20, null)
  assert.equal(rows[10].vol_ratio_5, 5)
  assert.equal(rows[10].signal_level, 'normal')
  assert.ok((rows[20].vol_ratio_20 ?? 0) > 2.0)
})

test('2026-11-17 实测样本回归: 510310 强托底 / 510300 净申购 / 159952 孤立放量', () => {
  const universe: EtfUniverseEntry[] = [
    { code: '510300', market: 'SH', name: '沪深300ETF', tier: 'mega', enabled: true, sort_order: 1, created_at: '' },
    { code: '510310', market: 'SH', name: '300ETF易方达', tier: 'mega', enabled: true, sort_order: 2, created_at: '' },
    { code: '510500', market: 'SH', name: '中证500ETF', tier: 'mid', enabled: true, sort_order: 3, created_at: '' },
    { code: '512100', market: 'SH', name: '中证1000ETF', tier: 'small', enabled: true, sort_order: 4, created_at: '' },
    { code: '159915', market: 'SZ', name: '创业板ETF', tier: 'growth', enabled: true, sort_order: 5, created_at: '' },
    { code: '159952', market: 'SZ', name: '创业板广发', tier: 'growth', enabled: true, sort_order: 6, created_at: '' },
  ]
  const metrics = [
    { code: '510300', trade_date: '2026-11-17', open: 4, close: 4.042, pct_change: -0.5, volume: 2e9, amount: 81.15e8, vol_ratio_5: 1.57, vol_ratio_20: 1.57, nav: 4.0513, nav_source: 'official' as const, premium_rate: -0.23, total_shares: 483.43e8, share_source: 'sse_history' as const, share_delta: 1.34e8, net_inflow_yi: 54.4, signal_level: 'inflow_only' as const, updated_at: '' },
    { code: '510310', trade_date: '2026-11-17', open: 3.9, close: 3.936, pct_change: -0.4, volume: 7e8, amount: 29.24e8, vol_ratio_5: 2.85, vol_ratio_20: 2.85, nav: 3.9371, nav_source: 'official' as const, premium_rate: -0.03, total_shares: 265.63e8, share_source: 'sse_history' as const, share_delta: 0.49e8, net_inflow_yi: 19.4, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '510500', trade_date: '2026-11-17', open: 6.3, close: 6.317, pct_change: -0.6, volume: 6e8, amount: 40.94e8, vol_ratio_5: 1.1, vol_ratio_20: 1.1, nav: 6.3192, nav_source: 'official' as const, premium_rate: -0.03, total_shares: 94.58e8, share_source: 'sse_history' as const, share_delta: 0.39e8, net_inflow_yi: 24.4, signal_level: 'inflow_only' as const, updated_at: '' },
    { code: '512100', trade_date: '2026-11-17', open: 2.4, close: 2.473, pct_change: -1.0, volume: 2e9, amount: 50.68e8, vol_ratio_5: 1.09, vol_ratio_20: 1.09, nav: 2.4789, nav_source: 'official' as const, premium_rate: -0.24, total_shares: 179.09e8, share_source: 'sse_history' as const, share_delta: 0.71e8, net_inflow_yi: 17.6, signal_level: 'inflow_only' as const, updated_at: '' },
    { code: '159915', trade_date: '2026-11-17', open: 2.3, close: 2.31, pct_change: -1.2, volume: 4e9, amount: 111.07e8, vol_ratio_5: 1.01, vol_ratio_20: 1.01, nav: 2.3076, nav_source: 'official' as const, premium_rate: 0.10, total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null, signal_level: 'normal' as const, updated_at: '' },
    { code: '159952', trade_date: '2026-11-17', open: 1.4, close: 1.399, pct_change: -1.3, volume: 5e9, amount: 71.20e8, vol_ratio_5: 4.48, vol_ratio_20: 4.48, nav: 1.4015, nav_source: 'official' as const, premium_rate: -0.18, total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null, signal_level: 'volume_only' as const, updated_at: '' },
  ]
  const sum = computeDailySummary('2026-11-17', universe, metrics, 250, DEFAULT_ETF_PARAMS, '2026-11-18T00:00:00Z')
  assert.equal(sum.resonance_level, 'strong')
  assert.equal(sum.support_tier_count, 3)
  assert.equal(sum.support_etf_count, 4)
  assert.equal(sum.volume_spike_count, 2)
  assert.equal(sum.data_stage, 'partial_shares')
})

test('深市历史缺失导致仅有部分份额时（total_net_inflow_yi !== null），若净申购 < 30 亿不得误降级成兜底触发 strong', () => {
  const universe: EtfUniverseEntry[] = [
    { code: '510300', market: 'SH', name: '300', tier: 'mega', enabled: true, sort_order: 1, created_at: '' },
    { code: '510500', market: 'SH', name: '500', tier: 'mid', enabled: true, sort_order: 2, created_at: '' },
    { code: '512100', market: 'SH', name: '1000', tier: 'small', enabled: true, sort_order: 3, created_at: '' },
    { code: '159915', market: 'SZ', name: '创业板', tier: 'growth', enabled: true, sort_order: 4, created_at: '' },
  ]
  const metrics = [
    // 3 只沪市都放量+正溢价(strong_support)，但每只净申购只有 1 亿，总净申购 3 亿 (< 30亿)
    { code: '510300', trade_date: '2026-10-10', open: 4, close: 4.1, pct_change: 1, volume: 1e9, amount: 50e8, vol_ratio_5: 2, vol_ratio_20: 2.1, nav: 4.05, nav_source: 'official' as const, premium_rate: 1.2, total_shares: 1e10, share_source: 'sse_history' as const, share_delta: 2.5e7, net_inflow_yi: 1.0, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '510500', trade_date: '2026-10-10', open: 6, close: 6.1, pct_change: 1, volume: 1e9, amount: 40e8, vol_ratio_5: 2, vol_ratio_20: 2.1, nav: 6.05, nav_source: 'official' as const, premium_rate: 0.8, total_shares: 1e10, share_source: 'sse_history' as const, share_delta: 1.6e7, net_inflow_yi: 1.0, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '512100', trade_date: '2026-10-10', open: 2, close: 2.05, pct_change: 1, volume: 1e9, amount: 30e8, vol_ratio_5: 2, vol_ratio_20: 2.1, nav: 2.02, nav_source: 'official' as const, premium_rate: 1.4, total_shares: 1e10, share_source: 'sse_history' as const, share_delta: 5e7, net_inflow_yi: 1.0, signal_level: 'strong_support' as const, updated_at: '' },
    { code: '159915', trade_date: '2026-10-10', open: 2, close: 2.0, pct_change: 0, volume: 1e9, amount: 20e8, vol_ratio_5: 1, vol_ratio_20: 1.0, nav: 2.0, nav_source: 'official' as const, premium_rate: 0, total_shares: null, share_source: null, share_delta: null, net_inflow_yi: null, signal_level: 'normal' as const, updated_at: '' },
  ]
  const sum = computeDailySummary('2026-10-10', universe, metrics, 100, DEFAULT_ETF_PARAMS, '2026-11-18T00:00:00Z')
  // total_net_inflow_yi = 3.0 (!== null)，不进 null 兜底，只能是 watch
  assert.equal(sum.total_net_inflow_yi, 3)
  assert.equal(sum.resonance_level, 'watch')
  assert.equal(sum.data_stage, 'partial_shares')
})
