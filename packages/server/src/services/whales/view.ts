// 列表和详情的读模型。增减在这里算，不落库。
import { costKey, estimateCosts, type CostEstimate } from './cost.js'
import { diffPositions, type DiffPosition } from './diff.js'
import { parseUsdRangeLabel, formatUsdRange } from './houseDisclosure.js'
import {
  getInstitution, getSync, listFilings, listInstitutions, listPositions, loadTickers,
} from './store.js'
import { buildTickerIndex, normalizeIssuerName } from './tickers.js'
import type { ValueUnit } from './valueUnit.js'

export const VALUE_NOTE =
  '市值为美元。2023-01-03 及之后提交的 13F，SEC 要求 value 按美元填报；更早的申报按千美元换算（×1000）后入库。'

export const HOUSE_VALUE_NOTE =
  '金额是美国众议院年度财务披露的申报区间，不是精确市值。表内上市股票和期权多记在配偶名下。占比和名单合计按区间中点估算。有上一期时，增减也按区间中点，不按股数。'

export const COST_NOTE =
  '13F 没有买入成本。估算成本按库内各期申报倒推：期末价 = 市值 ÷ 股数；每期加仓的股数按当期期末价计入，减仓不改每股成本（移动加权平均）；某期清仓后再买从头算；股数与价格同时按整数倍反向跳变视为拆股。标「起算」的仓位在库内最早一期就已持有，成本只从那一期期末价算起，实际成本可能低得多。期权和债券本金行不估算。这不是实际成交价。'

export const MIXED_VALUE_NOTE =
  '名单同时有 SEC Form 13F 和美国众议院年度财务披露。13F 市值为美元（2023-01-03 及之后按美元填报，更早按千美元换算后入库）。众议院金额是申报区间，不是精确市值，合计按区间中点估算。'

export interface WhalePositionView {
  cusip: string
  ticker: string | null
  issuerName: string
  titleOfClass: string
  putCall: '' | 'Put' | 'Call'
  shareType: string
  shares: number
  valueUsd: number
  valueLabel: string | null
  weight: number | null
  change: DiffPosition['change']
  prevShares: number | null
  prevValueUsd: number | null
  shareDelta: number | null
  valueDeltaUsd: number | null
  /** 估算成本。期权、本金行、清仓行和众议院披露为 null。 */
  cost: CostEstimate | null
}

export interface WhaleSummary {
  slug: string
  manager: string
  nameZh: string
  nameEn: string
  cik: string
  source: 'sec-13f' | 'house-fd'
  dataStatus: 'ready' | 'empty'
  syncError: string | null
  latest: {
    reportPeriod: string
    filedAt: string
    form: string
    positionCount: number
    totalValueUsd: number
    totalValueLabel: string | null
    top: { issuerName: string; ticker: string | null; cusip: string } | null
  } | null
}

function decorate(
  row: DiffPosition,
  ticker: string | null,
  weight: number | null,
  cost: CostEstimate | null = null,
): WhalePositionView {
  return {
    cusip: row.cusip,
    ticker: ticker ?? (/^[A-Z]{1,5}$/.test(row.cusip) ? row.cusip : null),
    issuerName: row.issuerName,
    titleOfClass: row.titleOfClass,
    putCall: row.putCall,
    shareType: row.shareType,
    shares: row.shares,
    valueUsd: row.valueUsd,
    valueLabel: row.valueLabel ?? null,
    weight,
    change: row.change,
    prevShares: row.prevShares,
    prevValueUsd: row.prevValueUsd,
    shareDelta: row.shareDelta,
    valueDeltaUsd: row.valueDeltaUsd,
    cost,
  }
}

export function listWhaleSummaries(): { institutions: WhaleSummary[]; valueNote: string } {
  const index = buildTickerIndex(loadTickers())
  const institutions = listInstitutions().map(inst => {
    const sync = getSync(inst.slug)
    const latest = listFilings(inst.slug)[0]
    if (!latest) {
      return {
        slug: inst.slug,
        manager: inst.manager,
        nameZh: inst.nameZh,
        nameEn: inst.nameEn,
        cik: inst.cik,
        source: inst.source,
        dataStatus: 'empty' as const,
        syncError: sync.lastError,
        latest: null,
      }
    }
    const positions = listPositions(latest.id)
    const total = positions.reduce((sum, row) => sum + row.valueUsd, 0)
    const top = [...positions].sort((a, b) => b.valueUsd - a.valueUsd)[0]
    const topTicker = top
      ? index.get(normalizeIssuerName(top.issuerName)) ?? (/^[A-Z]{1,5}$/.test(top.cusip) ? top.cusip : null)
      : null
    return {
      slug: inst.slug,
      manager: inst.manager,
      nameZh: inst.nameZh,
      nameEn: inst.nameEn,
      cik: inst.cik,
      source: inst.source,
      dataStatus: 'ready' as const,
      syncError: sync.lastError,
      latest: {
        reportPeriod: latest.reportPeriod,
        filedAt: latest.filedAt,
        form: latest.form,
        positionCount: positions.length,
        totalValueUsd: total,
        totalValueLabel: totalRangeLabel(positions),
        top: top
          ? {
              issuerName: top.issuerName,
              ticker: topTicker,
              cusip: top.cusip,
            }
          : null,
      },
    }
  })
  return { institutions, valueNote: valueNoteForSources(institutions.map(row => row.source)) }
}

