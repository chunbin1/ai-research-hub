// 13F 信息表的纯解析。不访问网络。
// 标签常带默认命名空间或 n1: 前缀，按本地名取，不依赖某一种前缀。
import { toUsd, type ValueUnit } from './valueUnit.js'

export interface FilingRef {
  form: string
  accessionNumber: string
  filingDate: string
  reportDate: string
}

export interface ParsedRow {
  issuerName: string
  titleOfClass: string
  cusip: string
  value: number
  shares: number
  shareType: string
  putCall: '' | 'Put' | 'Call'
}

export interface AggregatedPosition {
  cusip: string
  putCall: '' | 'Put' | 'Call'
  shareType: string
  issuerName: string
  titleOfClass: string
  shares: number
  valueReported: number
  valueUsd: number
  /** 众议院披露的金额区间。有它时页面不把 valueUsd 当成精确市值。 */
  valueLabel?: string | null
}

const FORM_13F = new Set(['13F-HR', '13F-HR/A'])

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => (typeof item === 'string' ? item : ''))
}

/** submissions JSON 里 filings.recent 是平行数组，收成一行一条。 */
export function filingsFromSubmissions(doc: unknown): FilingRef[] {
  if (!doc || typeof doc !== 'object') return []
  const recent = (doc as { filings?: { recent?: Record<string, unknown> } }).filings?.recent
  if (!recent) return []
  const forms = asStrings(recent.form)
  const accession = asStrings(recent.accessionNumber)
  const filingDate = asStrings(recent.filingDate)
  const reportDate = asStrings(recent.reportDate)
  return forms.map((form, i) => ({
    form,
    accessionNumber: accession[i] ?? '',
    filingDate: filingDate[i] ?? '',
    reportDate: reportDate[i] ?? '',
  }))
}

function prefer(a: FilingRef, b: FilingRef): FilingRef {
  if (a.filingDate !== b.filingDate) return a.filingDate > b.filingDate ? a : b
  const aAmend = a.form.endsWith('/A')
  const bAmend = b.form.endsWith('/A')
  if (aAmend !== bAmend) return aAmend ? a : b
  return a.accessionNumber >= b.accessionNumber ? a : b
}

export interface ReportPeriodGroup {
  reportDate: string
  /** 同一报告期的全部 13F，优先者在前。第一份就是 selectReportPeriods 选中的那份。 */
  candidates: FilingRef[]
}

/**
 * 按报告期分组：申报日较新者在前，同一天修正案在前。
 * 结果按报告期从新到旧，最多 limit 期。
 */
export function groupReportPeriods(filings: FilingRef[], limit: number): ReportPeriodGroup[] {
  const byPeriod = new Map<string, FilingRef[]>()
  for (const filing of filings) {
    if (!FORM_13F.has(filing.form)) continue
    if (!filing.reportDate || !filing.accessionNumber) continue
    const list = byPeriod.get(filing.reportDate) ?? []
    list.push(filing)
    byPeriod.set(filing.reportDate, list)
  }
  return [...byPeriod.entries()]
    .map(([reportDate, list]) => ({
      reportDate,
      candidates: [...list].sort((a, b) => (prefer(a, b) === a ? -1 : 1)),
    }))
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : a.reportDate > b.reportDate ? -1 : 0))
    .slice(0, Math.max(0, limit))
}

/** 每个报告期只留一份：申报日较新者胜，同一天修正案胜。 */
export function selectReportPeriods(filings: FilingRef[], limit: number): FilingRef[] {
  return groupReportPeriods(filings, limit).map(group => group.candidates[0]!)
}

export type AmendmentType = 'RESTATEMENT' | 'NEW HOLDINGS'

/** 索引页里的封面 primary_doc.xml。xsl 那份是给人看的 HTML，不要。 */
export function primaryDocXmlPath(indexHtml: string): string | null {
  const links = [...indexHtml.matchAll(/href="([^"]+\.xml)"/gi)].map(match => decodeXml(match[1] ?? ''))
  return links.find(href => /primary_doc\.xml$/i.test(href) && !/xslForm13F/i.test(href)) ?? null
}

