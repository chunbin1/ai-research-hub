import { describe, expect, test } from 'vitest'
import type { EtfBoardRow, EtfDailyMetric } from '../types'
import {
  DATA_STAGE_LABEL,
  ETF_FILTERS,
  RESONANCE_META,
  SIGNAL_LEVEL_META,
  TIER_LABEL,
  computeBoardTotalCapYi,
  computeMarketCapYi,
  computeTurnoverRate,
  filterEtfCounts,
  formatAmountYuanToYi,
  formatPremium,
  formatRatio,
  formatYi,
  matchesEtfFilter,
  matchesEtfQuery,
  sortEtfRows,
  volBarWidth,
} from './etfView'

function makeMetric(over: Partial<EtfDailyMetric> = {}): EtfDailyMetric {
  return {
    code: '510300',
    trade_date: '2026-11-17',
    open: 4.0,
    close: 4.05,
    pct_change: 1.25,
    volume: 1000000,
    amount: 40_5000_0000,
    vol_ratio_5: 1.5,
    vol_ratio_20: 1.6,
    nav: 4.04,
    nav_source: 'official',
    premium_rate: 0.08,
    total_shares: 100_0000_0000,
    share_source: 'sse_history',
    share_delta: 5_0000_0000,
    net_inflow_yi: 20.2,
    signal_level: 'normal',
    updated_at: '2026-11-17T12:00:00Z',
    ...over,
  }
}

function makeRow(over: Partial<EtfBoardRow> = {}): EtfBoardRow {
  return {
    code: '510300',
    market: 'SH',
    name: '沪深300ETF华泰柏瑞',
    tier: 'mega',
    enabled: true,
    sort_order: 20,
    created_at: '2026-11-18T00:00:00Z',
    metric: makeMetric({ code: over.code ?? '510300' }),
    ...over,
  }
}

describe('etfView formatting & visual helpers', () => {
  test('volBarWidth clamps between 0% and 100% capped at 4x', () => {
    expect(volBarWidth(null)).toBe('0.0%')
    expect(volBarWidth(-0.5)).toBe('0.0%')
    expect(volBarWidth(0)).toBe('0.0%')
    expect(volBarWidth(1.8)).toBe('45.0%')
    expect(volBarWidth(4)).toBe('100.0%')
    expect(volBarWidth(6.2)).toBe('100.0%')
  })

  test('formatYi handles null, unsigned and signed values', () => {
    expect(formatYi(null)).toBe('—')
    expect(formatYi(19.44)).toBe('19.4亿')
    expect(formatYi(19.44, true)).toBe('+19.4亿')
    expect(formatYi(-3.26, true)).toBe('-3.3亿')
    expect(formatYi(0, true)).toBe('0.0亿')
    expect(formatAmountYuanToYi(15_6300_0000)).toBe('15.6亿')
    expect(formatAmountYuanToYi(null)).toBe('—')
  })

  test('formatRatio and formatPremium format numbers cleanly', () => {
    expect(formatRatio(null)).toBe('—')
    expect(formatRatio(2.854)).toBe('2.85x')
    expect(formatPremium(null)).toBe('—')
    expect(formatPremium(0.084)).toBe('+0.08%')
    expect(formatPremium(-0.07)).toBe('-0.07%')
    expect(formatPremium(0)).toBe('0.00%')
  })

  test('label mappings cover all tiers, resonance levels, data stages and signal levels', () => {
    expect(TIER_LABEL).toEqual({
      mega: '超大盘权重',
      mid: '中盘均衡',
      small: '小微盘',
      growth: '双创成长',
    })
    expect(Object.keys(RESONANCE_META).sort()).toEqual(['none', 'strong', 'watch'])
    expect(RESONANCE_META.strong.label).toBe('强托底共振')
    expect(RESONANCE_META.watch.label).toBe('局部关注')
    expect(RESONANCE_META.none.label).toBe('常规波动')

    expect(DATA_STAGE_LABEL).toEqual({
      preliminary: '初步估算',
      nav_ready: '含官方净值',
      partial_shares: '含沪市份额',
      complete: '完整数据',
    })

    expect(Object.keys(SIGNAL_LEVEL_META).sort()).toEqual([
      'inflow_only',
      'normal',
      'strong_support',
      'volume_only',
    ])
  })
})

