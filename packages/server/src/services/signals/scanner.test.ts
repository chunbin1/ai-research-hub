import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initWatchlistTable, addWatchlistEntry, listWatchlist, setWatchlistEnabled } from '../watchlistStore.ts'
import { initSignalTables, getLatestState, getStates, getLatestEvent } from '../signalStore.ts'
import { initSiteSettingsTable, getSetting, setSetting } from '../siteSettingsStore.ts'
import { YahooError, type QuoteSeries } from '../market/yahooClient.ts'
import { scanAll, getSignalParams, isSignalsEnabled, LAST_SCAN_KEY } from './scanner.ts'

/**
 * 900 根合成日线(自然日,含周末):前 450 根从 100 涨到 144.9,后 450 根跌回 100.1。
 * 900 天是为了让**聚合后的周线也过 120 根门槛** —— 聚合出 129 根周线,
 * 减去预热 9 根 = 120 个输出点。日线与周线各产生恰好 1 次翻转。
 *
 * ⚠️ 起点定在 2024-02-27,是为了让整段序列**结束于过去**(末根 2026-08-14)。
 * `toWeekly` 会丢弃「今天所在的那一周」;如果序列跨过今天,被丢的就是序列
 * **中间**的一周而不是末尾,周线凭空少一根,断言随真实日期漂移。
 * 序列整体落在过去,今天再往后走也不会命中任何一组,断言才是确定的。
 */
function fakeSeries(symbol: string): QuoteSeries {
  const bars = []
  const rawClose: Record<string, number> = {}
  for (let i = 0; i < 900; i++) {
    const close = Number((i < 450 ? 100 + i * 0.1 : 145 - (i - 450) * 0.1).toFixed(4))
    const date = new Date(Date.UTC(2024, 1, 27) + i * 86400000).toISOString().slice(0, 10)
    bars.push({ date, high: close + 1, low: close - 1, close })
    rawClose[date] = close * 2      // 刻意与复权价不同,验证展示价走的是这一路
  }
  return { symbol, name: `${symbol} Inc`, currency: 'USD', bars, rawClose }
}

beforeEach(() => {
  const db = new Database(':memory:')
  initWatchlistTable(db)
  initSignalTables(db)
  initSiteSettingsTable(db)
})

test('参数默认 10 / 3.0,可被 site_settings 覆盖', () => {
  assert.deepEqual(getSignalParams(), { period: 10, mult: 3 })
  setSetting('signals.atr_period', '14')
  setSetting('signals.atr_mult', '2.5')
  assert.deepEqual(getSignalParams(), { period: 14, mult: 2.5 })
  setSetting('signals.atr_period', '不是数字')
  assert.equal(getSignalParams().period, 10)       // 非法值回落默认
  setSetting('signals.atr_period', '1')
  assert.equal(getSignalParams().period, 10)       // period 必须 >= 2,否则引擎算不出 ATR
})

test('SIGNALS=off 关闭整个功能', () => {
  const saved = process.env.SIGNALS
  try {
    delete process.env.SIGNALS
    assert.equal(isSignalsEnabled(), true)
    process.env.SIGNALS = 'off'
    assert.equal(isSignalsEnabled(), false)
    process.env.SIGNALS = 'on'
    assert.equal(isSignalsEnabled(), true)
  } finally {
    if (saved === undefined) delete process.env.SIGNALS
    else process.env.SIGNALS = saved
  }
})

