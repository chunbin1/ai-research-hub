import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fastify from 'fastify'

process.env.AUTH_DISABLED = 'true'
delete process.env.ETF_MONITOR

const { initSiteSettingsTable } = await import('../services/siteSettingsStore.ts')
const {
  initEtfMonitorTables, upsertDailyMetrics, upsertDailySummaries,
} = await import('../services/etfMonitorStore.ts')
const { etfMonitorRoutes } = await import('./etfMonitor.ts')

async function freshApp(opts?: {
  scanCalls?: Array<{ backfillDays?: number; codes?: string[] }>
  probeResult?: { code: string; market: 'SH' | 'SZ'; name: string } | null
  probeError?: Error
}) {
  const db = new Database(':memory:')
  initSiteSettingsTable(db)
  initEtfMonitorTables(db)
  const app = fastify()
  await app.register(etfMonitorRoutes, {
    prefix: '/api',
    scan: (async (o = {}) => {
      opts?.scanCalls?.push(o)
      return { total: 1, ok: 1, failed: 0, latestDate: '2026-11-17' }
    }) as never,
    probe: (async (code: string) => {
      if (opts?.probeError) throw opts.probeError
      if (opts && 'probeResult' in opts) return opts.probeResult ?? null
      return code === '510350' ? { code: '510350', market: 'SH', name: '沪深300ETF工银' } : null
    }) as never,
  })
  await app.ready()
  return { app, db }
}

function seedSampleDay() {
  upsertDailyMetrics([
    {
      code: '510300', trade_date: '2026-11-17', open: 4.0, close: 4.042, pct_change: -0.5,
      volume: 2e9, amount: 81.15e8, vol_ratio_5: 1.57, vol_ratio_20: 2.1,
      nav: 4.0513, nav_source: 'official', premium_rate: 0.1,
      total_shares: 483.43e8, share_source: 'sse_history', share_delta: 1.34e8, net_inflow_yi: 54.4,
      signal_level: 'strong_support', updated_at: '2026-11-18T00:00:00Z',
    },
    {
      code: '510500', trade_date: '2026-11-17', open: 6.3, close: 6.317, pct_change: -0.6,
      volume: 6e8, amount: 40.94e8, vol_ratio_5: 1.1, vol_ratio_20: 1.1,
      nav: 6.3192, nav_source: 'official', premium_rate: -0.03,
      total_shares: 94.58e8, share_source: 'sse_history', share_delta: 0.39e8, net_inflow_yi: 24.4,
      signal_level: 'inflow_only', updated_at: '2026-11-18T00:00:00Z',
    },
  ])
  upsertDailySummaries([
    {
      trade_date: '2026-11-17', resonance_level: 'strong', active_count: 18,
      volume_spike_count: 1, support_etf_count: 2, support_tier_count: 2,
      total_amount_yi: 122.09, aggregate_vol_ratio: 1.4, total_net_inflow_yi: 78.8,
      data_stage: 'partial_shares', updated_at: '2026-11-18T00:00:00Z',
    },
  ])
}

test('GET /etf/board, /timeline, /:code/history 返回完整结构', async () => {
  const { app } = await freshApp()
  seedSampleDay()

  const boardRes = await app.inject({ method: 'GET', url: '/api/etf/board' })
  assert.equal(boardRes.statusCode, 200)
  const board = boardRes.json()
  assert.equal(board.summary.trade_date, '2026-11-17')
  assert.equal(board.rows.length, 18)
  assert.equal(board.disabledUniverse.length, 0)
  assert.equal(board.rows.find((r: { code: string }) => r.code === '510300').metric.net_inflow_yi, 54.4)

  const tlRes = await app.inject({ method: 'GET', url: '/api/etf/timeline?days=90' })
  assert.equal(tlRes.statusCode, 200)
  assert.equal(tlRes.json().days.length, 1)

  const histRes = await app.inject({ method: 'GET', url: '/api/etf/510300/history?days=60' })
  assert.equal(histRes.statusCode, 200)
  assert.equal(histRes.json().code, '510300')
  assert.equal(histRes.json().history.length, 1)
})

