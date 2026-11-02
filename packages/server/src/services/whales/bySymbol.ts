// 按股票代码看已追踪机构的最新一期：还持有的，以及相对上一期清掉的。
// 不估算成本。成本要走完整段历史，对话和按代码查询用不上。
import { diffPositions, type ChangeKind } from './diff.js'
import { listFilings, listInstitutions, listPositions, loadTickers } from './store.js'
import { buildTickerIndex, normalizeIssuerName } from './tickers.js'

export interface WhaleSymbolHolding {
  slug: string
  manager: string
  nameZh: string
  nameEn: string
  source: 'sec-13f' | 'house-fd'
  reportPeriod: string
  filedAt: string
  ticker: string
  issuerName: string
  cusip: string
  putCall: '' | 'Put' | 'Call'
  shareType: string
  shares: number
  valueUsd: number
  valueLabel: string | null
  /** 占该机构本期市值合计。清仓行为 null。 */
  weight: number | null
  change: ChangeKind | null
  shareDelta: number | null
  valueDeltaUsd: number | null
  prevShares: number | null
  prevValueUsd: number | null
  closed: boolean
}

function tickerOf(issuerName: string, cusip: string, index: Map<string, string | null>): string | null {
  const key = normalizeIssuerName(issuerName)
  const fromName = key.length >= 2 && index.has(key) ? index.get(key) ?? null : null
  if (fromName) return fromName
  const asTicker = cusip.trim().toUpperCase()
  return /^[A-Z]{1,5}$/.test(asTicker) ? asTicker : null
}

/** 大小写不敏感。空列表直接返回。同一代码在一家机构里可以有普通股和期权多行。 */
export function holdingsForTickers(tickers: readonly string[]): WhaleSymbolHolding[] {
  const wanted = new Set(tickers.map(ticker => ticker.trim().toUpperCase()).filter(Boolean))
  if (wanted.size === 0) return []
  const index = buildTickerIndex(loadTickers())
  const hits: WhaleSymbolHolding[] = []
  for (const inst of listInstitutions()) {
    const filings = listFilings(inst.slug)
    const latest = filings[0]
    if (!latest) continue
    const previous = filings[1] ?? null
    const current = listPositions(latest.id)
    const prevRows = previous ? listPositions(previous.id) : null
    const diff = diffPositions(current, prevRows, inst.source === 'house-fd' ? 'midpoint' : 'shares')
    const total = diff.positions.reduce((sum, row) => sum + row.valueUsd, 0)
    const push = (row: (typeof diff.positions)[number], closed: boolean) => {
      const ticker = tickerOf(row.issuerName, row.cusip, index)
      if (!ticker || !wanted.has(ticker)) return
      hits.push({
        slug: inst.slug,
        manager: inst.manager,
        nameZh: inst.nameZh,
        nameEn: inst.nameEn,
        source: inst.source,
        reportPeriod: latest.reportPeriod,
        filedAt: latest.filedAt,
        ticker,
        issuerName: row.issuerName,
        cusip: row.cusip,
        putCall: row.putCall,
        shareType: row.shareType,
        shares: row.shares,
        valueUsd: row.valueUsd,
        valueLabel: row.valueLabel ?? null,
        weight: closed || total === 0 ? null : row.valueUsd / total,
        change: row.change,
        shareDelta: row.shareDelta,
        valueDeltaUsd: row.valueDeltaUsd,
        prevShares: row.prevShares,
        prevValueUsd: row.prevValueUsd,
        closed,
      })
    }
    for (const row of diff.positions) push(row, false)
    for (const row of diff.closed) push(row, true)
  }
  return hits
}
