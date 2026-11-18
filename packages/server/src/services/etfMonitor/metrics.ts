// packages/server/src/services/etfMonitor/metrics.ts
//
// 纯计算引擎：单只 ETF 日度指标（5/20 日放量倍数、收盘溢价率、份额净申购、单只状态）
// 与全市场多宽基共振合成（data_stage 四档完整度 + strong / watch / none 共振等级）。
import type {
  DataStage, EtfDailyMetricRow, EtfDailySummaryRow, EtfUniverseEntry,
  NavSource, ResonanceLevel, ShareSource, SignalLevel,
} from '../etfMonitorStore.js'

export interface EtfMonitorParams {
  volRatioThreshold: number
  premiumThreshold: number
  inflowThresholdYi: number
}

export const DEFAULT_ETF_PARAMS: EtfMonitorParams = {
  volRatioThreshold: 1.8,
  premiumThreshold: 0.05,
  inflowThresholdYi: 5.0,
}

export interface MergedBarInput {
  tradeDate: string
  open: number
  close: number
  pctChange: number | null
  volume: number
  amount: number
  nav: number | null
  navSource: NavSource | null
  totalShares: number | null
  shareSource: ShareSource | null
}

function meanPrev(bars: MergedBarInput[], index: number, window: number): number | null {
  if (index < window) return null
  let sum = 0
  for (let i = index - window; i < index; i++) {
    sum += bars[i].amount
  }
  const avg = sum / window
  return avg > 0 ? avg : null
}

function round(val: number, digits = 4): number {
  const f = 10 ** digits
  return Math.round(val * f) / f
}

export function classifySignalLevel(
  m: { volRatio20: number | null; premiumRate: number | null; netInflowYi: number | null },
  params: EtfMonitorParams,
): SignalLevel {
  const volOk = m.volRatio20 !== null && m.volRatio20 >= params.volRatioThreshold
  const premOk = m.premiumRate !== null && m.premiumRate >= params.premiumThreshold
  const inflowOk = m.netInflowYi !== null && m.netInflowYi >= params.inflowThresholdYi

  if (volOk && (premOk || inflowOk)) return 'strong_support'
  if (inflowOk) return 'inflow_only'
  if (volOk) return 'volume_only'
  return 'normal'
}

export function computeCodeMetrics(
  code: string,
  barsAsc: MergedBarInput[],
  params: EtfMonitorParams,
  nowIso: string,
): EtfDailyMetricRow[] {
  const out: EtfDailyMetricRow[] = []
  for (let i = 0; i < barsAsc.length; i++) {
    const b = barsAsc[i]
    const avg5 = meanPrev(barsAsc, i, 5)
    const avg20 = meanPrev(barsAsc, i, 20)
    const volRatio5 = avg5 !== null ? round(b.amount / avg5, 3) : null
    // 严格要求满前 20 日才计算 vol_ratio_20，不足置 null 不回退
    const volRatio20 = avg20 !== null ? round(b.amount / avg20, 3) : null

    const premiumRate = b.nav !== null && b.nav > 0
      ? round(((b.close - b.nav) / b.nav) * 100, 3)
      : null

    const prev = i > 0 ? barsAsc[i - 1] : null
    const shareDelta = b.totalShares !== null && prev && prev.totalShares !== null
      ? b.totalShares - prev.totalShares
      : null
    const priceRef = b.nav !== null && b.nav > 0 ? b.nav : b.close
    const netInflowYi = shareDelta !== null
      ? round((shareDelta * priceRef) / 1e8, 2)
      : null

    const signalLevel = classifySignalLevel(
      { volRatio20, premiumRate, netInflowYi },
      params,
    )

    out.push({
      code,
      trade_date: b.tradeDate,
      open: b.open,
      close: b.close,
      pct_change: b.pctChange !== null ? round(b.pctChange, 3) : null,
      volume: b.volume,
      amount: b.amount,
      vol_ratio_5: volRatio5,
      vol_ratio_20: volRatio20,
      nav: b.nav,
      nav_source: b.navSource,
      premium_rate: premiumRate,
      total_shares: b.totalShares,
      share_source: b.shareSource,
      share_delta: shareDelta,
      net_inflow_yi: netInflowYi,
      signal_level: signalLevel,
      updated_at: nowIso,
    })
  }
  return out
}

