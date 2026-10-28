/** 名家持仓页的数字和增减文案。页面和测试共用。 */

export type WhaleChange = 'new' | 'increased' | 'decreased' | 'unchanged' | 'closed'

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
  periods?: { reportPeriod: string; filedAt: string }[]
  period: {
    reportPeriod: string
    filedAt: string
    form: string
    accession: string
    sourceUrl: string
    valueUnit: 'dollars' | 'thousands'
  } | null
  previousPeriod: { reportPeriod: string; filedAt: string } | null
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
