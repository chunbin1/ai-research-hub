// packages/server/src/services/signals/probeSymbol.ts
//
// 手动添加标的前的身份探测。归一化 → 拉一次行情 → 把公司全名和历史根数交回去,
// 由管理员确认后才入库。
//
// 为什么探测完还要人工确认:`HBM` 在 Yahoo 上是加拿大铜矿 Hudbay Minerals,
// 探测会成功、扫描也会成功 —— 代码合法、公司不对。404 兜底抓不住这类错误,
// 只有把公司全名摆到管理员面前才能。
import { normalizeSymbol, type Market } from '../market/symbol.js'
import { fetchDailyQuotes, YahooError, type QuoteSeries } from '../market/yahooClient.js'
import type { WatchlistEntry } from '../watchlistStore.js'
import { MIN_BARS } from './scanner.js'
import { getDb } from '../db.js'

export type ProbeErrorKind = 'unsupported_market' | 'not_found' | 'upstream'

export class ProbeError extends Error {
  constructor(message: string, readonly kind: ProbeErrorKind) {
    super(message)
    this.name = 'ProbeError'
  }
}

export interface ProbeResult {
  symbol: string
  market: Market
  name: string | null
  currency: string | null
  exchange: string | null
  /** 可用的已收盘日线根数 */
  bars: number
  /** 是否达到预热门槛。false 不阻止添加,只在界面上提示 */
  enough: boolean
  alreadyListed: boolean
  /** 曾被删除。添加即复活 */
  deleted: boolean
}

export interface ProbeDeps {
  fetchQuotes?: (symbol: string) => Promise<QuoteSeries>
  /** 按 symbol 查表(含墓碑)。listWatchlist 只返回未删除的行,所以这里要直接查 */
  findEntry?: (symbol: string) => WatchlistEntry | null
}

function defaultFindEntry(symbol: string): WatchlistEntry | null {
  return (getDb().prepare('SELECT * FROM watchlist WHERE symbol = ?').get(symbol) as WatchlistEntry) ?? null
}

export async function probeSymbol(raw: string, deps: ProbeDeps = {}): Promise<ProbeResult> {
  const fetchQuotes = deps.fetchQuotes ?? ((s: string) => fetchDailyQuotes(s))
  const findEntry = deps.findEntry ?? defaultFindEntry

  const norm = normalizeSymbol(raw)
  if (!norm) {
    throw new ProbeError('只支持美股与港股。港股请写成 0700.HK,美股请写成 NASDAQ: RKLB 或 RKLB', 'unsupported_market')
  }

  let series: QuoteSeries
  try {
    series = await fetchQuotes(norm.symbol)
  } catch (err) {
    if (err instanceof YahooError) {
      if (err.kind === 'not_found') throw new ProbeError(`Yahoo 上查不到 ${norm.symbol}`, 'not_found')
      // YahooError 的文案本来就是中文,可以直接透出
      throw new ProbeError(err.message, 'upstream')
    }
    // 非 YahooError 说明连 fetch 都没走通(DNS / ECONNREFUSED 之类)——
    // Node 的 fetch 抛的是英文 TypeError,原样透到界面上会违反「文案一律中文」。
    // 真实原因记在日志里没意义(这里拿不到 logger),给用户一句能行动的中文。
    throw new ProbeError('查询行情失败,请检查网络后重试', 'upstream')
  }

  const entry = findEntry(norm.symbol)
  return {
    symbol: norm.symbol,
    market: norm.market,
    name: series.name,
    currency: series.currency,
    exchange: series.exchange ?? null,
    bars: series.bars.length,
    enough: series.bars.length >= MIN_BARS,
    // 墓碑不算「已在自选股中」—— 它应该能被添加(走复活路径)
    alreadyListed: entry?.enabled === 1,
    deleted: entry?.enabled === 0,
  }
}
