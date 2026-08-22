import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchDailyQuotes, YahooError } from './yahooClient.ts'

const DAY = 86400
const SESSION_LEN = 6.5 * 3600
/** 2026-08-18 13:30 UTC —— 美股开盘时刻,后续每根 +1 天 */
const T0 = Date.UTC(2026, 7, 18, 13, 30) / 1000
/** 第 dayOffset 天(相对 T0)的交易时段 */
const sessionOn = (dayOffset: number) => {
  const start = T0 + dayOffset * DAY
  return { start, end: start + SESSION_LEN }
}

function fakePayload(opts: {
  closes: (number | null)[]
  adj?: (number | null)[]
  session: { start: number; end: number }
}) {
  const n = opts.closes.length
  return {
    chart: {
      result: [{
        meta: {
          currency: 'USD',
          longName: 'Albemarle Corporation',
          fullExchangeName: 'NYSE',
          currentTradingPeriod: { regular: opts.session },
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
  const payload = fakePayload({ closes: [100, 101, 102], session: sessionOn(2) })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (sessionOn(2).start + 3600) * 1000,   // 08-20 盘中
  })
  assert.equal(s.name, 'Albemarle Corporation')
  assert.equal(s.currency, 'USD')
  assert.equal(s.exchange, 'NYSE')
  // 第三根(08-20)正在交易中,被丢弃
  assert.deepEqual(s.bars.map(b => b.date), ['2026-08-18', '2026-08-19'])
})

test('当日已收盘时保留最后一根', async () => {
  const payload = fakePayload({ closes: [100, 101, 102], session: sessionOn(2) })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (sessionOn(2).end + 3600) * 1000,     // 08-20 收盘后
  })
  assert.equal(s.bars.length, 3)
  assert.equal(s.bars[2].date, '2026-08-20')
})

test('次日开盘前保留最后一根 —— 不能把已收盘的那根误删', async () => {
  // 回归测试。实测 2026-08-21 08:53 UTC(美股 13:30 才开盘)时,
  // currentTradingPeriod 指向今天这场还没开始的盘,而 regularMarketTime 指向
  // 昨天的收盘。用 regularMarketTime 做判据会把已收盘的 08-20 丢掉。
  const payload = fakePayload({ closes: [100, 101, 102], session: sessionOn(3) })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (sessionOn(3).start - 4 * 3600) * 1000,   // 08-21 开盘前 4 小时
  })
  assert.equal(s.bars.length, 3)
  assert.equal(s.bars[2].date, '2026-08-20')
})

test('周末/假日(下一场尚未开始)保留全部', async () => {
  const payload = fakePayload({ closes: [100, 101, 102], session: sessionOn(5) })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (sessionOn(4).start) * 1000,
  })
  assert.equal(s.bars.length, 3)
})

test('复权:high/low 乘因子,close 取 adjclose,原始收盘另存', async () => {
  const payload = fakePayload({
    closes: [100, 200],
    adj: [90, 200],                 // 第一根因子 0.9,第二根 1.0
    session: sessionOn(1),
  })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (sessionOn(1).end + 3600) * 1000,
  })
  assert.deepEqual(s.bars[0], { date: '2026-08-18', high: 91.8, low: 88.2, close: 90 })
  assert.deepEqual(s.bars[1], { date: '2026-08-19', high: 202, low: 198, close: 200 })
  assert.equal(s.rawClose['2026-08-18'], 100)   // 展示用的是未复权价
  assert.equal(s.rawClose['2026-08-19'], 200)
})

test('close 为 null 的停牌日整根跳过', async () => {
  const payload = fakePayload({ closes: [100, null, 102], session: sessionOn(2) })
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payload) as unknown as typeof fetch,
    nowMs: () => (sessionOn(2).end + 3600) * 1000,
  })
  assert.deepEqual(s.bars.map(b => b.date), ['2026-08-18', '2026-08-20'])
})

test('high 或 low 单独为 null 的一根也跳过,不能塌成 0', async () => {
  // JS 里 null * factor === 0。只挡 close 的话,这一根会带着 high=0 / low=0
  // 流进引擎,而 0 会把 SuperTrend 的止损线直接拖到地板上。
  const payload = fakePayload({ closes: [100, 101, 102], session: sessionOn(2) })
  const payloadAny = payload as any
  payloadAny.chart.result[0].indicators.quote[0].high[1] = null
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: okFetch(payloadAny) as unknown as typeof fetch,
    nowMs: () => (sessionOn(2).end + 3600) * 1000,
  })
  assert.deepEqual(s.bars.map(b => b.date), ['2026-08-18', '2026-08-20'])
  assert.ok(s.bars.every(b => b.high > 0 && b.low > 0))
})

test('响应缺少 high/low/close 数组时抛 bad_response,而不是裸 TypeError', async () => {
  // 调用方靠 YahooError.kind 分流(单只票失败不该升级成整批崩溃),
  // 所以结构畸形必须在边界就转成 YahooError。
  const payload = fakePayload({ closes: [100, 101], session: sessionOn(1) }) as any
  delete payload.chart.result[0].indicators.quote[0].high
  await assert.rejects(
    () => fetchDailyQuotes('ALB', { fetchImpl: okFetch(payload) as unknown as typeof fetch }),
    (err: unknown) => err instanceof YahooError && err.kind === 'bad_response',
  )
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
  const payload = fakePayload({ closes: [100, 101], session: sessionOn(1) })
  const f = async () => {
    calls++
    return calls === 1
      ? new Response('', { status: 429 })
      : new Response(JSON.stringify(payload), { status: 200 })
  }
  const s = await fetchDailyQuotes('ALB', {
    fetchImpl: f as unknown as typeof fetch,
    sleep: async () => {},
    nowMs: () => (sessionOn(1).end + 3600) * 1000,
  })
  assert.equal(calls, 2)
  assert.equal(s.bars.length, 2)
})