test('POST /etf/universe 校验合法性、去重并触发单标的回溯；PATCH / DELETE 同步重算汇总', async () => {
  const scanCalls: Array<{ backfillDays?: number; codes?: string[] }> = []
  const { app } = await freshApp({ scanCalls })
  seedSampleDay()

  const bad = await app.inject({ method: 'POST', url: '/api/etf/universe', payload: { code: '600519', tier: 'mega' } })
  assert.equal(bad.statusCode, 400)

  const nonString = await app.inject({ method: 'POST', url: '/api/etf/universe', payload: { code: 510350, tier: 'mega' } })
  assert.equal(nonString.statusCode, 400)

  const dup = await app.inject({ method: 'POST', url: '/api/etf/universe', payload: { code: '510300', tier: 'mega' } })
  assert.equal(dup.statusCode, 409)

  const add = await app.inject({ method: 'POST', url: '/api/etf/universe', payload: { code: '510350', tier: 'mega' } })
  assert.equal(add.statusCode, 200)
  assert.equal(add.json().entry.code, '510350')
  assert.deepEqual(scanCalls[0]?.codes, ['510350'])

  // 停用 510300 后应进入 disabledUniverse 且重算 summary.active_count
  const disable = await app.inject({ method: 'PATCH', url: '/api/etf/universe/510300', payload: { enabled: false } })
  assert.equal(disable.statusCode, 200)
  const afterDisable = (await app.inject({ method: 'GET', url: '/api/etf/board' })).json()
  assert.equal(afterDisable.disabledUniverse.length, 1)
  assert.equal(afterDisable.disabledUniverse[0].code, '510300')
  assert.equal(afterDisable.summary.active_count, 18) // 19 - 1

  // 重新启用时触发该标的补扫
  const enable = await app.inject({ method: 'PATCH', url: '/api/etf/universe/510300', payload: { enabled: true } })
  assert.equal(enable.statusCode, 200)
  assert.deepEqual(scanCalls[1]?.codes, ['510300'])

  const del = await app.inject({ method: 'DELETE', url: '/api/etf/universe/510350' })
  assert.equal(del.statusCode, 200)
})

test('PATCH /etf/params 校验并立即重算历史信号与汇总', async () => {
  const { app } = await freshApp()
  seedSampleDay()

  const bad = await app.inject({ method: 'PATCH', url: '/api/etf/params', payload: { volRatioThreshold: 0 } })
  assert.equal(bad.statusCode, 400)

  const res = await app.inject({
    method: 'PATCH',
    url: '/api/etf/params',
    payload: { volRatioThreshold: 3.0, inflowThresholdYi: 60 },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().params.volRatioThreshold, 3.0)
  const board = (await app.inject({ method: 'GET', url: '/api/etf/board' })).json()
  // 510300(54.4亿) 与 510500(24.4亿) 均低于 60 亿且放量 2.1 < 3.0，回落为 normal
  assert.equal(board.rows.find((r: { code: string }) => r.code === '510300').metric.signal_level, 'normal')
})

test('POST /etf/universe 在上游探测异常时返回 502 而非 500', async () => {
  const { app } = await freshApp({ probeError: new Error('upstream timeout') })
  const res = await app.inject({ method: 'POST', url: '/api/etf/universe', payload: { code: '510350', tier: 'mega' } })
  assert.equal(res.statusCode, 502)
})

test('GET /etf/board 返回每只 ETF 的 5日/10日涨幅，历史日期额外返回距今涨幅', async () => {
  const { app } = await freshApp()
  // 插入连续 12 个交易日（day 1..12），收盘价分别为 1.00 .. 1.11，便于验证 T-5 / T-10 / 距今涨幅
  const dates = [
    '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
    '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
    '2026-11-16', '2026-11-17',
  ]
  upsertDailyMetrics(dates.map((d, idx) => ({
    code: '510300',
    trade_date: d,
    open: 1 + idx * 0.01,
    close: Number((1 + idx * 0.01).toFixed(4)),
    pct_change: 0.5,
    volume: 1e8,
    amount: 10e8,
    vol_ratio_5: 1.0,
    vol_ratio_20: null,
    nav: Number((1 + idx * 0.01).toFixed(4)),
    nav_source: 'official',
    premium_rate: 0,
    total_shares: 100e8,
    share_source: 'sse_history',
    share_delta: 0,
    net_inflow_yi: 0,
    signal_level: 'normal',
    updated_at: '2026-11-18T00:00:00Z',
  })))
  upsertDailySummaries(dates.map(d => ({
    trade_date: d,
    resonance_level: 'none',
    active_count: 18,
    volume_spike_count: 0,
    support_etf_count: 0,
    support_tier_count: 0,
    total_amount_yi: 10,
    aggregate_vol_ratio: null,
    total_net_inflow_yi: 0,
    data_stage: 'partial_shares',
    updated_at: '2026-11-18T00:00:00Z',
  })))

  // 最新日 2026-11-17 (idx=11, close=1.11): T-5 是 1.06 (+4.72%), T-10 是 1.01 (+9.90%), 距今为 null
  const latestRes = await app.inject({ method: 'GET', url: '/api/etf/board' })
  const latestRow = latestRes.json().rows.find((r: { code: string }) => r.code === '510300')
  assert.ok(latestRow.perf, 'expected perf object on board row')
  assert.equal(latestRow.perf.return_5d, 4.72)
  assert.equal(latestRow.perf.return_10d, 9.9)
  assert.equal(latestRow.perf.return_since, null)

  // 历史日 2026-11-16 (idx=10, close=1.10): 距最新日 1.11 涨幅 (1.11-1.10)/1.10 = +0.91%
  const histRes = await app.inject({ method: 'GET', url: '/api/etf/board?date=2026-11-16' })
  const histRow = histRes.json().rows.find((r: { code: string }) => r.code === '510300')
  assert.equal(histRow.perf.return_since, 0.91)
})
