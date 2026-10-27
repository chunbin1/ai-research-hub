// 众议院年度财务披露。佩洛西不报 13F，持仓在 Clerk 的 Schedule A，金额是区间。
import { extractText, getDocumentProxy } from 'unpdf'
import type { AggregatedPosition } from './parser.js'
import type { SecTransport } from './sec.js'

const HOUSE_HOST = 'disclosures-clerk.house.gov'
const TRADED = new Set(['ST', 'OP', 'MF'])

export interface HouseMember {
  last: string
  first: string
}

export interface HouseAnnualRef {
  year: number
  docId: string
  filedAt: string
  reportPeriod: string
  pdfUrl: string
}

export function houseFdIndexUrl(year: number): string {
  return `https://${HOUSE_HOST}/public_disc/financial-pdfs/${year}FD.txt`
}

export function houseAnnualPdfUrl(year: number, docId: string): string {
  if (!/^\d{4,12}$/.test(docId)) throw new Error(`拒绝非众议院文档编号 ${docId}`)
  return `https://${HOUSE_HOST}/public_disc/financial-pdfs/${year}/${docId}.pdf`
}

export function parseHouseAnnualIndex(text: string, member: HouseMember): HouseAnnualRef[] {
  const found: HouseAnnualRef[] = []
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split('\t')
    if (cols.length < 9) continue
    const last = cols[1]?.trim()
    const first = cols[2]?.trim()
    const filingType = cols[4]?.trim()
    const year = Number(cols[6]?.trim())
    const filedAt = isoDate(cols[7]?.trim() ?? '')
    const docId = cols[8]?.trim() ?? ''
    if (last !== member.last || first !== member.first) continue
    if (filingType !== 'O' || !filedAt || !Number.isInteger(year) || !/^\d{4,12}$/.test(docId)) continue
    found.push({
      year,
      docId,
      filedAt,
      reportPeriod: `${year}-12-31`,
      pdfUrl: houseAnnualPdfUrl(year, docId),
    })
  }
  return found
}

/** 最近三年的年度报告里，取申报日最晚的一份。某年索引 404 就跳过。 */
export async function findHouseAnnual(
  transport: SecTransport,
  member: HouseMember,
  now: Date,
): Promise<HouseAnnualRef | null> {
  const year = now.getUTCFullYear()
  const found: HouseAnnualRef[] = []
  for (const candidate of [year, year - 1, year - 2]) {
    let index: string
    try {
      index = await transport.getText(houseFdIndexUrl(candidate))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/\b404\b/.test(message)) continue
      throw err
    }
    found.push(...parseHouseAnnualIndex(index, member))
  }
  found.sort((a, b) => b.filedAt.localeCompare(a.filedAt) || b.year - a.year)
  return found[0] ?? null
}

export function parseHouseHoldings(text: string): AggregatedPosition[] {
  const cleaned = text.replace(/\u0000/g, '')
  const scheduleB = cleaned.search(/Asset Owner Date/)
  const body = scheduleB === -1 ? cleaned : cleaned.slice(0, scheduleB)
  const marks = [...body.matchAll(/\[(ST|OP|MF)\]/g)]
  const rows: AggregatedPosition[] = []
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]
    if (!mark || mark.index === undefined) continue
    const code = mark[1] ?? ''
    if (!TRADED.has(code)) continue
    const start = i === 0 ? 0 : (marks[i - 1]?.index ?? 0) + (marks[i - 1]?.[0].length ?? 0)
    const name = issuerName(body.slice(start, mark.index))
    const next = marks[i + 1]?.index ?? body.length
    const rest = body.slice(mark.index + mark[0].length, next)
    const value = rest.match(/^\s*(?:SP|JT|DC)?\s*(None|\$[\d,]+)(?:\s*-\s*(\$[\d,]+))?/)
    if (!value || value[1] === 'None') continue
    const low = money(value[1] ?? '')
    const high = value[2] ? money(value[2]) : low
    if (low === null || high === null) continue
    const ticker = name.match(/\(([A-Z]{1,5})\)\s*$/)?.[1]
    if (!ticker) continue
    const callShares = sumOptionContracts(rest, 'call')
    const putShares = sumOptionContracts(rest, 'put')
    const puts = putShares > 0 || (callShares === 0 && /put options/i.test(rest))
    rows.push({
      cusip: ticker,
      putCall: code === 'OP' ? (puts ? 'Put' : 'Call') : '',
      shareType: '',
      issuerName: name,
      titleOfClass: code === 'OP' ? 'OPTION' : code === 'MF' ? 'FUND' : 'COM',
      shares: callShares + putShares,
      valueReported: high,
      valueUsd: (low + high) / 2,
      valueLabel: formatUsdRange(low, high),
    })
  }
  return rows
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes)
  const extracted = await extractText(pdf, { mergePages: true })
  return extracted.text
}

/** 同一段说明里可能写多笔，例如「50 call options … and 20 call options」，合约数要加总。 */
function sumOptionContracts(text: string, kind: 'call' | 'put'): number {
  const re = new RegExp(`(\\d[\\d,]*)\\s+${kind} options`, 'gi')
  let total = 0
  for (const match of text.matchAll(re)) {
    const n = Number(match[1]?.replace(/,/g, ''))
    if (Number.isFinite(n)) total += n
  }
  return total
}

function issuerName(raw: string): string {
  const compact = raw.replace(/\s+/g, ' ').trim()
  const cuts = [...compact.matchAll(/\$[\d,]+|None\b|Dividends|Capital|Partnership|Rent|Interest|Grape Sales|Asset Owner|Filing ID/g)]
  const last = cuts[cuts.length - 1]
  const from = last?.index === undefined ? 0 : last.index + last[0].length
  let name = compact.slice(from).replace(/^[\s\-–:]+/, '').trim()
  // 上一句的句号才切开。Inc. 前面不是连续四个小写字母，不会被切开。
  const parts = name.split(/(?<=[a-z]{4}|\d)\. (?=[A-Z])/)
  name = (parts[parts.length - 1] ?? name).trim().replace(/^[^A-Za-z]+/, '')
  return name
}

function money(token: string): number | null {
  const n = Number(token.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function isoDate(input: string): string | null {
  const match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  return `${match[3]}-${match[1]!.padStart(2, '0')}-${match[2]!.padStart(2, '0')}`
}

export function formatUsdRange(low: number, high: number): string {
  const fmt = (n: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n)
  return `${fmt(low)}–${fmt(high)}`
}

export function parseUsdRangeLabel(label: string): { low: number; high: number } | null {
  const match = label.match(/^([\d,]+)–([\d,]+)$/)
  if (!match) return null
  const low = Number(match[1]?.replace(/,/g, ''))
  const high = Number(match[2]?.replace(/,/g, ''))
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  return { low, high }
}