function valueNoteForSources(sources: readonly ('sec-13f' | 'house-fd')[]): string {
  const hasHouse = sources.some(source => source === 'house-fd')
  const has13f = sources.some(source => source !== 'house-fd')
  if (hasHouse && has13f) return MIXED_VALUE_NOTE
  if (hasHouse) return HOUSE_VALUE_NOTE
  return VALUE_NOTE
}

function totalRangeLabel(rows: { valueLabel?: string | null }[]): string | null {
  if (rows.length === 0 || rows.some(row => !row.valueLabel)) return null
  let low = 0
  let high = 0
  for (const row of rows) {
    const parsed = parseUsdRangeLabel(row.valueLabel ?? '')
    if (!parsed) return null
    low += parsed.low
    high += parsed.high
  }
  return formatUsdRange(low, high)
}

export interface WhaleDetail {
  institution: {
    slug: string
    manager: string
    nameZh: string
    nameEn: string
    cik: string
    source: 'sec-13f' | 'house-fd'
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
    valueUnit: ValueUnit
  } | null
  previousPeriod: { reportPeriod: string; filedAt: string } | null
  /** 有估算成本的仓位合计。众议院披露、或本期没有可估算的行时为 null。 */
  costSummary: {
    costUsd: number
    valueUsd: number
    gain: number
    /** 这些仓位占本期市值合计的比例。 */
    coveredWeight: number
    /** 其中多少市值的成本只是从库内最早一期起算。 */
    partialWeight: number
  } | null
  costNote: string | null
  positions: WhalePositionView[]
  closed: WhalePositionView[]
}

export function getWhaleDetail(slug: string, reportPeriod?: string): WhaleDetail | null {
  const inst = getInstitution(slug)
  if (!inst) return null
  const sync = getSync(slug)
  const filings = listFilings(slug)
  const selectedIndex = reportPeriod ? filings.findIndex(row => row.reportPeriod === reportPeriod) : 0
  if (reportPeriod && selectedIndex < 0) return null
  const selected = filings[selectedIndex] ?? null
  const previous = filings[selectedIndex + 1] ?? null
  const periods = filings.map(row => ({ reportPeriod: row.reportPeriod, filedAt: row.filedAt }))
  const institution = {
    slug: inst.slug,
    manager: inst.manager,
    nameZh: inst.nameZh,
    nameEn: inst.nameEn,
    cik: inst.cik,
    source: inst.source,
    dataStatus: selected ? 'ready' as const : 'empty' as const,
    syncError: sync.lastError,
  }
  const valueNote = inst.source === 'house-fd' ? HOUSE_VALUE_NOTE : VALUE_NOTE
  if (!selected) {
    return {
      institution,
      valueNote,
      periods,
      period: null,
      previousPeriod: null,
      costSummary: null,
      costNote: null,
      positions: [],
      closed: [],
    }
  }
  const index = buildTickerIndex(loadTickers())
  const current = listPositions(selected.id)
  const prevRows = previous ? listPositions(previous.id) : null
  const diff = diffPositions(current, prevRows, inst.source === 'house-fd' ? 'midpoint' : 'shares')
  const total = diff.positions.reduce((sum, row) => sum + row.valueUsd, 0)
  const tickerOf = (issuerName: string) => index.get(normalizeIssuerName(issuerName)) ?? null
  // 成本要从库里最早一期一路推到选中期。众议院披露只有金额区间，没有股数，不估算。
  const costs = inst.source === 'house-fd'
    ? new Map<string, CostEstimate>()
    : estimateCosts(filings.slice(selectedIndex).reverse().map(filing => ({
        reportPeriod: filing.reportPeriod,
        positions: filing.id === selected.id ? current : listPositions(filing.id),
      })))
  const positions = [...diff.positions]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .map(row => decorate(
      row,
      tickerOf(row.issuerName),
      total === 0 ? 0 : row.valueUsd / total,
      costs.get(costKey(row)) ?? null,
    ))
  const closed = [...diff.closed]
    .sort((a, b) => (b.prevValueUsd ?? 0) - (a.prevValueUsd ?? 0))
    .map(row => decorate(row, tickerOf(row.issuerName), null))
  return {
    institution,
    valueNote,
    periods,
    period: {
      reportPeriod: selected.reportPeriod,
      filedAt: selected.filedAt,
      form: selected.form,
      accession: selected.accession,
      sourceUrl: selected.sourceUrl,
      valueUnit: selected.valueUnit,
    },
    previousPeriod: previous ? { reportPeriod: previous.reportPeriod, filedAt: previous.filedAt } : null,
    costSummary: summarizeCosts(positions, total),
    costNote: inst.source === 'house-fd' ? null : COST_NOTE,
    positions,
    closed,
  }
}

function summarizeCosts(rows: WhalePositionView[], total: number): WhaleDetail['costSummary'] {
  let costUsd = 0
  let valueUsd = 0
  let partialUsd = 0
  for (const row of rows) {
    if (!row.cost) continue
    costUsd += row.cost.costPerShare * row.shares
    valueUsd += row.valueUsd
    if (!row.cost.fromStart) partialUsd += row.valueUsd
  }
  if (costUsd <= 0) return null
  return {
    costUsd,
    valueUsd,
    gain: valueUsd / costUsd - 1,
    coveredWeight: total === 0 ? 0 : valueUsd / total,
    partialWeight: valueUsd === 0 ? 0 : partialUsd / valueUsd,
  }
}
