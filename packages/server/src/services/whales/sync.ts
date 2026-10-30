// 一家一家拉。传输层可换成测试夹具，正式环境走 sec.ts。
// 没有 User-Agent 时不请求 SEC：SEC 会拒，而且空跑不该把启动补拉的闸门写上。
// skipped 仍只表示「13F 跳过」。众议院披露不依赖 SEC UA；只要本轮实际跑过机构（含仅 house-fd），就写 lastSyncAt。
import {
  aggregatePositions, filingsFromSubmissions, groupReportPeriods, informationTableXmlPath, mergeAggregated,
  parseAmendmentType, parseInformationTable, primaryDocXmlPath, type AggregatedPosition, type FilingRef,
} from './parser.js'
import { resolveSecUserAgent } from './enabled.js'
import {
  absoluteArchiveUrl, COMPANY_TICKERS_URL, createSecTransport, filingIndexUrl, submissionsUrl,
  type SecTransport,
} from './sec.js'
import {
  getFiling, getInstitution, getMeta, listInstitutions, markSync, replaceFiling, replaceTickers, setLastSyncAt,
  type WhaleInstitution,
} from './store.js'
import { parseCompanyTickers } from './tickers.js'
import { valueUnitForFilingDate } from './valueUnit.js'
import { HOUSE_DISCLOSURE_MEMBERS } from './seed.js'
import {
  extractPdfText, findHouseAnnual, parseHouseHoldings,
} from './houseDisclosure.js'

export interface SyncCounts {
  ok: number
  empty: number
  failed: number
  skipped: boolean
}

// 估算成本要从建仓那一期算起，所以多留历史。filings.recent 对种子机构大约覆盖十年 13F。
export const WHALE_PERIODS = 40
const TICKER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function syncWhales(opts: {
  transport: SecTransport
  userAgent: string | null
  now?: () => Date
  periods?: number
  extractPdfText?: (bytes: Uint8Array) => Promise<string>
}): Promise<SyncCounts> {
  const now = opts.now ?? (() => new Date())
  const at = now().toISOString()
  const periods = opts.periods ?? WHALE_PERIODS
  const extract = opts.extractPdfText ?? extractPdfText
  if (opts.userAgent) await refreshTickers(opts.transport, now())
  const counts: SyncCounts = { ok: 0, empty: 0, failed: 0, skipped: !opts.userAgent }
  let ran = false
  for (const inst of listInstitutions()) {
    if (inst.source !== 'house-fd' && !opts.userAgent) continue
    ran = true
    try {
      const outcome = inst.source === 'house-fd'
        ? await syncHouseInstitution(inst, opts.transport, at, now(), extract)
        : await syncInstitution(inst, opts.transport, periods, at)
      if (outcome === 'empty') counts.empty += 1
      else counts.ok += 1
      markSync(inst.slug, at, null)
    } catch (err) {
      counts.failed += 1
      const message = err instanceof Error ? err.message : String(err)
      markSync(inst.slug, at, message.slice(0, 500))
    }
  }
  if (ran) setLastSyncAt(at)
  return counts
}

export type OneSync = 'ok' | 'empty' | 'failed' | 'skipped'

/** 只拉一家。不改 whale_meta.last_sync_at，避免一次手加就把启动补拉的闸门写上。 */
export async function syncOneWhale(slug: string, opts: {
  transport?: SecTransport
  userAgent?: string | null
  now?: () => Date
  periods?: number
} = {}): Promise<OneSync> {
  const inst = getInstitution(slug)
  if (!inst) throw new Error(`没有这家机构 ${slug}`)
  const now = opts.now ?? (() => new Date())
  const at = now().toISOString()
  const userAgent = opts.userAgent === undefined ? resolveSecUserAgent() : opts.userAgent
  if (!userAgent) {
    markSync(slug, at, '未配置 SEC_USER_AGENT 或 WHALES_CONTACT_EMAIL')
    return 'skipped'
  }
  const transport = opts.transport ?? createSecTransport(userAgent)
  try {
    await refreshTickers(transport, now())
    const outcome = await syncInstitution(inst, transport, opts.periods ?? WHALE_PERIODS, at)
    markSync(slug, at, null)
    return outcome
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    markSync(slug, at, message.slice(0, 500))
    return 'failed'
  }
}

async function refreshTickers(transport: SecTransport, now: Date): Promise<void> {
  const fetchedAt = getMeta().tickersFetchedAt
  if (fetchedAt) {
    const then = Date.parse(fetchedAt)
    if (!Number.isNaN(then) && now.getTime() - then < TICKER_TTL_MS) return
  }
  try {
    const text = await transport.getText(COMPANY_TICKERS_URL)
    const rows = parseCompanyTickers(text)
    if (rows.length > 0) replaceTickers(rows, now.toISOString())
  } catch {
    // 公司名表失败不影响已经能展示的申报名称
  }
}