export function computeDailySummary(
  tradeDate: string,
  enabledUniverse: EtfUniverseEntry[],
  metricsForDate: EtfDailyMetricRow[],
  prev20AvgAmountTotalYi: number | null,
  params: EtfMonitorParams,
  nowIso: string,
): EtfDailySummaryRow {
  const tierByCode = new Map(enabledUniverse.map(u => [u.code, u.tier]))
  const activeMetrics = metricsForDate.filter(m => tierByCode.has(m.code))

  const activeCount = enabledUniverse.length
  let volumeSpikeCount = 0
  let supportEtfCount = 0
  let strongSupportCount = 0
  let officialNavCount = 0
  let shareChangeCount = 0
  let totalAmount = 0
  let totalNetInflowYi = 0
  const supportTiers = new Set<string>()

  for (const m of activeMetrics) {
    totalAmount += m.amount
    if (m.nav_source === 'official') officialNavCount++
    if (m.net_inflow_yi !== null) {
      shareChangeCount++
      totalNetInflowYi += m.net_inflow_yi
    }
    if (m.vol_ratio_20 !== null && m.vol_ratio_20 >= params.volRatioThreshold) {
      volumeSpikeCount++
    }
    if (m.signal_level === 'strong_support') {
      strongSupportCount++
    }
    if (m.signal_level === 'strong_support' || m.signal_level === 'inflow_only') {
      supportEtfCount++
      const tier = tierByCode.get(m.code)
      if (tier) supportTiers.add(tier)
    }
  }

  const supportTierCount = supportTiers.size
  const totalAmountYi = round(totalAmount / 1e8, 2)
  const aggregateVolRatio = prev20AvgAmountTotalYi !== null && prev20AvgAmountTotalYi > 0
    ? round(totalAmountYi / prev20AvgAmountTotalYi, 3)
    : null
  const finalInflowYi = shareChangeCount > 0 ? round(totalNetInflowYi, 2) : null

  const navReady = activeCount > 0 && officialNavCount >= Math.ceil(activeCount * 0.8)
  let dataStage: DataStage
  if (!navReady) {
    dataStage = 'preliminary'
  } else if (finalInflowYi === null) {
    dataStage = 'nav_ready'
  } else if (shareChangeCount < activeCount) {
    dataStage = 'partial_shares'
  } else {
    dataStage = 'complete'
  }

  let resonanceLevel: ResonanceLevel = 'none'
  const cond1InflowOrFallback = finalInflowYi !== null
    ? finalInflowYi >= 30
    : strongSupportCount >= 2
  const isStrong =
    (supportTierCount >= 2 && supportEtfCount >= 3 && cond1InflowOrFallback)
    || (finalInflowYi !== null && finalInflowYi >= 50)

  if (isStrong) {
    resonanceLevel = 'strong'
  } else if (
    supportEtfCount >= 1
    || (finalInflowYi !== null && finalInflowYi >= 10)
    || volumeSpikeCount >= 2
  ) {
    resonanceLevel = 'watch'
  }

  return {
    trade_date: tradeDate,
    resonance_level: resonanceLevel,
    active_count: activeCount,
    volume_spike_count: volumeSpikeCount,
    support_etf_count: supportEtfCount,
    support_tier_count: supportTierCount,
    total_amount_yi: totalAmountYi,
    aggregate_vol_ratio: aggregateVolRatio,
    total_net_inflow_yi: finalInflowYi,
    data_stage: dataStage,
    updated_at: nowIso,
  }
}
