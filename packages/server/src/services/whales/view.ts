// 列表和详情的读模型。增减在这里算，不落库。
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
  '金额是美国众议院年度财务披露的申报区间，不是精确市值。表内上市股票和期权多记在配偶名下。占比和名单合计按区间中点估算。'

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

function decorate(row: DiffPosition, ticker: string | null, weight: number | null): WhalePositionView {
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
  return { institutions, valueNote: VALUE_NOTE }
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
  period: {
    reportPeriod: string
    filedAt: string
    form: string
    accession: string
    sourceUrl: string
    valueUnit: ValueUnit
  } | null
  previousPeriod: { reportPeriod: string; filedAt: string } | null
  positions: WhalePositionView[]
  closed: WhalePositionView[]
}

export function getWhaleDetail(slug: string): WhaleDetail | null {
  const inst = getInstitution(slug)
  if (!inst) return null
  const sync = getSync(slug)
  const filings = listFilings(slug)
  const latest = filings[0] ?? null
  const previous = filings[1] ?? null
  const institution = {
    slug: inst.slug,
    manager: inst.manager,
    nameZh: inst.nameZh,
    nameEn: inst.nameEn,
    cik: inst.cik,
    source: inst.source,
    dataStatus: latest ? 'ready' as const : 'empty' as const,
    syncError: sync.lastError,
  }
  const valueNote = inst.source === 'house-fd' ? HOUSE_VALUE_NOTE : VALUE_NOTE
  if (!latest) {
    return {
      institution,
      valueNote,
      period: null,
      previousPeriod: null,
      positions: [],
      closed: [],
    }
  }
  const index = buildTickerIndex(loadTickers())
  const current = listPositions(latest.id)
  const prevRows = previous ? listPositions(previous.id) : null
  const diff = diffPositions(current, prevRows)
  const total = diff.positions.reduce((sum, row) => sum + row.valueUsd, 0)
  const tickerOf = (issuerName: string) => index.get(normalizeIssuerName(issuerName)) ?? null
  const positions = [...diff.positions]
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .map(row => decorate(row, tickerOf(row.issuerName), total === 0 ? 0 : row.valueUsd / total))
  const closed = [...diff.closed]
    .sort((a, b) => (b.prevValueUsd ?? 0) - (a.prevValueUsd ?? 0))
    .map(row => decorate(row, tickerOf(row.issuerName), null))
  return {
    institution,
    valueNote,
    period: {
      reportPeriod: latest.reportPeriod,
      filedAt: latest.filedAt,
      form: latest.form,
      accession: latest.accession,
      sourceUrl: latest.sourceUrl,
      valueUnit: latest.valueUnit,
    },
    previousPeriod: previous ? { reportPeriod: previous.reportPeriod, filedAt: previous.filedAt } : null,
    positions,
    closed,
  }
}
