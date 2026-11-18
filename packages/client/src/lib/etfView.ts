import type {
  EtfBoardRow,
  EtfDataStage,
  EtfDailyMetric,
  EtfResonanceLevel,
  EtfSignalLevel,
  EtfTier,
} from '../types'

export const ETF_TIER_ORDER: readonly EtfTier[] = ['mega', 'mid', 'small', 'growth']

export const TIER_LABEL: Record<EtfTier, string> = {
  mega: '超大盘权重',
  mid: '中盘均衡',
  small: '小微盘',
  growth: '双创成长',
}

export const RESONANCE_META: Record<
  EtfResonanceLevel,
  { label: string; tone: 'strong' | 'watch' | 'none'; desc: string }
> = {
  strong: {
    label: '强托底共振',
    tone: 'strong',
    desc: '多梯队宽基同时放量并伴随正溢价或净申购托底',
  },
  watch: {
    label: '局部关注',
    tone: 'watch',
    desc: '个别梯队出现放量或净申购，尚未形成全市场共振',
  },
  none: {
    label: '常规波动',
    tone: 'none',
    desc: '成交与申赎处于常规区间',
  },
}

export const DATA_STAGE_LABEL: Record<EtfDataStage, string> = {
  preliminary: '初步估算',
  nav_ready: '含官方净值',
  partial_shares: '含沪市份额',
  complete: '完整数据',
}

export const SIGNAL_LEVEL_META: Record<
  EtfSignalLevel,
  { label: string; tone: 'strong' | 'inflow' | 'volume' | 'normal' }
> = {
  strong_support: { label: '强托底信号', tone: 'strong' },
  inflow_only: { label: '资金净申购', tone: 'inflow' },
  volume_only: { label: '仅成交放量', tone: 'volume' },
  normal: { label: '常规', tone: 'normal' },
}

export function formatYi(val: number | null, signed = false): string {
  if (val === null || !Number.isFinite(val)) return '—'
  const prefix = signed && val > 0 ? '+' : ''
  return `${prefix}${val.toFixed(1)}亿`
}

export function formatAmountYuanToYi(amountYuan: number | null): string {
  if (amountYuan === null || !Number.isFinite(amountYuan)) return '—'
  return formatYi(amountYuan / 1e8, false)
}

export function formatRatio(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '—'
  return `${val.toFixed(2)}x`
}

export function formatPremium(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '—'
  const prefix = val > 0 ? '+' : ''
  return `${prefix}${val.toFixed(2)}%`
}

export function formatPct(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return '—'
  const prefix = val > 0 ? '+' : ''
  return `${prefix}${val.toFixed(2)}%`
}

/** 放量倍数条宽度（0% - 100%，4.0x 封顶） */
export function volBarWidth(volRatio: number | null): string {
  if (volRatio === null || !Number.isFinite(volRatio) || volRatio <= 0) return '0.0%'
  const pct = Math.min(volRatio / 4, 1) * 100
  return `${pct.toFixed(1)}%`
}

/** 场内流通规模（市值，亿元）= 总份额 × 净值(缺净值时退回收盘价) / 1e8 */
export function computeMarketCapYi(metric: EtfDailyMetric | null): number | null {
  if (!metric || metric.total_shares === null || !Number.isFinite(metric.total_shares) || metric.total_shares <= 0) {
    return null
  }
  const priceRef = metric.nav !== null && metric.nav > 0 ? metric.nav : metric.close
  if (!Number.isFinite(priceRef) || priceRef <= 0) return null
  return (metric.total_shares * priceRef) / 1e8
}

/** 日换手率（%）= 成交额(亿元) / 市值(亿元) × 100 */
export function computeTurnoverRate(metric: EtfDailyMetric | null): number | null {
  const capYi = computeMarketCapYi(metric)
  if (capYi === null || capYi <= 0 || !metric || !Number.isFinite(metric.amount)) return null
  return ((metric.amount / 1e8) / capYi) * 100
}

/** 统计当前看板已获取规模的 ETF 总市值（亿元）及覆盖只数 */
export function computeBoardTotalCapYi(
  rows: readonly EtfBoardRow[],
): { totalCapYi: number | null; coveredCount: number } {
  let sum = 0
  let count = 0
  for (const r of rows) {
    const cap = computeMarketCapYi(r.metric)
    if (cap !== null) {
      sum += cap
      count++
    }
  }
  return { totalCapYi: count > 0 ? sum : null, coveredCount: count }
}

export type EtfFilterKey = 'all' | 'active' | EtfTier

export const ETF_FILTERS: readonly { key: EtfFilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '仅看异动' },
  { key: 'mega', label: '超大盘权重' },
  { key: 'mid', label: '中盘均衡' },
  { key: 'small', label: '小微盘' },
  { key: 'growth', label: '双创成长' },
]

export function matchesEtfFilter(row: EtfBoardRow, key: EtfFilterKey): boolean {
  switch (key) {
    case 'all':
      return true
    case 'active':
      return row.metric != null && row.metric.signal_level !== 'normal'
    case 'mega':
    case 'mid':
    case 'small':
    case 'growth':
      return row.tier === key
  }
}

export function matchesEtfQuery(row: EtfBoardRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return row.code.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)
}

export function filterEtfCounts(rows: readonly EtfBoardRow[]): Record<EtfFilterKey, number> {
  const counts = {} as Record<EtfFilterKey, number>
  for (const { key } of ETF_FILTERS) {
    counts[key] = rows.filter(r => matchesEtfFilter(r, key)).length
  }
  return counts
}

export type EtfSortKey =
  | 'default'
  | 'vol_ratio_20'
  | 'premium_rate'
  | 'net_inflow_yi'
  | 'amount'
  | 'market_cap_yi'
  | 'turnover_rate'
  | 'return_5d'
  | 'return_10d'
  | 'return_since'

function getSortValue(row: EtfBoardRow, sortKey: Exclude<EtfSortKey, 'default'>): number | null {
  switch (sortKey) {
    case 'vol_ratio_20':
    case 'premium_rate':
    case 'net_inflow_yi':
    case 'amount':
      return row.metric?.[sortKey] ?? null
    case 'market_cap_yi':
      return computeMarketCapYi(row.metric)
    case 'turnover_rate':
      return computeTurnoverRate(row.metric)
    case 'return_5d':
    case 'return_10d':
    case 'return_since':
      return row.perf?.[sortKey] ?? null
  }
}

function compareDefaultOrder(a: EtfBoardRow, b: EtfBoardRow): number {
  const tierDiff = ETF_TIER_ORDER.indexOf(a.tier) - ETF_TIER_ORDER.indexOf(b.tier)
  if (tierDiff !== 0) return tierDiff
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return a.code.localeCompare(b.code)
}

export function sortEtfRows(rows: readonly EtfBoardRow[], sortKey: EtfSortKey): EtfBoardRow[] {
  const copy = [...rows]
  if (sortKey === 'default') {
    return copy.sort(compareDefaultOrder)
  }
  return copy.sort((a, b) => {
    const va = getSortValue(a, sortKey)
    const vb = getSortValue(b, sortKey)
    if (va === null && vb === null) return compareDefaultOrder(a, b)
    if (va === null) return 1
    if (vb === null) return -1
    if (vb !== va) return vb - va
    return compareDefaultOrder(a, b)
  })
}
