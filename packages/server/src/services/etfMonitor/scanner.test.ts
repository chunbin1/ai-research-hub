import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSiteSettingsTable } from '../siteSettingsStore.js'
import {
  initEtfMonitorTables, getExistingMetricsForCode, getBoardByDate, updateUniverseEntry, upsertDailyMetrics,
} from '../etfMonitorStore.js'
import { scanEtfMonitor, getEtfParams, setEtfParams, recomputeAllEtfSummaries } from './scanner.js'
import { DEFAULT_ETF_PARAMS } from './metrics.js'
import type { EtfKlineBar } from '../market/etfClient.js'

function build22Bars(endDate: string, lastAmount = 10e8): EtfKlineBar[] {
  // 生成 22 个工作日，最后一个日期精确等于 endDate
  const dates = [
    '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23',
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30',
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
    '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
    '2026-11-16', '2026-11-17',
  ]
  if (endDate === '2026-11-18') dates.push('2026-11-18')
  return dates.map((d, idx) => ({
    tradeDate: d,
    open: 1.4,
    close: d === '2026-11-17' ? 1.42 : 1.4,
    high: 1.43,
    low: 1.38,
    volume: 1e9,
    amount: d === '2026-11-17' ? lastAmount : (idx === dates.length - 1 ? 3e8 : 10e8),
    pctChange: 0,
  }))
}

function setupDb() {
  const db = new Database(':memory:')
  initSiteSettingsTable(db)
  initEtfMonitorTables(db)
  return db
}

test('盘中（< 15:00 北京时间）过滤未收盘当日 K 线，并把 T+1 深市开盘前份额归属到上一交易日 T-1', async () => {
  setupDb()
  const summary = await scanEtfMonitor({ codes: ['159952', '510300'] }, {
    now: () => new Date('2026-11-18T02:30:00Z'), // 北京时间 10:30
    fetchKlines: async (code) => ({ name: code, bars: build22Bars('2026-11-18', 25e8) }),
    fetchNavs: async () => ({ '2026-11-16': 1.4, '2026-11-17': 1.4015 }),
    fetchRealtimeBatch: async () => ({
      '159952': { code: '159952', name: '创业板广发', price: 1.41, amount: 3e8, totalShares: 141.66e8, iopv: 1.41 },
      '510300': { code: '510300', name: '300ETF', price: 4.05, amount: 3e8, totalShares: 483.43e8, iopv: 4.05 },
    }),
    fetchSseShares: async (dt): Promise<Record<string, number>> =>
      dt === '2026-11-17' ? { '510300': 483.43e8 } : dt === '2026-11-16' ? { '510300': 470.01e8 } : {},
    fetchSzseShares: async () => ({ snapshotDate: '2026-11-18', totalShares: 141.66e8 }),
  })

  assert.equal(summary.ok, 2)
  assert.equal(summary.latestDate, '2026-11-17')
  const sz = getExistingMetricsForCode('159952')
  assert.equal(sz.some(m => m.trade_date === '2026-11-18'), false)
  const d17 = sz.find(m => m.trade_date === '2026-11-17')
  assert.equal(d17?.total_shares, 141.66e8)
  assert.equal(d17?.share_source, 'snapshot')
})

test('收盘后 15:10 仅拿 IOPV 写入估算溢价（且不误写深市当日 f38），20:00 官方净值覆盖为 official', async () => {
  setupDb()
  // 15:10 初扫
  await scanEtfMonitor({ codes: ['159952'] }, {
    now: () => new Date('2026-11-17T07:10:00Z'), // 北京时间 15:10
    fetchKlines: async () => ({ name: '创业板广发', bars: build22Bars('2026-11-17', 25e8) }),
    fetchNavs: async () => ({ '2026-11-16': 1.4 }), // 17日官方净值未出
    fetchRealtimeBatch: async () => ({
      '159952': { code: '159952', name: '创业板广发', price: 1.42, amount: 25e8, totalShares: 140e8, iopv: 1.41 },
    }),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => ({ snapshotDate: '2026-11-17', totalShares: 140e8 }),
  })
  let m17 = getExistingMetricsForCode('159952').find(x => x.trade_date === '2026-11-17')!
  assert.equal(m17.nav_source, 'iopv')
  assert.equal(m17.nav, 1.41)
  // 当天 15:10 的 snapshotDate === '2026-11-17'，反映的是 16 日期末，不可写成 17 日期末
  assert.equal(m17.total_shares, null)

  // 20:00 官方净值公布后重扫
  await scanEtfMonitor({ codes: ['159952'] }, {
    now: () => new Date('2026-11-17T12:00:00Z'), // 北京时间 20:00
    fetchKlines: async () => ({ name: '创业板广发', bars: build22Bars('2026-11-17', 25e8) }),
    fetchNavs: async () => ({ '2026-11-16': 1.4, '2026-11-17': 1.4015 }),
    fetchRealtimeBatch: async () => ({
      '159952': { code: '159952', name: '创业板广发', price: 1.42, amount: 25e8, totalShares: 140e8, iopv: 1.41 },
    }),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => ({ snapshotDate: '2026-11-17', totalShares: 140e8 }),
  })
  m17 = getExistingMetricsForCode('159952').find(x => x.trade_date === '2026-11-17')!
  assert.equal(m17.nav_source, 'official')
  assert.equal(m17.nav, 1.4015)
})

