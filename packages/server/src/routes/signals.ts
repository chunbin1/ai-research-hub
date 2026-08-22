// packages/server/src/routes/signals.ts
//
// 看板与自选股的 HTTP 层。读接口公开(与报告流同权限),
// 扫描 / 抽取 / 启停仅 admin。SIGNALS=off 时全部 404。
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from './auth.js'
import { listWatchlist, setWatchlistEnabled, type WatchlistEntry } from '../services/watchlistStore.js'
import {
  getLatestState, getStates, getLatestEvent, countEventsSince, getRecentEvents,
  type Timeframe,
} from '../services/signalStore.js'
import { scanAll, isSignalsEnabled } from '../services/signals/scanner.js'
import { syncWatchlistFromAllDocuments } from '../services/signals/watchlistSync.js'
import { getDocument } from '../services/documentStore.js'

export interface SignalsRoutesOptions {
  /** 测试注入假实现,避免真的打 Yahoo */
  scan?: typeof scanAll
}

const TIMEFRAMES: Timeframe[] = ['1d', '1wk']

function daysAgoIso(days: number): string {
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

function rowOf(entry: WatchlistEntry) {
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

export const signalRoutes: FastifyPluginAsync<SignalsRoutesOptions> = async (app, opts) => {
  const scan = opts.scan ?? scanAll

  app.addHook('onRequest', async (_request, reply) => {
    if (!isSignalsEnabled()) return reply.status(404).send({ error: 'signals_disabled' })
  })

  app.get('/signals', async () => {
    const rows = listWatchlist().map(e => rowOf(e))
    // 最近翻转的排最前 —— 一眼看到「今天谁动了」
    rows.sort((a, b) => (b.daily?.flipDate ?? '').localeCompare(a.daily?.flipDate ?? ''))
    return { rows }
  })

  app.get<{ Params: { symbol: string }; Querystring: { timeframe?: string; limit?: string } }>(
    '/signals/:symbol/log',
    async (request, reply) => {
      const tf = (request.query.timeframe ?? '1d') as Timeframe
      if (!TIMEFRAMES.includes(tf)) {
        return reply.status(400).send({ error: 'invalid_input', message: 'timeframe 只能是 1d 或 1wk' })
      }
      // 参数名是 limit 而不是 days:这里取的是**条数**上限。周线一年只有约 50 根,
      // 60 条覆盖一年多 —— 若按自然日窗口算,同一个 60 在日线和周线上的含义会差一个量级。
      const limit = Math.min(Math.max(Number(request.query.limit) || 60, 1), 3650)
      return { states: getStates(request.params.symbol, tf, limit) }
    },
  )

  app.get<{ Querystring: { days?: string } }>('/signals/events', async (request) => {
    const days = Math.min(Math.max(Number(request.query.days) || 7, 1), 3650)
    return { events: getRecentEvents(daysAgoIso(days)) }
  })

  app.post('/signals/scan', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return { summary: await scan() }
  })

  app.post('/signals/extract', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return syncWatchlistFromAllDocuments()
  })

  app.patch<{ Params: { symbol: string }; Body: { enabled?: unknown } }>(
    '/signals/watchlist/:symbol',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const enabled = (request.body ?? {}).enabled
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'invalid_input', message: 'enabled 必须是布尔值' })
      }
      if (!listWatchlist().some(e => e.symbol === request.params.symbol)) {
        return reply.status(404).send({ error: 'not_found' })
      }
      setWatchlistEnabled(request.params.symbol, enabled)
      return { ok: true }
    },
  )
}
