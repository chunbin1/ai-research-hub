// packages/server/src/services/market/yahooClient.ts
//
// 全系统唯一碰网络的模块。一次请求拿 5 年日线,周线由 signals/weekly.ts 聚合。
//
// 三件必须做对的事:
//   ① 复权 —— Yahoo 的 quote OHLC 只做了拆股调整,没做分红调整。港股大额分红
//      (实测天齐单次 6%)的除息跳空足以打穿 SuperTrend 止损线,造出假信号。
//   ② 丢弃未收盘的 bar —— Yahoo 会把进行中的当日 bar 一并返回。
//   ③ 跳过 close 为 null 的停牌日。
import type { Bar } from '../signals/supertrend.js'

export type YahooErrorKind = 'not_found' | 'rate_limited' | 'bad_response'

export class YahooError extends Error {
  constructor(message: string, readonly kind: YahooErrorKind) {
    super(message)
    this.name = 'YahooError'
  }
}

export interface QuoteSeries {
  symbol: string
  name: string | null
  currency: string | null
  /** 全复权序列,信号就是用它算的 */
  bars: Bar[]
  /** 交易日 → 原始未复权收盘价,展示用 */
  rawClose: Record<string, number>
}

export interface YahooDeps {
  fetchImpl?: typeof fetch
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
}

const RETRY_DELAYS = [1000, 2000]

/** 时间戳 → UTC 日期。美股 bar 是 13:30 UTC、港股是 01:30 UTC,UTC 日期都等于当地交易日。 */
function utcDate(tsSeconds: number): string {
  return new Date(tsSeconds * 1000).toISOString().slice(0, 10)
}

export async function fetchDailyQuotes(symbol: string, deps: YahooDeps = {}): Promise<QuoteSeries> {
  const doFetch = deps.fetchImpl ?? fetch
  const nowMs = deps.nowMs ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + '?interval=1d&range=5y&includeAdjustedClose=true'

  let res: Response | null = null
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    // 不带 User-Agent 会被 Yahoo 直接 429
    res = await doFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.status === 404) throw new YahooError(`${symbol}: 代码不存在`, 'not_found')
    if (res.status !== 429) break
    if (attempt === RETRY_DELAYS.length) {
      throw new YahooError(`${symbol}: 被限流,重试后仍失败`, 'rate_limited')
    }
    await sleep(RETRY_DELAYS[attempt])
  }
  if (!res || !res.ok) {
    throw new YahooError(`${symbol}: HTTP ${res?.status ?? '无响应'}`, 'bad_response')
  }

  let payload: any
  try {
    payload = await res.json()
  } catch {
    throw new YahooError(`${symbol}: 响应不是合法 JSON`, 'bad_response')
  }

  const result = payload?.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0]
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose
  if (!result || !Array.isArray(result.timestamp) || !quote || !Array.isArray(adjclose)) {
    throw new YahooError(`${symbol}: 响应结构不符合预期`, 'bad_response')
  }

  const meta = result.meta ?? {}
  const bars: Bar[] = []
  const rawClose: Record<string, number> = {}

  for (let i = 0; i < result.timestamp.length; i++) {
    const close = quote.close[i]
    const adj = adjclose[i]
    if (close == null || adj == null) continue      // 停牌日
    const date = utcDate(result.timestamp[i])
    const factor = adj / close
    bars.push({
      date,
      high: quote.high[i] * factor,
      low: quote.low[i] * factor,
      close: adj,
    })
    rawClose[date] = close
  }

  // 最后一根可能是进行中的当日 bar —— 未收盘的 SuperTrend 会随盘中价来回翻
  const regularEnd = meta?.currentTradingPeriod?.regular?.end
  const marketTime = meta?.regularMarketTime
  if (
    bars.length > 0
    && typeof regularEnd === 'number'
    && typeof marketTime === 'number'
    && nowMs() / 1000 < regularEnd
    && bars[bars.length - 1].date === utcDate(marketTime)
  ) {
    const dropped = bars.pop()!
    delete rawClose[dropped.date]
  }

  return {
    symbol,
    name: typeof meta.longName === 'string' ? meta.longName : null,
    currency: typeof meta.currency === 'string' ? meta.currency : null,
    bars,
    rawClose,
  }
}