test('调整阈值与停用标的后重算全库历史状态与汇总', async () => {
  setupDb()
  await scanEtfMonitor({ codes: ['510300', '510500'] }, {
    now: () => new Date('2026-11-17T12:00:00Z'),
    fetchKlines: async (code) => ({ name: code, bars: build22Bars('2026-11-17', 25e8) }),
    fetchNavs: async () => ({ '2026-11-17': 1.40 }),
    fetchRealtimeBatch: async () => ({}),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => null,
  })
  // 25e8 / 10e8 = 2.5x，默认阈值 1.8x 触发；提高到 3.0x 后回落为 normal
  setEtfParams({ volRatioThreshold: 3.0 })
  recomputeAllEtfSummaries('2026-11-18T00:00:00Z')
  const m17 = getExistingMetricsForCode('510300').find(x => x.trade_date === '2026-11-17')!
  assert.equal(m17.signal_level, 'normal')

  updateUniverseEntry('510300', { enabled: false })
  recomputeAllEtfSummaries('2026-11-18T00:00:00Z')
  const board = getBoardByDate('2026-11-17')
  assert.equal(board.summary?.active_count, 17)
})

test('空库未保存设置时 getEtfParams 返回默认阈值而非 0；显式保存 0 时保留 0', () => {
  setupDb()
  assert.deepEqual(getEtfParams(), DEFAULT_ETF_PARAMS)

  setEtfParams({ premiumThreshold: 0, inflowThresholdYi: 0 })
  assert.deepEqual(getEtfParams(), {
    volRatioThreshold: DEFAULT_ETF_PARAMS.volRatioThreshold,
    premiumThreshold: 0,
    inflowThresholdYi: 0,
  })
})

test('增量扫描若新窗口首根 bar 的 pctChange 为 null，保留库里已有的 pct_change', async () => {
  setupDb()
  const initialBars = build22Bars('2026-11-17', 20e8).map(b =>
    b.tradeDate === '2026-11-16' ? { ...b, pctChange: 1.55 } : b,
  )
  await scanEtfMonitor({ codes: ['510300'] }, {
    now: () => new Date('2026-11-17T12:00:00Z'),
    fetchKlines: async () => ({ name: '300ETF', bars: initialBars }),
    fetchNavs: async () => ({}),
    fetchRealtimeBatch: async () => ({}),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => null,
  })

  // 增量扫描仅拉到以 2026-11-16 为首根（pctChange = null）的两天数据
  const incrementalBars: EtfKlineBar[] = [
    { tradeDate: '2026-11-16', open: 1.4, close: 1.4, high: 1.43, low: 1.38, volume: 1e9, amount: 10e8, pctChange: null },
    { tradeDate: '2026-11-17', open: 1.4, close: 1.42, high: 1.43, low: 1.38, volume: 1e9, amount: 20e8, pctChange: 1.43 },
  ]
  await scanEtfMonitor({ codes: ['510300'] }, {
    now: () => new Date('2026-11-17T12:05:00Z'),
    fetchKlines: async () => ({ name: '300ETF', bars: incrementalBars }),
    fetchNavs: async () => ({}),
    fetchRealtimeBatch: async () => ({}),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => null,
  })

  const d16 = getExistingMetricsForCode('510300').find(x => x.trade_date === '2026-11-16')!
  assert.equal(d16.pct_change, 1.55)
})