test('扫描后日线与周线都落库,展示价用原始收盘', async () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  const summary = await scanAll({ fetchQuotes: async (s) => fakeSeries(s) })
  assert.deepEqual(summary, { total: 1, ok: 1, failed: 0, insufficient: 0 })

  const daily = getLatestState('ALB', '1d')!
  const weekly = getLatestState('ALB', '1wk')!
  assert.ok(daily && weekly)
  assert.equal(daily.close_raw, daily.close_adj * 2)      // rawClose 那一路
  assert.equal(getStates('ALB', '1wk', 999).length, 120)  // 129 根周线 - (period-1)
  assert.ok(getLatestEvent('ALB', '1d'))                  // 有翻转事件
  assert.ok(getLatestEvent('ALB', '1wk'))

  const entry = listWatchlist()[0]
  assert.equal(entry.name, 'ALB Inc')
  assert.equal(entry.currency, 'USD')
  assert.equal(entry.status, 'ok')
  assert.equal(entry.last_error, null)
  assert.ok(getSetting(LAST_SCAN_KEY))
})

test('重复扫描幂等', async () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  const fetchQuotes = async (s: string) => fakeSeries(s)
  await scanAll({ fetchQuotes })
  const first = getStates('ALB', '1d', 999)
  await scanAll({ fetchQuotes })
  await scanAll({ fetchQuotes })
  assert.deepEqual(getStates('ALB', '1d', 999), first)
})

test('单只票失败不影响其他票', async () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  addWatchlistEntry({ symbol: 'BAD', market: 'US', sourceDoc: 'd', sourceText: 't' })
  const summary = await scanAll({
    fetchQuotes: async (s) => {
      if (s === 'BAD') throw new YahooError('被限流', 'rate_limited')
      return fakeSeries(s)
    },
  })
  assert.deepEqual(summary, { total: 2, ok: 1, failed: 1, insufficient: 0 })
  assert.ok(getLatestState('ALB', '1d'))
  const bad = listWatchlist().find(e => e.symbol === 'BAD')!
  assert.equal(bad.last_error, '被限流')
  assert.equal(bad.status, 'ok')          // 限流不是永久失败,下次还扫
})

test('404 标记 invalid,之后不再扫描', async () => {
  addWatchlistEntry({ symbol: 'NOPE', market: 'US', sourceDoc: 'd', sourceText: 't' })
  let calls = 0
  const fetchQuotes = async (s: string) => {
    calls++
    throw new YahooError(`${s}: 代码不存在`, 'not_found')
  }
  await scanAll({ fetchQuotes })
  assert.equal(listWatchlist()[0].status, 'invalid')
  await scanAll({ fetchQuotes })
  assert.equal(calls, 1)                  // 第二次没再请求
})

test('日线数据不足标记 insufficient 且不写信号', async () => {
  addWatchlistEntry({ symbol: 'NEW', market: 'US', sourceDoc: 'd', sourceText: 't' })
  const summary = await scanAll({
    fetchQuotes: async (s) => ({ ...fakeSeries(s), bars: fakeSeries(s).bars.slice(0, 50) }),
  })
  assert.deepEqual(summary, { total: 1, ok: 0, failed: 0, insufficient: 1 })
  assert.equal(listWatchlist()[0].status, 'insufficient')
  assert.equal(getLatestState('NEW', '1d'), null)
})

test('曾经正常的票后来数据变短:两个周期的 states 与 events 都被清空', async () => {
  // 上一条测试用的是全新标的,本来就没有历史行 —— 把清空周线的两行删掉它照样绿。
  // 真正要防的是这个场景:先扫成 ok 填满两个周期,数据源缩水后必须连周线一起清干净,
  // 否则看板上会留着一份再也不会更新的陈旧周线信号。
  addWatchlistEntry({ symbol: 'SHRANK', market: 'US', sourceDoc: 'd', sourceText: 't' })
  await scanAll({ fetchQuotes: async (s) => fakeSeries(s) })
  assert.ok(getLatestState('SHRANK', '1d'))
  assert.ok(getLatestState('SHRANK', '1wk'))
  assert.ok(getLatestEvent('SHRANK', '1d'))
  assert.ok(getLatestEvent('SHRANK', '1wk'))

  await scanAll({
    fetchQuotes: async (s) => ({ ...fakeSeries(s), bars: fakeSeries(s).bars.slice(0, 50) }),
  })
  assert.equal(listWatchlist().find(e => e.symbol === 'SHRANK')!.status, 'insufficient')
  assert.equal(getLatestState('SHRANK', '1d'), null)
  assert.equal(getLatestState('SHRANK', '1wk'), null)
  assert.equal(getLatestEvent('SHRANK', '1d'), null)
  assert.equal(getLatestEvent('SHRANK', '1wk'), null)
})

