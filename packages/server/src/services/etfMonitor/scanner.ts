// packages/server/src/services/etfMonitor/scanner.ts
//
// 编排层：拉取 18 只宽基 ETF 日 K 线、官方净值、实时 IOPV 与沪深两市份额，
// 做盘中未收盘保护与深市 T+1 份额归属对齐，计算指标并落库。
import {
  fetchEtfKlines, fetchEtfNavHistory, fetchEtfRealtimeBatch,
  fetchSseDailyShares, fetchSzseLatestShares, type EtfKlineBar,
} from '../market/etfClient.js'
import {
  deleteSummaryDatesNotIn, getAllMetricsGroupedByDate, getExistingMetricsForCode,
  listUniverse, upsertDailyMetrics, upsertDailySummaries,
  type EtfDailyMetricRow, type EtfDailySummaryRow, type NavSource, type ShareSource,
} from '../etfMonitorStore.js'
import { getSetting, setSetting } from '../siteSettingsStore.js'
import {
  DEFAULT_ETF_PARAMS, classifySignalLevel, computeCodeMetrics, computeDailySummary,
  type EtfMonitorParams, type MergedBarInput,
} from './metrics.js'

export const ETF_LAST_SCAN_KEY = 'etf.last_scan_at'
const VOL_THRESHOLD_KEY = 'etf.vol_ratio_threshold'
const PREM_THRESHOLD_KEY = 'etf.premium_threshold'
const INFLOW_THRESHOLD_KEY = 'etf.inflow_threshold_yi'

export function isEtfMonitorEnabled(): boolean {
  return process.env.ETF_MONITOR !== 'off'
}

function parseThreshold(raw: string | null, fallback: number, isValid: (n: number) => boolean): number {
  if (raw === null || raw.trim() === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && isValid(parsed) ? parsed : fallback
}

export function getEtfParams(): EtfMonitorParams {
  return {
    volRatioThreshold: parseThreshold(getSetting(VOL_THRESHOLD_KEY), DEFAULT_ETF_PARAMS.volRatioThreshold, n => n > 0),
    premiumThreshold: parseThreshold(getSetting(PREM_THRESHOLD_KEY), DEFAULT_ETF_PARAMS.premiumThreshold, () => true),
    inflowThresholdYi: parseThreshold(getSetting(INFLOW_THRESHOLD_KEY), DEFAULT_ETF_PARAMS.inflowThresholdYi, n => n >= 0),
  }
}

export function setEtfParams(patch: Partial<EtfMonitorParams>): EtfMonitorParams {
  if (patch.volRatioThreshold !== undefined && Number.isFinite(patch.volRatioThreshold) && patch.volRatioThreshold > 0) {
    setSetting(VOL_THRESHOLD_KEY, String(patch.volRatioThreshold))
  }
  if (patch.premiumThreshold !== undefined && Number.isFinite(patch.premiumThreshold)) {
    setSetting(PREM_THRESHOLD_KEY, String(patch.premiumThreshold))
  }
  if (patch.inflowThresholdYi !== undefined && Number.isFinite(patch.inflowThresholdYi) && patch.inflowThresholdYi >= 0) {
    setSetting(INFLOW_THRESHOLD_KEY, String(patch.inflowThresholdYi))
  }
  return getEtfParams()
}

export interface EtfScanSummary {
  total: number
  ok: number
  failed: number
  latestDate: string | null
}

export interface EtfScanDeps {
  now?: () => Date
  fetchKlines?: typeof fetchEtfKlines
  fetchNavs?: typeof fetchEtfNavHistory
  fetchRealtimeBatch?: typeof fetchEtfRealtimeBatch
  fetchSseShares?: typeof fetchSseDailyShares
  fetchSzseShares?: typeof fetchSzseLatestShares
  concurrency?: number
}

/** 无论宿主时区是什么，统一取北京时间 YYYY-MM-DD 与当日分钟数。 */
function cnDateAndMinutes(now: Date): { ymd: string; minutesOfDay: number } {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = dateParts.find(p => p.type === 'year')!.value
  const m = dateParts.find(p => p.type === 'month')!.value
  const d = dateParts.find(p => p.type === 'day')!.value

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hh = Number(timeParts.find(p => p.type === 'hour')!.value) % 24
  const mm = Number(timeParts.find(p => p.type === 'minute')!.value)
  return { ymd: `${y}-${m}-${d}`, minutesOfDay: hh * 60 + mm }
}

function shiftCalendarYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return dt.toISOString().slice(0, 10)
}