/**
 * 修正案的类型。NEW HOLDINGS 只列补报的持仓（例如保密期满的仓位），要和原报合起来；
 * RESTATEMENT 是整份重报。读不出来时当整份重报，和过去的行为一致。
 */
export function parseAmendmentType(primaryDocXml: string): AmendmentType {
  const raw = (tagText(primaryDocXml, 'amendmentType') ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
  return raw === 'NEW HOLDINGS' ? 'NEW HOLDINGS' : 'RESTATEMENT'
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 索引页里 INFORMATION TABLE 的原始 XML。xsl 那份是给人看的 HTML，不要。 */
export function informationTableXmlPath(indexHtml: string): string | null {
  const rows = indexHtml.split(/<tr\b/i).slice(1)
  for (const row of rows) {
    if (!/INFORMATION TABLE/i.test(row)) continue
    const links = [...row.matchAll(/href="([^"]+\.xml)"/gi)].map(match => decodeXml(match[1] ?? ''))
    const raw = links.find(href => href && !/xslForm13F/i.test(href))
    if (raw) return raw
  }
  return null
}

function tagText(block: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${name}>`, 'i')
  const match = re.exec(block)
  if (!match) return null
  return decodeXml(match[1].replace(/<[^>]+>/g, '').trim())
}

function normalizePutCall(raw: string | null): '' | 'Put' | 'Call' {
  const value = raw?.trim().toLowerCase() ?? ''
  if (value === 'put') return 'Put'
  if (value === 'call') return 'Call'
  return ''
}

export function parseInformationTable(xml: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  const blocks = xml.matchAll(/<(?:[\w.-]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?infoTable>/gi)
  for (const match of blocks) {
    const block = match[1] ?? ''
    const cusip = (tagText(block, 'cusip') ?? '').replace(/\s+/g, '').toUpperCase()
    const value = Number((tagText(block, 'value') ?? '').replace(/,/g, ''))
    const shares = Number((tagText(block, 'sshPrnamt') ?? '').replace(/,/g, ''))
    if (!cusip || !Number.isFinite(value) || !Number.isFinite(shares)) continue
    const shareType = (tagText(block, 'sshPrnamtType') ?? 'SH').trim().toUpperCase() || 'SH'
    rows.push({
      issuerName: tagText(block, 'nameOfIssuer') ?? '',
      titleOfClass: tagText(block, 'titleOfClass') ?? '',
      cusip,
      value,
      shares,
      shareType,
      putCall: normalizePutCall(tagText(block, 'putCall')),
    })
  }
  return rows
}

/** 同一只证券按 otherManager 拆开的行加总。Put 和正股不要并成一行。 */
export function aggregatePositions(rows: ParsedRow[], unit: ValueUnit): AggregatedPosition[] {
  const grouped = new Map<string, AggregatedPosition>()
  for (const row of rows) {
    const key = `${row.cusip}|${row.putCall}|${row.shareType}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        cusip: row.cusip,
        putCall: row.putCall,
        shareType: row.shareType,
        issuerName: row.issuerName,
        titleOfClass: row.titleOfClass,
        shares: row.shares,
        valueReported: row.value,
        valueUsd: toUsd(row.value, unit),
      })
      continue
    }
    existing.shares += row.shares
    existing.valueReported += row.value
    existing.valueUsd += toUsd(row.value, unit)
  }
  return [...grouped.values()]
}

/**
 * 原报和 NEW HOLDINGS 修正案已各自换算成美元后，按同一键再加一次。
 * 两份跨 2023-01-03 时 valueReported 的单位不同，相加没有意义；只有 valueUsd 可信。
 */
export function mergeAggregated(parts: AggregatedPosition[][]): AggregatedPosition[] {
  const grouped = new Map<string, AggregatedPosition>()
  for (const rows of parts) {
    for (const row of rows) {
      const key = `${row.cusip}|${row.putCall}|${row.shareType}`
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, { ...row })
        continue
      }
      existing.shares += row.shares
      existing.valueReported += row.valueReported
      existing.valueUsd += row.valueUsd
    }
  }
  return [...grouped.values()]
}
