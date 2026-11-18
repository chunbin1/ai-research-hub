// packages/server/src/routes/etfMonitor.ts
//
// A 股宽基 ETF 国家队托底监控 HTTP 路由：
// 读接口公开，扫描 / 标的池管理 / 阈值修改仅 admin。ETF_MONITOR=off 时统一返回 404。
import type { FastifyPluginAsync } from 'fastify'
import { describeRoute } from '../openapi/doc.js'
import { requireAdmin } from './auth.js'
import {
  addUniverseEntry, deleteUniverseEntry, getBoardByDate, getCodeHistory,
  getCodePerformanceByDate, getTimelineSummaries, getUniverseEntry, listUniverse,
  updateUniverseEntry, type EtfTier,
} from '../services/etfMonitorStore.js'
import {
  ETF_LAST_SCAN_KEY, getEtfParams, isEtfMonitorEnabled,
  recomputeAllEtfSummaries, scanEtfMonitor, setEtfParams,
} from '../services/etfMonitor/scanner.js'
import { probeEtfInfo } from '../services/market/etfClient.js'
import { getSetting } from '../services/siteSettingsStore.js'

export interface EtfMonitorRoutesOptions {
  scan?: typeof scanEtfMonitor
  probe?: typeof probeEtfInfo
}

const VALID_TIERS: readonly EtfTier[] = ['mega', 'mid', 'small', 'growth']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CODE_RE = /^\d{6}$/

