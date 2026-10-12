// packages/server/src/services/signals/board.ts
//
// 看板的一行:当前状态 + 派生指标。/signals 接口和 MCP 的 get_signals 共用,
// 两边看到的数字必须一模一样。
import { listWatchlist, type WatchlistEntry } from '../watchlistStore.js'
import { getLatestState, getLatestEvent, countEventsSince, type Timeframe } from '../signalStore.js'
import { getDocument } from '../documentStore.js'

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
}

/** 一个周期的当前状态 + 派生指标。没有日志时返回 null。 */
function sideOf(symbol: string, timeframe: Timeframe) {
  const state = getLatestState(symbol, timeframe)
  if (!state) return null
  const flip = getLatestEvent(symbol, timeframe)
  return {
    trend: state.trend,
    barDate: state.bar_date,
    stopLine: state.stop_line,
    closeAdj: state.close_adj,
    atr: state.atr,
    distPct: (state.close_adj - state.stop_line) / state.stop_line * 100,
    flipDate: flip?.bar_date ?? null,
    flipPrice: flip?.price ?? null,
    heldDays: flip ? diffDays(flip.bar_date, state.bar_date) : null,
    sinceFlipPct: flip ? (state.close_adj - flip.price) / flip.price * 100 : null,
  }
}

export function rowOf(entry: WatchlistEntry) {
  const daily = sideOf(entry.symbol, '1d')
  const weekly = sideOf(entry.symbol, '1wk')
  const doc = entry.source_doc ? getDocument(entry.source_doc) : null
  return {
    symbol: entry.symbol,
    name: entry.name,
    market: entry.market,
    currency: entry.currency,
    // 展示用原始未复权价 —— 与券商界面对得上
    closeRaw: getLatestState(entry.symbol, '1d')?.close_raw ?? null,
    daily,
    weekly,
    divergent: !!daily && !!weekly && daily.trend !== weekly.trend,
    // whipsaw 警示:近 90 天日线翻了几次
    flips90d: countEventsSince(entry.symbol, '1d', daysAgoIso(90)),
    sourceDoc: doc ? { id: doc.id, filename: doc.filename } : null,
    sourceText: entry.source_text,
    enabled: entry.enabled === 1,
    status: entry.status,
    lastError: entry.last_error,
    lastScanAt: entry.last_scan_at,
  }
}

/** 看板全部行,最近翻转的排最前 —— 一眼看到「今天谁动了」 */
export function signalBoard() {
  const rows = listWatchlist().map(e => rowOf(e))
  rows.sort((a, b) => (b.daily?.flipDate ?? '').localeCompare(a.daily?.flipDate ?? ''))
  return rows
}
