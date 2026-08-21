import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchDailyQuotes, YahooError } from './yahooClient.ts'

const DAY = 86400
/** 2026-08-18 13:30 UTC(美股开盘),后续每根 +1 天 */
const T0 = Date.UTC(2026, 7, 18, 13, 30) / 1000

function fakePayload(opts: {
  closes: (number | null)[]
  adj?: (number | null)[]
  regularEnd: number
  regularMarketTime: number
}) {
  const n = opts.closes.length
  return {
    chart: {
      result: [{
        meta: {
          currency: 'USD',
          longName: 'Albemarle Corporation',
          regularMarketTime: opts.regularMarketTime,
          currentTradingPeriod: { regular: { start: 0, end: opts.regularEnd } },
        },
        timestamp: Array.from({ length: n }, (_, i) => T0 + i * DAY),
        indicators: {
          quote: [{
            high: opts.closes.map(c => (c == null ? null : c + 2)),
            low: opts.closes.map(c => (c == null ? null : c - 2)),
            close: opts.closes,
            open: opts.closes,
            volume: opts.closes.map(() => 1000),
          }],
          adjclose: [{ adjclose: opts.adj ?? opts.closes }],
        },
      }],
      error: null,
    },
  }
}

function okFetch(payload: unknown) {
  return async () => new Response(JSON.stringify(payload), { status: 200 })
}

test('解析出 UTC 日期的 OHLC,并带上名称与币种', async () => {
  const payload = fakePayload({
    closes: [100, 101, 102],
    regularEnd: T0 + 2 * DAY + 3600,        // 第三根尚未收盘
    regularMarketTime: T0 + 2 * DAY,
  })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (T0 + 2 * DAY) * 1000,     // 现在处于第三根的盘中
  })
  assert.equal(s.name, 'Albemarle Corporation')
  assert.equal(s.currency, 'USD')
  // 第三根未收盘,被丢弃
  assert.deepEqual(s.bars.map(b => b.date), ['2026-08-18', '2026-08-19'])
})

test('已收盘时保留最后一根', async () => {
  const payload = fakePayload({
    closes: [100, 101, 102],
    regularEnd: T0 + 2 * DAY + 3600,
    regularMarketTime: T0 + 2 * DAY,
  })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (T0 + 2 * DAY + 7200) * 1000,   // 已过收盘时间
  })
  assert.equal(s.bars.length, 3)
  assert.equal(s.bars[2].date, '2026-08-20')
})

test('复权:high/low 乘因子,close 取 adjclose,原始收盘另存', async () => {
  const payload = fakePayload({
    closes: [100, 200],
    adj: [90, 200],                 // 第一根因子 0.9,第二根 1.0
    regularEnd: T0 + DAY + 3600,
    regularMarketTime: T0 + DAY,
  })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (T0 + DAY + 7200) * 1000,
  })
  assert.deepEqual(s.bars[0], { date: '2026-08-18', high: 91.8, low: 88.2, close: 90 })
  assert.deepEqual(s.bars[1], { date: '2026-08-19', high: 202, low: 198, close: 200 })
  assert.equal(s.rawClose['2026-08-18'], 100)   // 展示用的是未复权价
  assert.equal(s.rawClose['2026-08-19'], 200)
})

test('close 为 null 的停牌日整根跳过', async () => {
  const payload = fakePayload({
    closes: [100, null, 102],
    regularEnd: T0 + 2 * DAY + 3600,
    regularMarketTime: T0 + 2 * DAY,
  })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (T0 + 2 * DAY + 7200) * 1000,
  })
  assert.deepEqual(s.bars.map(b => b.date), ['2026-08-18', '2026-08-20'])
})

test('404 抛 not_found,不重试', async () => {
  let calls = 0
  const f = async () => { calls++; return new Response('', { status: 404 }) }
  await assert.rejects(
    () => fetchDailyQuotes('NOPE', { fetchImpl: f as unknown as typeof fetch }),
    (err: unknown) => err instanceof YahooError && err.kind === 'not_found',
  )
  assert.equal(calls, 1)
})

test('429 退避重试 2 次后抛 rate_limited', async () => {
  let calls = 0
  const slept: number[] = []
  const f = async () => { calls++; return new Response('', { status: 429 }) }
  await assert.rejects(
    () => fetchDailyQuotes('ALB', {
      fetchImpl: f as unknown as typeof fetch,
      sleep: async (ms) => { slept.push(ms) },
    }),
    (err: unknown) => err instanceof YahooError && err.kind === 'rate_limited',
  )
  assert.equal(calls, 3)              // 首次 + 重试 2 次
  assert.deepEqual(slept, [1000, 2000])
})

test('429 后重试成功', async () => {
  let calls = 0
  const payload = fakePayload({
    closes: [100, 101],
    regularEnd: T0 + DAY + 3600,
    regularMarketTime: T0 + DAY,
  })
  const f = async () => {
    calls++
    return calls === 1
      ? new Response('', { status: 429 })
      : new Response(JSON.stringify(payload), { status: 200 })
  }
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: f as unknown as typeof fetch,
    sleep: async () => {},
    nowMs: () => (T0 + DAY + 7200) * 1000,
  })
  assert.equal(calls, 2)
  assert.equal(s.bars.length, 2)
})