export const etfMonitorRoutes: FastifyPluginAsync<EtfMonitorRoutesOptions> = async (app, opts) => {
  const scan = opts.scan ?? scanEtfMonitor
  const probe = opts.probe ?? probeEtfInfo

  app.addHook('onRequest', async (_request, reply) => {
    if (!isEtfMonitorEnabled()) {
      return reply.status(404).send({ error: 'etf_monitor_disabled' })
    }
  })

  app.get<{ Querystring: { date?: string } }>('/etf/board', describeRoute(
    ['etf'],
    'A股宽基ETF托底看板',
    '公开读。返回指定交易日（不传则取最新有数据的交易日）的共振汇总、在池宽基指标明细、已停用列表、当前阈值及可用历史日期列表。',
  ), async (request, reply) => {
    const date = request.query.date?.trim()
    if (date && !DATE_RE.test(date)) {
      return reply.status(400).send({ error: 'invalid_input', message: 'date 须为 YYYY-MM-DD' })
    }
    const board = getBoardByDate(date)
    const targetDate = board.summary?.trade_date ?? board.metrics[0]?.trade_date ?? date
    const perfByCode = targetDate ? getCodePerformanceByDate(targetDate) : new Map()
    const metricByCode = new Map(board.metrics.map(m => [m.code, m]))
    const allUniverse = listUniverse()
    const rows = allUniverse
      .filter(u => u.enabled)
      .map(u => ({
        ...u,
        metric: metricByCode.get(u.code) ?? null,
        perf: perfByCode.get(u.code) ?? { return_5d: null, return_10d: null, return_since: null },
      }))
    const disabledUniverse = allUniverse.filter(u => !u.enabled)
    return {
      summary: board.summary,
      rows,
      disabledUniverse,
      params: getEtfParams(),
      lastScanAt: getSetting(ETF_LAST_SCAN_KEY),
      availableDates: board.availableDates,
    }
  })

  app.get<{ Querystring: { days?: string } }>('/etf/timeline', describeRoute(
    ['etf'],
    '托底共振历史时间轴',
    '公开读。返回近 N 个交易日（默认 90，范围 1–365）的每日共振汇总。',
  ), async (request) => {
    const days = Math.min(Math.max(Number(request.query.days) || 90, 1), 365)
    return { days: getTimelineSummaries(days) }
  })

  app.get<{ Params: { code: string }; Querystring: { days?: string } }>('/etf/:code/history', describeRoute(
    ['etf'],
    '单只宽基ETF历史明细',
    '公开读。返回单只宽基近 N 个交易日（默认 60，范围 1–365）的成交额放量、溢价率与净申购历史。',
  ), async (request, reply) => {
    const code = request.params.code.trim()
    const entry = getUniverseEntry(code)
    if (!entry) {
      return reply.status(404).send({ error: 'not_found', message: `监控池中不存在 ${code}` })
    }
    const days = Math.min(Math.max(Number(request.query.days) || 60, 1), 365)
    return {
      code,
      entry,
      history: getCodeHistory(code, days),
    }
  })

  app.post<{ Body?: { backfillDays?: number } }>('/etf/scan', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const rawDays = request.body?.backfillDays
    let backfillDays: number | undefined
    if (rawDays !== undefined) {
      if (typeof rawDays !== 'number' || !Number.isFinite(rawDays) || rawDays < 1 || rawDays > 250) {
        return reply.status(400).send({ error: 'invalid_input', message: 'backfillDays 须为 1–250 的数字' })
      }
      backfillDays = Math.floor(rawDays)
    }
    return { summary: await scan({ backfillDays }) }
  })

  app.post<{ Body?: { code?: unknown; tier?: EtfTier } }>('/etf/universe', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const rawCode = request.body?.code
    const tier = request.body?.tier
    if (typeof rawCode !== 'string' || !tier || !VALID_TIERS.includes(tier)) {
      return reply.status(400).send({ error: 'invalid_input', message: '请提供 6 位 ETF 代码与合法梯队' })
    }
    const code = rawCode.trim()
    if (!CODE_RE.test(code)) {
      return reply.status(400).send({ error: 'invalid_input', message: '请提供 6 位 ETF 代码与合法梯队' })
    }
    if (getUniverseEntry(code)) {
      return reply.status(409).send({ error: 'already_exists', message: `${code} 已在监控池中` })
    }
    let info: Awaited<ReturnType<typeof probe>>
    try {
      info = await probe(code)
    } catch {
      return reply.status(502).send({ error: 'upstream_error', message: `查询 ETF 信息失败，请稍后重试: ${code}` })
    }
    if (!info) {
      return reply.status(400).send({ error: 'invalid_input', message: `无法识别为有效的沪深场内 ETF: ${code}` })
    }
    const entry = addUniverseEntry({ ...info, tier })
    await scan({ codes: [code] })
    recomputeAllEtfSummaries()
    return { entry }
  })

  app.patch<{ Params: { code: string }; Body?: { enabled?: boolean; tier?: EtfTier } }>(
    '/etf/universe/:code',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const code = request.params.code.trim()
      const prev = getUniverseEntry(code)
      if (!prev) {
        return reply.status(404).send({ error: 'not_found', message: `监控池中不存在 ${code}` })
      }
      const { enabled, tier } = request.body ?? {}
      if (enabled !== undefined && typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'invalid_input', message: 'enabled 须为布尔值' })
      }
      if (tier !== undefined && !VALID_TIERS.includes(tier)) {
        return reply.status(400).send({ error: 'invalid_input', message: 'tier 不合法' })
      }
      const entry = updateUniverseEntry(code, { enabled, tier })!
      if (!prev.enabled && entry.enabled) {
        await scan({ codes: [code] })
      }
      recomputeAllEtfSummaries()
      return { entry }
    },
  )

  app.delete<{ Params: { code: string } }>('/etf/universe/:code', async (request, reply) => {
    if (!requireAdmin(request, reply)) return
    const code = request.params.code.trim()
    const ok = deleteUniverseEntry(code)
    if (!ok) {
      return reply.status(404).send({ error: 'not_found', message: `监控池中不存在 ${code}` })
    }
    recomputeAllEtfSummaries()
    return { ok: true }
  })

  app.patch<{ Body?: { volRatioThreshold?: number; premiumThreshold?: number; inflowThresholdYi?: number } }>(
    '/etf/params',
    async (request, reply) => {
      if (!requireAdmin(request, reply)) return
      const { volRatioThreshold, premiumThreshold, inflowThresholdYi } = request.body ?? {}
      if (
        volRatioThreshold !== undefined
        && (typeof volRatioThreshold !== 'number' || !Number.isFinite(volRatioThreshold) || volRatioThreshold <= 0 || volRatioThreshold > 20)
      ) {
        return reply.status(400).send({ error: 'invalid_input', message: 'volRatioThreshold 须在 (0, 20] 内' })
      }
      if (
        premiumThreshold !== undefined
        && (typeof premiumThreshold !== 'number' || !Number.isFinite(premiumThreshold) || premiumThreshold < -5 || premiumThreshold > 10)
      ) {
        return reply.status(400).send({ error: 'invalid_input', message: 'premiumThreshold 须在 [-5, 10] 内' })
      }
      if (
        inflowThresholdYi !== undefined
        && (typeof inflowThresholdYi !== 'number' || !Number.isFinite(inflowThresholdYi) || inflowThresholdYi < 0 || inflowThresholdYi > 500)
      ) {
        return reply.status(400).send({ error: 'invalid_input', message: 'inflowThresholdYi 须在 [0, 500] 内' })
      }
      const params = setEtfParams({ volRatioThreshold, premiumThreshold, inflowThresholdYi })
      recomputeAllEtfSummaries()
      return { params }
    },
  )
}