function calendarDaysBetween(ymdFrom: string, ymdTo: string): number {
  const [y1, m1, d1] = ymdFrom.split('-').map(Number)
  const [y2, m2, d2] = ymdTo.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

function isClosedBar(tradeDate: string, todayCN: string, minutesOfDay: number): boolean {
  if (tradeDate < todayCN) return true
  if (tradeDate > todayCN) return false
  return minutesOfDay >= 15 * 60
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/** 纯本地重算所有日期的单只状态标签与全市场共振汇总（改阈值、改梯队、启停标的后调用）。 */
export function recomputeAllEtfSummaries(nowIso = new Date().toISOString()): void {
  const enabledUniverse = listUniverse({ enabledOnly: true })
  const enabledCodes = new Set(enabledUniverse.map(u => u.code))
  const params = getEtfParams()
  const grouped = getAllMetricsGroupedByDate()

  const changedMetrics: EtfDailyMetricRow[] = []
  const datesAsc = Array.from(grouped.keys()).sort()
  const dailyTotalsYi: number[] = []
  const summaries: EtfDailySummaryRow[] = []

  for (const dt of datesAsc) {
    const rawRows = grouped.get(dt) ?? []
    const activeRows = rawRows.filter(r => enabledCodes.has(r.code))
    if (activeRows.length === 0) continue

    const updatedActiveRows = activeRows.map(r => {
      const nextLevel = classifySignalLevel(
        { volRatio20: r.vol_ratio_20, premiumRate: r.premium_rate, netInflowYi: r.net_inflow_yi },
        params,
      )
      if (nextLevel !== r.signal_level) {
        const updated = { ...r, signal_level: nextLevel, updated_at: nowIso }
        changedMetrics.push(updated)
        return updated
      }
      return r
    })

    const prev20Avg = dailyTotalsYi.length >= 20
      ? dailyTotalsYi.slice(-20).reduce((s, x) => s + x, 0) / 20
      : null

    const sum = computeDailySummary(dt, enabledUniverse, updatedActiveRows, prev20Avg, params, nowIso)
    summaries.push(sum)
    dailyTotalsYi.push(sum.total_amount_yi)
  }

  if (changedMetrics.length > 0) upsertDailyMetrics(changedMetrics)
  upsertDailySummaries(summaries)
  deleteSummaryDatesNotIn(summaries.map(s => s.trade_date))
}

let inFlight: Promise<EtfScanSummary> | null = null

export function scanEtfMonitor(
  opts: { backfillDays?: number; codes?: string[] } = {},
  deps: EtfScanDeps = {},
): Promise<EtfScanSummary> {
  if (inFlight && !opts.codes) return inFlight
  const task = runScan(opts, deps)
  if (!opts.codes) {
    inFlight = task.finally(() => { inFlight = null })
    return inFlight
  }
  return task
}

async function runScan(opts: { backfillDays?: number; codes?: string[] }, deps: EtfScanDeps): Promise<EtfScanSummary> {
  const now = (deps.now ?? (() => new Date()))()
  const nowIso = now.toISOString()
  const { ymd: todayCN, minutesOfDay } = cnDateAndMinutes(now)
  const concurrency = deps.concurrency ?? 4
  const params = getEtfParams()

  const fetchKlines = deps.fetchKlines ?? fetchEtfKlines
  const fetchNavs = deps.fetchNavs ?? fetchEtfNavHistory
  const fetchRealtime = deps.fetchRealtimeBatch ?? fetchEtfRealtimeBatch
  const fetchSse = deps.fetchSseShares ?? fetchSseDailyShares
  const fetchSzse = deps.fetchSzseShares ?? fetchSzseLatestShares

  const allEnabled = listUniverse({ enabledOnly: true })
  const targets = opts.codes
    ? allEnabled.filter(u => opts.codes!.includes(u.code))
    : allEnabled

  const summary: EtfScanSummary = { total: targets.length, ok: 0, failed: 0, latestDate: null }
  if (targets.length === 0) return summary

  // 一次批量拉实时收盘价 / IOPV / 最新份额
  let realtimeMap: Record<string, { price: number; amount: number; totalShares: number | null; iopv: number | null }> = {}
  try {
    realtimeMap = await fetchRealtime(targets.map(t => ({ code: t.code, market: t.market })))
  } catch {
    realtimeMap = {}
  }

  // 先判定每只是否需要初始/缺口回溯（停用久了再恢复时，须按最后入库日期至今的缺口拉全），以及确定上交所按日期查询清单
  const existingByCode = new Map(targets.map(t => [t.code, getExistingMetricsForCode(t.code)]))
  const gapTradingDaysByCode = new Map<string, number | null>()
  let maxShGapTradingDays = 0
  for (const t of targets) {
    const existing = existingByCode.get(t.code)!
    const lastDate = existing.length > 0 ? existing[existing.length - 1].trade_date : null
    if (!lastDate) {
      gapTradingDaysByCode.set(t.code, null)
      continue
    }
    const gapCalDays = Math.max(0, calendarDaysBetween(lastDate, todayCN))
    const gapTradingDays = gapCalDays > 4 ? Math.min(Math.ceil(gapCalDays * 0.72) + 5, 250) : null
    gapTradingDaysByCode.set(t.code, gapTradingDays)
    if (t.market === 'SH' && gapTradingDays !== null) {
      maxShGapTradingDays = Math.max(maxShGapTradingDays, gapTradingDays)
    }
  }

  const needsInitialBackfill = opts.backfillDays !== undefined
    || targets.some(t => existingByCode.get(t.code)!.length === 0)

  const backfillTradingDays = opts.backfillDays !== undefined
    ? Math.min(Math.max(Math.floor(opts.backfillDays), 1), 250)
    : Math.min(Math.max(needsInitialBackfill ? 90 : 5, maxShGapTradingDays), 250)

  // 拉取各标 K 线与净值
  const klinesByCode = new Map<string, EtfKlineBar[]>()
  const navsByCode = new Map<string, Record<string, number>>()
  const szseByCode = new Map<string, { snapshotDate: string; shareDate?: string; totalShares: number } | null>()

  const endYmdCompact = todayCN.replace(/-/g, '')

  await runPool(targets, concurrency, async (entry) => {
    try {
      const existing = existingByCode.get(entry.code) ?? []
      const gapDays = gapTradingDaysByCode.get(entry.code) ?? null
      const isInitial = existing.length === 0 || opts.backfillDays !== undefined
      const tradingDaysForKline = opts.backfillDays !== undefined
        ? Math.min(Math.max(opts.backfillDays + 25, 45), 280)
        : isInitial
          ? 275
          : (gapDays !== null ? Math.min(Math.max(gapDays + 25, 45), 280) : 35)
      const calLookback = Math.ceil(tradingDaysForKline * 1.55)
      const begYmdCompact = shiftCalendarYmd(todayCN, -calLookback).replace(/-/g, '')
      const navPages = isInitial || gapDays !== null ? Math.ceil(tradingDaysForKline / 20) : 1

      const [klineRes, navRes, szseRes] = await Promise.all([
        fetchKlines(entry.code, entry.market, begYmdCompact, endYmdCompact),
        fetchNavs(entry.code, navPages, 20).catch(() => ({} as Record<string, number>)),
        entry.market === 'SZ'
          ? fetchSzse(entry.code).catch(() => null)
          : Promise.resolve(null),
      ])

      const closedBars = klineRes.bars.filter(b => isClosedBar(b.tradeDate, todayCN, minutesOfDay))
      klinesByCode.set(entry.code, closedBars)
      navsByCode.set(entry.code, navRes)
      if (entry.market === 'SZ') szseByCode.set(entry.code, szseRes)
    } catch {
      summary.failed++
    }
  })

  // 收集所有已收盘交易日，按需查询上交所历史份额
  const allClosedDatesSet = new Set<string>()
  for (const bars of klinesByCode.values()) {
    for (const b of bars) allClosedDatesSet.add(b.tradeDate)
  }
  const allClosedDatesAsc = Array.from(allClosedDatesSet).sort()
  const latestClosedDate = allClosedDatesAsc.length > 0 ? allClosedDatesAsc[allClosedDatesAsc.length - 1] : null
  summary.latestDate = latestClosedDate

  const hasSseTarget = targets.some(t => t.market === 'SH')
  const sseSharesByDate = new Map<string, Record<string, number>>()
  if (hasSseTarget && allClosedDatesAsc.length > 0) {
    const sseDates = allClosedDatesAsc.slice(-backfillTradingDays)
    await runPool(sseDates, concurrency, async (dt) => {
      try {
        const res = await fetchSse(dt)
        if (Object.keys(res).length > 0) sseSharesByDate.set(dt, res)
      } catch {
        // 单日上交所拉取失败不影响 K 线与净值落库
      }
    })
  }

  // 按标的合并历史 + 本次抓取结果，算指标并 upsert
  for (const entry of targets) {
    const freshBars = klinesByCode.get(entry.code)
    if (!freshBars) continue

    const existingRows = existingByCode.get(entry.code) ?? []
    const existingMap = new Map(existingRows.map(r => [r.trade_date, r]))
    const navMap = navsByCode.get(entry.code) ?? {}
    const rt = realtimeMap[entry.code]
    const szseSnap = szseByCode.get(entry.code) ?? null
    // 解析深市快照实际所属的已结算交易日：
    // - 有 metadata.cols.dqgm 日期且 snapshotDate > shareDate 时，精确归属到 shareDate（漏掉 08:45 晨扫后晚间仍可补写昨日）
    // - 仅在没有 shareDate 时，回退归属到 snapshotDate 之前最近一根已收盘 K 线
    let szseTargetDate: string | null = null
    if (szseSnap) {
      if (szseSnap.shareDate) {
        if (szseSnap.snapshotDate > szseSnap.shareDate) {
          szseTargetDate = szseSnap.shareDate
        }
      } else {
        const beforeSnap = freshBars.filter(x => x.tradeDate < szseSnap.snapshotDate)
        if (beforeSnap.length > 0) {
          szseTargetDate = beforeSnap[beforeSnap.length - 1].tradeDate
        }
      }
    }

    const mergedByDate = new Map<string, MergedBarInput>()
    for (const old of existingRows) {
      mergedByDate.set(old.trade_date, {
        tradeDate: old.trade_date,
        open: old.open,
        close: old.close,
        pctChange: old.pct_change,
        volume: old.volume,
        amount: old.amount,
        nav: old.nav,
        navSource: old.nav_source,
        totalShares: old.total_shares,
        shareSource: old.share_source,
      })
    }

    for (const b of freshBars) {
      const prev = existingMap.get(b.tradeDate)
      const officialNav = navMap[b.tradeDate]
      let nav: number | null = prev?.nav ?? null
      let navSource: NavSource | null = prev?.nav_source ?? null

      if (officialNav !== undefined) {
        nav = officialNav
        navSource = 'official'
      } else if (
        navSource !== 'official'
        && b.tradeDate === todayCN
        && minutesOfDay >= 15 * 60
        && rt?.iopv != null
      ) {
        nav = rt.iopv
        navSource = 'iopv'
      }

      let totalShares: number | null = prev?.total_shares ?? null
      let shareSource: ShareSource | null = prev?.share_source ?? null

      if (entry.market === 'SH') {
        const sseVal = sseSharesByDate.get(b.tradeDate)?.[entry.code]
        if (sseVal !== undefined) {
          totalShares = sseVal
          shareSource = 'sse_history'
        } else if (
          b.tradeDate === latestClosedDate
          && todayCN > b.tradeDate
          && rt?.totalShares != null
          && totalShares === null
        ) {
          // T+1 早盘前上交所前一日数据若偶发未出，可用开盘前实时总份额兜底
          totalShares = rt.totalShares
          shareSource = 'snapshot'
        }
      } else if (entry.market === 'SZ') {
        if (szseSnap) {
          if (szseTargetDate !== null && b.tradeDate === szseTargetDate) {
            totalShares = szseSnap.totalShares
            shareSource = 'snapshot'
          }
        } else if (b.tradeDate === latestClosedDate && todayCN > b.tradeDate && rt?.totalShares != null) {
          totalShares = rt.totalShares
          shareSource = 'snapshot'
        }
      }

      mergedByDate.set(b.tradeDate, {
        tradeDate: b.tradeDate,
        open: b.open,
        close: b.close,
        pctChange: b.pctChange ?? prev?.pct_change ?? null,
        volume: b.volume,
        amount: b.amount,
        nav,
        navSource,
        totalShares,
        shareSource,
      })
    }

    const sortedBars = Array.from(mergedByDate.values()).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    const metricRows = computeCodeMetrics(entry.code, sortedBars, params, nowIso)
    upsertDailyMetrics(metricRows)
    summary.ok++
  }

  recomputeAllEtfSummaries(nowIso)
  setSetting(ETF_LAST_SCAN_KEY, nowIso)
  return summary
}