test('深交所接口明确返回 snapshotDate <= T 时，早盘不可再用东财 f38 兜底误写到 T 日', async () => {
  setupDb()
  await scanEtfMonitor({ codes: ['159952'] }, {
    now: () => new Date('2026-11-18T00:15:00Z'), // 北京时间 08:15（盘前，尚未结算更新）
    fetchKlines: async () => ({ name: '创业板广发', bars: build22Bars('2026-11-17', 20e8) }),
    fetchNavs: async () => ({ '2026-11-17': 1.4015 }),
    fetchRealtimeBatch: async () => ({
      '159952': { code: '159952', name: '创业板广发', price: 1.41, amount: 20e8, totalShares: 140e8, iopv: 1.41 },
    }),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => ({ snapshotDate: '2026-11-17', totalShares: 140e8 }),
  })

  const d17 = getExistingMetricsForCode('159952').find(x => x.trade_date === '2026-11-17')!
  assert.equal(d17.total_shares, null)
  assert.equal(d17.share_source, null)
})

test('漏掉晨扫时，18日盘后扫描仍能按 dqgm 所属日期把仍有效的昨日(17日)深市份额补写入17日', async () => {
  setupDb()
  await scanEtfMonitor({ codes: ['159952'] }, {
    now: () => new Date('2026-11-18T12:00:00Z'), // 18日 20:00 收盘后（18日已收盘，漏掉了 08:45 晨扫）
    fetchKlines: async () => ({ name: '创业板广发', bars: build22Bars('2026-11-18', 25e8) }),
    fetchNavs: async () => ({ '2026-11-17': 1.4015, '2026-11-18': 1.405 }),
    fetchRealtimeBatch: async () => ({
      '159952': { code: '159952', name: '创业板广发', price: 1.41, amount: 3e8, totalShares: 141.66e8, iopv: 1.41 },
    }),
    fetchSseShares: async () => ({}),
    fetchSzseShares: async () => ({ snapshotDate: '2026-11-18', shareDate: '2026-11-17', totalShares: 141.66e8 }),
  })

  const rows = getExistingMetricsForCode('159952')
  const d17 = rows.find(x => x.trade_date === '2026-11-17')!
  const d18 = rows.find(x => x.trade_date === '2026-11-18')!
  assert.equal(d17.total_shares, 141.66e8)
  assert.equal(d17.share_source, 'snapshot')
  assert.equal(d18.total_shares, null)
})

test('长期停用后恢复启用时按历史缺口自动扩大 K 线/净值/上交所份额回溯窗口', async () => {
  setupDb()
  // 模拟 510300 早在 2026-08-20 之后就停用，库里仅有 2026-08-20 这一条老数据
  upsertDailyMetrics([{
    code: '510300', trade_date: '2026-08-20', open: 4.0, close: 4.0, pct_change: 0,
    volume: 1e9, amount: 10e8, vol_ratio_5: null, vol_ratio_20: null,
    nav: 4.0, nav_source: 'official', premium_rate: 0,
    total_shares: 400e8, share_source: 'sse_history', share_delta: null, net_inflow_yi: null,
    signal_level: 'normal', updated_at: '2026-08-20T12:00:00Z',
  }])

  // 生成从 2026-08-21 到 2026-11-17 共约 60 个工作日的模拟 K 线
  const gapDates: string[] = []
  for (let d = new Date('2026-08-21T00:00:00Z'); d <= new Date('2026-11-17T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) gapDates.push(d.toISOString().slice(0, 10))
  }

  let seenBegYmd = ''
  let seenNavPages = 0
  const seenSseDates: string[] = []

  await scanEtfMonitor({ codes: ['510300'] }, {
    now: () => new Date('2026-11-17T12:00:00Z'),
    fetchKlines: async (_code, _mkt, begYmd) => {
      seenBegYmd = begYmd
      return {
        name: '300ETF',
        bars: gapDates.map(dt => ({
          tradeDate: dt, open: 4.0, close: 4.05, high: 4.1, low: 3.95, volume: 1e9, amount: 12e8, pctChange: 0.2,
        })),
      }
    },
    fetchNavs: async (_code, pages) => {
      seenNavPages = pages ?? 1
      return {}
    },
    fetchRealtimeBatch: async () => ({}),
    fetchSseShares: async (dt): Promise<Record<string, number>> => {
      seenSseDates.push(dt)
      return { '510300': 410e8 }
    },
    fetchSzseShares: async () => null,
  })

  // 缺口约 89 个自然日（> 60 个交易日），K 线起始日期须覆盖回 2026-08-20 之前，净值翻页 > 1，上交所份额回溯远超 5 天
  assert.ok(seenBegYmd <= '20260820', `expected begYmd <= 20260820, got ${seenBegYmd}`)
  assert.ok(seenNavPages >= 3, `expected navPages >= 3, got ${seenNavPages}`)
  assert.ok(seenSseDates.length >= 50, `expected >= 50 SSE dates for ~60d gap, got ${seenSseDates.length}`)
})
