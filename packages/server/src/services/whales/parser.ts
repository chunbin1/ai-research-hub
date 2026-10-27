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

/**
 * 每个报告期只留一份：申报日较新者胜，同一天修正案胜。
 * 结果按报告期从新到旧，最多 limit 期。
 */
export function selectReportPeriods(filings: FilingRef[], limit: number): FilingRef[] {
  const byPeriod = new Map<string, FilingRef>()
  for (const filing of filings) {
    if (!FORM_13F.has(filing.form)) continue
    if (!filing.reportDate || !filing.accessionNumber) continue
    const prev = byPeriod.get(filing.reportDate)
    byPeriod.set(filing.reportDate, prev ? prefer(prev, filing) : filing)
  }
  return [...byPeriod.values()]
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : a.reportDate > b.reportDate ? -1 : 0))
    .slice(0, Math.max(0, limit))
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
