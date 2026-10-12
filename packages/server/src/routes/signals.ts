// packages/server/src/routes/signals.ts
//
// 看板与自选股的 HTTP 层。读接口公开(与报告流同权限),
// 扫描 / 抽取 / 启停仅 admin。SIGNALS=off 时全部 404。
import type { FastifyPluginAsync } from 'fastify'
import { requireAdmin } from './auth.js'
import {
  listWatchlist, addWatchlistEntry, softDeleteWatchlistEntry, reviveWatchlistEntry,
} from '../services/watchlistStore.js'
import {
  getStates, getRecentEvents,
  replaceStates, replaceEvents, type Timeframe,
} from '../services/signalStore.js'
import { scanAll, isSignalsEnabled } from '../services/signals/scanner.js'
import { syncWatchlistFromAllDocuments } from '../services/signals/watchlistSync.js'
import { probeSymbol, ProbeError } from '../services/signals/probeSymbol.js'
import { searchYahooSymbols, YahooError, type SymbolSearchHit } from '../services/market/yahooClient.js'
import { signalBoard, daysAgoIso } from '../services/signals/board.js'

export interface SignalsRoutesOptions {
  /** 测试注入假实现,避免真的打 Yahoo */
  scan?: typeof scanAll
  /** 同上 */
  probe?: typeof probeSymbol
  /** 同上 —— 模糊搜索候选 */
  search?: (query: string) => Promise<SymbolSearchHit[]>
}

const TIMEFRAMES: Timeframe[] = ['1d', '1wk']

export const signalRoutes: FastifyPluginAsync<SignalsRoutesOptions> = async (app, opts) => {
  const scan = opts.scan ?? scanAll
  const probe = opts.probe ?? probeSymbol
  const search = opts.search ?? ((q: string) => searchYahooSymbols(q))

  app.addHook('onRequest', async (_request, reply) => {
    if (!isSignalsEnabled()) return reply.status(404).send({ error: 'signals_disabled' })
  })

  app.get('/signals', async () => {
    return { rows: signalBoard() }
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
    // 事件表本身不存公司名 —— 港股代码(0100.HK)光看数字认不出是谁,
    // 从自选股表补上 name,横幅才能和主列表一样带副标题。
    const nameBy = new Map(listWatchlist().map(e => [e.symbol, e.name]))
    return {
      events: getRecentEvents(daysAgoIso(days)).map(e => ({
        ...e,
        name: nameBy.get(e.symbol) ?? null,
      })),
    }
  })

  app.post('/signals/scan', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return { summary: await scan() }
  })

  app.post('/signals/extract', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    return syncWatchlistFromAllDocuments()
  })

  // 模糊搜索候选。点选后再走 probe 确认身份 —— 搜索只给名单,不替代人工确认。
  app.get<{ Querystring: { q?: string } }>('/signals/watchlist/search', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const q = (request.query.q ?? '').trim()
    if (!q) return { results: [] as SymbolSearchHit[] }
    try {
      return { results: await search(q) }
    } catch (err) {
      if (err instanceof YahooError) {
        return reply.status(502).send({ error: err.kind, message: err.message })
      }
      // 非 YahooError 多半是网络层英文异常,文案一律中文
      return reply.status(502).send({ error: 'upstream', message: '搜索失败,请检查网络后重试' })
    }
  })

  app.post<{ Body: { code?: unknown } }>('/signals/watchlist/probe', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const raw = (request.body ?? {}).code
    if (typeof raw !== 'string' || !raw.trim()) {
      return reply.status(400).send({ error: 'invalid_input', message: '代码不能为空' })
    }
    const code = raw.trim()
    try {
      return await probe(code)
    } catch (err) {
      // ProbeError 的 kind 原样透传 —— 前端要靠它区分「市场不支持」和「查不到」
      if (err instanceof ProbeError) {
        return reply.status(400).send({ error: err.kind, message: err.message })
      }
      throw err
    }
  })

  app.post<{ Body: { symbol?: unknown; market?: unknown } }>('/signals/watchlist', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const raw = (request.body ?? {}).symbol
    const { market } = request.body ?? {}
    if (typeof raw !== 'string' || !raw.trim()) {
      return reply.status(400).send({ error: 'invalid_input', message: 'symbol 不能为空' })
    }
    const symbol = raw.trim()
    if (market !== 'US' && market !== 'HK') {
      return reply.status(400).send({ error: 'invalid_input', message: 'market 只能是 US 或 HK' })
    }
    // listWatchlist 只返回未删除的行 —— 在列表里说明是真正的重复,而不是曾被删除
    if (listWatchlist().some(e => e.symbol === symbol)) {
      return reply.status(409).send({ error: 'already_listed', message: `${symbol} 已在自选股中` })
    }
    // 两条都是幂等操作,顺序调用即可覆盖「新增」与「复活」两种情况,不必先查一次「是否曾被删除」:
    // - 曾被删除:reviveWatchlistEntry 生效(保留原 source_doc/source_text),随后
    //   addWatchlistEntry 因主键冲突被 ON CONFLICT DO NOTHING 忽略,不会把来源抹成手动添加。
    // - 全新标的:reviveWatchlistEntry 找不到行,是空操作;addWatchlistEntry 真正建行,
    //   来源留空表示手动添加。
    reviveWatchlistEntry(symbol)
    addWatchlistEntry({ symbol, market, sourceDoc: null, sourceText: null })
    return { ok: true }
  })

  app.delete<{ Params: { symbol: string } }>('/signals/watchlist/:symbol', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const { symbol } = request.params
    if (!listWatchlist().some(e => e.symbol === symbol)) {
      return reply.status(404).send({ error: 'not_found' })
    }
    softDeleteWatchlistEntry(symbol)
    // 连日志一起清 —— 一只票约 1200 行,留着是再也不会更新、也没人看的死数据
    for (const tf of TIMEFRAMES) {
      replaceStates(symbol, tf, [])
      replaceEvents(symbol, tf, [])
    }
    return { ok: true }
  })
}