describe('etfView sorting and filtering', () => {
  const mega = makeRow({
    code: '510050',
    name: '上证50ETF华夏',
    tier: 'mega',
    sort_order: 10,
    metric: makeMetric({
      code: '510050',
      vol_ratio_20: 1.4,
      premium_rate: -0.02,
      net_inflow_yi: 30.5,
      amount: 20_0000_0000,
      signal_level: 'inflow_only',
    }),
  })
  const growthAddedLater = makeRow({
    code: '588080',
    name: '科创50ETF易方达',
    tier: 'growth',
    sort_order: 180,
    metric: makeMetric({
      code: '588080',
      vol_ratio_20: 2.9,
      premium_rate: 0.25,
      net_inflow_yi: -2.0,
      amount: 10_0000_0000,
      signal_level: 'strong_support',
    }),
  })
  const megaAddedLater = makeRow({
    code: '512050',
    name: 'A500ETF华夏',
    tier: 'mega',
    sort_order: 200,
    metric: null,
  })
  const smallNormal = makeRow({
    code: '512100',
    name: '中证1000ETF南方',
    tier: 'small',
    sort_order: 90,
    metric: makeMetric({
      code: '512100',
      vol_ratio_20: 2.1,
      premium_rate: 0.01,
      net_inflow_yi: 1.0,
      amount: 50_0000_0000,
      signal_level: 'volume_only',
    }),
  })

  const rows = [growthAddedLater, megaAddedLater, smallNormal, mega]

  test('sortEtfRows default orders by tier then sort_order regardless of input order', () => {
    expect(sortEtfRows(rows, 'default').map(r => r.code)).toEqual([
      '510050',
      '512050',
      '512100',
      '588080',
    ])
  })

  test('sortEtfRows metric sorts descending with null metrics at bottom', () => {
    expect(sortEtfRows(rows, 'vol_ratio_20').map(r => r.code)).toEqual([
      '588080',
      '512100',
      '510050',
      '512050',
    ])
    expect(sortEtfRows(rows, 'premium_rate').map(r => r.code)).toEqual([
      '588080',
      '512100',
      '510050',
      '512050',
    ])
    expect(sortEtfRows(rows, 'net_inflow_yi').map(r => r.code)).toEqual([
      '510050',
      '512100',
      '588080',
      '512050',
    ])
    expect(sortEtfRows(rows, 'amount').map(r => r.code)).toEqual([
      '512100',
      '510050',
      '588080',
      '512050',
    ])
  })

  test('matchesEtfFilter, filterEtfCounts and matchesEtfQuery', () => {
    expect(ETF_FILTERS.map(f => f.key)).toEqual(['all', 'active', 'mega', 'mid', 'small', 'growth'])
    expect(matchesEtfFilter(mega, 'active')).toBe(true)
    expect(matchesEtfFilter(megaAddedLater, 'active')).toBe(false)
    expect(matchesEtfFilter(makeRow({ metric: makeMetric({ signal_level: 'normal' }) }), 'active')).toBe(false)
    expect(matchesEtfFilter(growthAddedLater, 'growth')).toBe(true)

    expect(filterEtfCounts(rows)).toEqual({
      all: 4,
      active: 3,
      mega: 2,
      mid: 0,
      small: 1,
      growth: 1,
    })

    expect(matchesEtfQuery(mega, '5100')).toBe(true)
    expect(matchesEtfQuery(mega, '上证50')).toBe(true)
    expect(matchesEtfQuery(mega, '300')).toBe(false)
    expect(matchesEtfQuery(mega, '  ')).toBe(true)
  })

  test('computeMarketCapYi, computeTurnoverRate, computeBoardTotalCapYi and size/turnover sorts', () => {
    // 100亿份 * 4.04元 = 404亿元；成交40.5亿 -> 换手率约 10.02%
    const m = makeMetric({ total_shares: 100_0000_0000, nav: 4.04, close: 4.05, amount: 40_5000_0000 })
    expect(computeMarketCapYi(m)).toBeCloseTo(404, 2)
    expect(computeTurnoverRate(m)).toBeCloseTo((40.5 / 404) * 100, 2)

    const fallbackClose = makeMetric({ total_shares: 50_0000_0000, nav: null, close: 2.0, amount: 5_0000_0000 })
    expect(computeMarketCapYi(fallbackClose)).toBeCloseTo(100, 2)
    expect(computeTurnoverRate(fallbackClose)).toBeCloseTo(5, 2)

    const noShares = makeMetric({ total_shares: null })
    expect(computeMarketCapYi(noShares)).toBeNull()
    expect(computeTurnoverRate(noShares)).toBeNull()
    expect(computeMarketCapYi(null)).toBeNull()

    const rLarge = makeRow({
      code: '510300',
      metric: makeMetric({ total_shares: 500_0000_0000, nav: 4.0, amount: 20_0000_0000 }), // cap 2000亿, turnover 1%
      perf: { return_5d: 1.5, return_10d: 4.0, return_since: 2.0, cap_delta_yi: -12.3 },
    })
    const rHot = makeRow({
      code: '159952',
      metric: makeMetric({ total_shares: 100_0000_0000, nav: 2.0, amount: 50_0000_0000 }),   // cap 200亿, turnover 25%
      perf: { return_5d: 5.2, return_10d: -1.5, return_since: 8.4, cap_delta_yi: 24.5 },
    })
    const rEmpty = makeRow({
      code: '159915',
      metric: makeMetric({ total_shares: null, amount: 10_0000_0000 }),
      perf: { return_5d: null, return_10d: null, return_since: null, cap_delta_yi: null },
    })

    expect(sortEtfRows([rHot, rEmpty, rLarge], 'market_cap_yi').map(r => r.code)).toEqual(['510300', '159952', '159915'])
    expect(sortEtfRows([rLarge, rEmpty, rHot], 'cap_delta_yi').map(r => r.code)).toEqual(['159952', '510300', '159915'])
    expect(sortEtfRows([rLarge, rEmpty, rHot], 'turnover_rate').map(r => r.code)).toEqual(['159952', '510300', '159915'])
    expect(sortEtfRows([rLarge, rEmpty, rHot], 'return_5d').map(r => r.code)).toEqual(['159952', '510300', '159915'])
    expect(sortEtfRows([rHot, rEmpty, rLarge], 'return_10d').map(r => r.code)).toEqual(['510300', '159952', '159915'])
    expect(sortEtfRows([rLarge, rEmpty, rHot], 'return_since').map(r => r.code)).toEqual(['159952', '510300', '159915'])
    expect(computeBoardTotalCapYi([rLarge, rHot, rEmpty])).toEqual({
      totalCapYi: 2200,
      coveredAmountYi: 70,
      coveredCount: 2,
    })
  })
})