test('曾经正常的票后来 404:标记 invalid 且两个周期的 states/events 都被清空', async () => {
  // 退市 / 改代码 / 被合并的票会一直 404。若不清空,catch 分支只更新 watchlist 的
  // status,daily_states / signal_events 里上一次扫描留下的行会永远留在库里 ——
  // 看板渲染一个再也不会变的冻结趋势标签,冻结的翻转还可能混进「最近 7 天信号」横幅。
  addWatchlistEntry({ symbol: 'DEAD', market: 'US', sourceDoc: 'd', sourceText: 't' })
  await scanAll({ fetchQuotes: async (s) => fakeSeries(s) })
  assert.ok(getLatestState('DEAD', '1d'))
  assert.ok(getLatestState('DEAD', '1wk'))
  assert.ok(getLatestEvent('DEAD', '1d'))
  assert.ok(getLatestEvent('DEAD', '1wk'))

  await scanAll({
    fetchQuotes: async (s) => { throw new YahooError(`${s}: 代码不存在`, 'not_found') },
  })
  assert.equal(listWatchlist().find(e => e.symbol === 'DEAD')!.status, 'invalid')
  assert.equal(getLatestState('DEAD', '1d'), null)
  assert.equal(getLatestState('DEAD', '1wk'), null)
  assert.equal(getLatestEvent('DEAD', '1d'), null)
  assert.equal(getLatestEvent('DEAD', '1wk'), null)
})

test('scanAll 有进程内并发闸门:重叠调用只实际扫一遍', async () => {
  // 前端 scanning 标志是每个标签页各自的状态,拦不住两个标签页或手动扫描撞上 cron。
  // 没有这道闸,两次几乎同时发起的 scanAll 会把 fetchQuotes 的调用量直接翻倍。
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  let calls = 0
  const fetchQuotes = async (s: string) => { calls++; return fakeSeries(s) }

  const p1 = scanAll({ fetchQuotes })
  const p2 = scanAll({ fetchQuotes })
  const [r1, r2] = await Promise.all([p1, p2])

  assert.equal(calls, 1)              // 第二次没有再触发一轮请求
  assert.deepEqual(r1, r2)            // 两次调用拿到同一份结果
  assert.deepEqual(r1, { total: 1, ok: 1, failed: 0, insufficient: 0 })
})

test('日线够但周线不够时:日线照出,周线留空,状态仍是 ok', async () => {
  // 300 个自然日 → 日线 300 根(够),聚合出 43 根周线(不够)
  addWatchlistEntry({ symbol: 'YOUNG', market: 'US', sourceDoc: 'd', sourceText: 't' })
  const summary = await scanAll({
    fetchQuotes: async (s) => ({ ...fakeSeries(s), bars: fakeSeries(s).bars.slice(0, 300) }),
  })
  assert.deepEqual(summary, { total: 1, ok: 1, failed: 0, insufficient: 0 })
  assert.equal(listWatchlist()[0].status, 'ok')
  assert.ok(getLatestState('YOUNG', '1d'))
  assert.equal(getLatestState('YOUNG', '1wk'), null)
})

test('禁用的票不扫描', async () => {
  addWatchlistEntry({ symbol: 'ALB', market: 'US', sourceDoc: 'd', sourceText: 't' })
  setWatchlistEnabled('ALB', false)
  const summary = await scanAll({ fetchQuotes: async () => { throw new Error('不该被调用') } })
  assert.deepEqual(summary, { total: 0, ok: 0, failed: 0, insufficient: 0 })
})
