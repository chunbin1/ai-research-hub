/** 名家持仓页的数字和增减文案。页面和测试共用。 */

export type WhaleChange = 'new' | 'increased' | 'decreased' | 'unchanged' | 'closed'

/** 服务端按库内各期 13F 倒推的估算成本，不是成交价。 */
export interface WhaleCost {
  costPerShare: number
  pricePerShare: number
  gain: number
  since: string
  fromStart: boolean
}

export interface WhalePosition {
  cusip: string
  ticker: string | null
  issuerName: string
  titleOfClass: string
  putCall: '' | 'Put' | 'Call'
  shareType: string
  shares: number
  valueUsd: number
  valueLabel?: string | null
  weight: number | null
  change: WhaleChange | null
  prevShares: number | null
  prevValueUsd: number | null
  shareDelta: number | null
  valueDeltaUsd: number | null
  cost?: WhaleCost | null
}

export interface WhaleCostSummary {
  costUsd: number
  valueUsd: number
  gain: number
  coveredWeight: number
  partialWeight: number
}

export interface WhaleLatest {
  reportPeriod: string
  filedAt: string
  form: string
  positionCount: number
  totalValueUsd: number
  totalValueLabel?: string | null
  top: { issuerName: string; ticker: string | null; cusip: string } | null
}

export interface WhaleSummary {
  slug: string
  manager: string
  nameZh: string
  nameEn: string
  cik: string
  source?: 'sec-13f' | 'house-fd'
  dataStatus: 'ready' | 'empty'
  syncError: string | null
  latest: WhaleLatest | null
}

export interface WhaleDetail {
  institution: {
    slug: string
    manager: string
    nameZh: string
    nameEn: string
    cik: string
    source?: 'sec-13f' | 'house-fd'
    dataStatus: 'ready' | 'empty'
    syncError: string | null
  }
  valueNote: string
  periods: { reportPeriod: string; filedAt: string }[]
  period: {
    reportPeriod: string
    filedAt: string
    form: string
    accession: string
    sourceUrl: string
    valueUnit: 'dollars' | 'thousands'
  } | null
  previousPeriod: { reportPeriod: string; filedAt: string } | null
  costSummary?: WhaleCostSummary | null
  costNote?: string | null
  positions: WhalePosition[]
  closed: WhalePosition[]
}

const CHANGE_LABEL: Record<WhaleChange, string> = {
  new: '新建仓',
  increased: '加仓',
  decreased: '减仓',
  unchanged: '不变',
  closed: '清仓',
}

export function changeLabel(change: WhaleChange): string {
  return CHANGE_LABEL[change]
}

export function changeClassName(change: WhaleChange | null): string {
  if (change === 'new' || change === 'increased') return 'text-long'
  if (change === 'decreased' || change === 'closed') return 'text-short'
  return 'text-ink-mute'
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n)
}

/** 每股价格。低价股多留两位，避免 0.0x 美元的仓位显示成 0.00。 */
export function formatPrice(n: number): string {
  const digits = Math.abs(n) < 1 ? 4 : 2
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(n)
}

export function formatGain(gain: number): string {
  const pct = (gain * 100).toFixed(1)
  if (pct === '0.0' || pct === '-0.0') return '0.0%'
  return gain > 0 ? `+${pct}%` : `${pct}%`
}

/** 和增减同一套：赚为红，亏为绿。 */
export function gainClassName(gain: number): string {
  if (Math.abs(gain) < 0.0005) return 'text-ink-mute'
  return gain > 0 ? 'text-long' : 'text-short'
}

export function formatShares(n: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(n)
}

export function formatShareDelta(n: number): string {
  const body = formatShares(Math.abs(n))
  if (n > 0) return `+${body}`
  if (n < 0) return `-${body}`
  return body
}

export function putCallLabel(putCall: string): string | null {
  if (putCall === 'Call') return '认购'
  if (putCall === 'Put') return '认沽'
  return null
}

/** SH 是股数，不额外标注。PRN 是本金，要和同 CUSIP 的股数行分开。 */
export function shareTypeLabel(shareType: string): string | null {
  const type = shareType.trim().toUpperCase()
  if (type === '' || type === 'SH') return null
  if (type === 'PRN') return '本金'
  return type
}

export function securityTitle(row: { ticker: string | null; issuerName: string }): string {
  return row.ticker || row.issuerName || '—'
}
