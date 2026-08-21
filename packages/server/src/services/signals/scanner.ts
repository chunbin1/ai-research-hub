// packages/server/src/services/signals/scanner.ts
//
// 编排层:取自选股 → 拉数据 → 算 → 落库。cron 与启动补扫共用这一个函数,
// 不存在第二条代码路径。
//
// 全量重算而不是增量:SuperTrend 是递归指标,增量路径一旦某天算错会沿着
// 递归永久传递且无自愈机会,改 ATR 参数时也不会重算历史。全量重算是幂等的。
import { listScannable, updateScanResult } from '../watchlistStore.js'
import { replaceStates, replaceEvents, type DailyState, type SignalEvent, type Timeframe } from '../signalStore.js'
import { fetchDailyQuotes, YahooError, type QuoteSeries } from '../market/yahooClient.js'
import { getSetting, setSetting } from '../siteSettingsStore.js'
import { supertrend, type SupertrendPoint } from './supertrend.js'
import { toWeekly } from './weekly.js'

/**
 * 预热门槛。少于这么多根就不给信号 —— 预热不足的 SuperTrend 是错的,宁可不给。
 * 这是业务策略而非数学规则,所以放在编排层而不是引擎里。
 * 日线与周线**各自**判断:5 年日线约 1250 根、聚合出的周线约 260 根,都够;
 * 但上市两年的票只有约 500 根日线、约 104 根周线 —— 日线能出信号,周线不能。
 */
export const MIN_BARS = 120

export const LAST_SCAN_KEY = 'signals.last_scan_at'
const PERIOD_KEY = 'signals.atr_period'
const MULT_KEY = 'signals.atr_mult'

export function getSignalParams(): { period: number; mult: number } {
  const period = Number(getSetting(PERIOD_KEY))
  const mult = Number(getSetting(MULT_KEY))
  return {
    // period 下界是 2 而不是 1 —— 引擎在 period<2 时算不出 ATR(见 supertrend.ts 的守卫)
    period: Number.isFinite(period) && period >= 2 ? period : 10,
    mult: Number.isFinite(mult) && mult > 0 ? mult : 3,
  }
}

/** 整体开关。放在这里而不是 jobs/ —— routes 也要用它,HTTP 层不该反向依赖 job 层。 */
export function isSignalsEnabled(): boolean {
  return process.env.SIGNALS !== 'off'
}

export interface ScanDeps {
  fetchQuotes?: (symbol: string) => Promise<QuoteSeries>
  nowIso?: () => string
  concurrency?: number
}

export interface ScanSummary {
  total: number
  ok: number
  failed: number
  insufficient: number
}

function toRows(
  symbol: string,
  timeframe: Timeframe,
  points: SupertrendPoint[],
  rawClose: Record<string, number>,
  closeByDate: Record<string, number>,
): { states: DailyState[]; events: SignalEvent[] } {
  const states: DailyState[] = points.map(p => ({
    symbol,
    timeframe,
    bar_date: p.date,
    trend: p.trend,
    stop_line: p.trend === 1 ? p.up : p.dn,
    close_adj: closeByDate[p.date],
    // 展示用原始未复权价;万一取不到就退回复权价,不让整行落不下去
    close_raw: rawClose[p.date] ?? closeByDate[p.date],
    atr: p.atr,
  }))
  const events: SignalEvent[] = points
    .filter((p, i) => i > 0 && p.trend !== points[i - 1].trend)
    .map(p => ({
      symbol, timeframe, bar_date: p.date, direction: p.trend, price: closeByDate[p.date],
    }))
  return { states, events }
}

export async function scanAll(deps: ScanDeps = {}): Promise<ScanSummary> {
  const fetchQuotes = deps.fetchQuotes ?? ((s: string) => fetchDailyQuotes(s))
  const nowIso = deps.nowIso ?? (() => new Date().toISOString())
  const concurrency = deps.concurrency ?? 5
  const params = getSignalParams()

  const entries = listScannable()
  const summary: ScanSummary = { total: entries.length, ok: 0, failed: 0, insufficient: 0 }

  let cursor = 0
  async function worker() {
    while (cursor < entries.length) {
      const entry = entries[cursor++]
      try {
        const series = await fetchQuotes(entry.symbol)

        if (series.bars.length < MIN_BARS) {
          // 预热不足的 SuperTrend 是错的,宁可不给信号
          replaceStates(entry.symbol, '1d', []); replaceEvents(entry.symbol, '1d', [])
          replaceStates(entry.symbol, '1wk', []); replaceEvents(entry.symbol, '1wk', [])
          updateScanResult(entry.symbol, {
            name: series.name, currency: series.currency,
            status: 'insufficient',
            lastError: `历史数据仅 ${series.bars.length} 根,少于 ${MIN_BARS} 根`,
            lastScanAt: nowIso(),
          })
          summary.insufficient++
          continue
        }

        const dailyClose: Record<string, number> = {}
        for (const b of series.bars) dailyClose[b.date] = b.close
        const weeklyBars = toWeekly(series.bars)
        const weeklyClose: Record<string, number> = {}
        for (const b of weeklyBars) weeklyClose[b.date] = b.close

        const d = toRows(entry.symbol, '1d', supertrend(series.bars, params), series.rawClose, dailyClose)
        // 周线单独把关:日线够不代表周线够(上市两年的票就是这种情况)
        const w = weeklyBars.length >= MIN_BARS
          ? toRows(entry.symbol, '1wk', supertrend(weeklyBars, params), series.rawClose, weeklyClose)
          : { states: [], events: [] }

        replaceStates(entry.symbol, '1d', d.states); replaceEvents(entry.symbol, '1d', d.events)
        replaceStates(entry.symbol, '1wk', w.states); replaceEvents(entry.symbol, '1wk', w.events)

        updateScanResult(entry.symbol, {
          name: series.name, currency: series.currency,
          status: 'ok', lastError: null, lastScanAt: nowIso(),
        })
        summary.ok++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // 代码不存在是永久失败,标 invalid 后不再浪费请求;限流等是临时的,下次还扫
        const status = err instanceof YahooError && err.kind === 'not_found' ? 'invalid' : entry.status
        updateScanResult(entry.symbol, { status, lastError: message, lastScanAt: nowIso() })
        summary.failed++
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  setSetting(LAST_SCAN_KEY, nowIso())
  return summary
}