async function syncHouseInstitution(
  inst: WhaleInstitution,
  transport: SecTransport,
  fetchedAt: string,
  now: Date,
  extract: (bytes: Uint8Array) => Promise<string>,
): Promise<'ok' | 'empty'> {
  const member = HOUSE_DISCLOSURE_MEMBERS[inst.slug]
  if (!member) throw new Error(`没有众议院披露对象 ${inst.slug}`)
  const annual = await findHouseAnnual(transport, member, now)
  if (!annual) return 'empty'
  const existing = getFiling(inst.slug, annual.reportPeriod)
  if (existing?.accession === annual.docId) return 'ok'
  if (!transport.getBytes) throw new Error('传输层不能下载 PDF')
  const text = await extract(await transport.getBytes(annual.pdfUrl))
  const positions = parseHouseHoldings(text)
  if (positions.length === 0) throw new Error('年度披露没有解析出上市证券')
  replaceFiling({
    slug: inst.slug,
    accession: annual.docId,
    form: '年度披露',
    reportPeriod: annual.reportPeriod,
    filedAt: annual.filedAt,
    sourceUrl: annual.pdfUrl,
    valueUnit: 'dollars',
    fetchedAt,
    positions,
  })
  return 'ok'
}

async function syncInstitution(
  inst: WhaleInstitution,
  transport: SecTransport,
  periods: number,
  fetchedAt: string,
): Promise<'ok' | 'empty'> {
  const doc = JSON.parse(await transport.getText(submissionsUrl(inst.cik))) as unknown
  const groups = groupReportPeriods(filingsFromSubmissions(doc), periods)
  if (groups.length === 0) return 'empty'
  for (const { candidates } of groups) {
    const filing = candidates[0]!
    const existing = getFiling(inst.slug, filing.reportDate)
    // 修正案要知道类型才算拉全。加 amendment_type 之前入库的修正案（null）重拉一次。
    const amended = filing.form.endsWith('/A')
    if (existing?.accession === filing.accessionNumber && (!amended || existing.amendmentType !== null)) continue
    const { amendmentType, positions } = await fetchPeriodPositions(inst.cik, candidates, transport)
    const unit = valueUnitForFilingDate(filing.filingDate)
    replaceFiling({
      slug: inst.slug,
      accession: filing.accessionNumber,
      form: filing.form,
      reportPeriod: filing.reportDate,
      filedAt: filing.filingDate,
      sourceUrl: filingIndexUrl(inst.cik, filing.accessionNumber),
      valueUnit: unit,
      fetchedAt,
      amendmentType,
      positions,
    })
  }
  return 'ok'
}

/**
 * 一个报告期的持仓。从优先的那份往下看：NEW HOLDINGS 修正案只补报几行，
 * 要继续往下找到原报或整份重报，再把补报的行加进去。
 */
async function fetchPeriodPositions(
  cik: string,
  candidates: FilingRef[],
  transport: SecTransport,
): Promise<{ amendmentType: string; positions: AggregatedPosition[] }> {
  const parts: AggregatedPosition[][] = []
  let winnerType: string | null = null
  let foundBase = false
  for (const filing of candidates) {
    const indexUrl = filingIndexUrl(cik, filing.accessionNumber)
    const indexHtml = await transport.getText(indexUrl)
    let type = ''
    if (filing.form.endsWith('/A')) {
      const primary = primaryDocXmlPath(indexHtml)
      type = primary
        ? parseAmendmentType(await transport.getText(absoluteArchiveUrl(primary, indexUrl)))
        : 'RESTATEMENT'
    }
    winnerType ??= type
    const href = informationTableXmlPath(indexHtml)
    if (!href) throw new Error(`找不到信息表 ${filing.accessionNumber}`)
    const xml = await transport.getText(absoluteArchiveUrl(href, indexUrl))
    parts.push(aggregatePositions(parseInformationTable(xml), valueUnitForFilingDate(filing.filingDate)))
    if (type !== 'NEW HOLDINGS') {
      foundBase = true
      break
    }
  }
  if (!foundBase) {
    // 原报不在 filings.recent 里：只能先存补报的几行，这一期是残缺的。
    console.warn(`[whales] ${cik} 报告期 ${candidates[0]?.reportDate} 只找到 NEW HOLDINGS 修正案，没有原报，持仓不完整`)
  }
  return { amendmentType: winnerType ?? '', positions: mergeAggregated(parts) }
}
