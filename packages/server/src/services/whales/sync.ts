// 一家一家拉。传输层可换成测试夹具，正式环境走 sec.ts。
// 没有 User-Agent 时零请求：SEC 会拒，空跑还会把启动补拉的闸门写上。
import {
  aggregatePositions, filingsFromSubmissions, informationTableXmlPath, parseInformationTable,
  selectReportPeriods,
} from './parser.js'
import {
  absoluteArchiveUrl, COMPANY_TICKERS_URL, filingIndexUrl, submissionsUrl,
  type SecTransport,
} from './sec.js'
import {
  getFiling, getMeta, listInstitutions, markSync, replaceFiling, replaceTickers, setLastSyncAt,
  type WhaleInstitution,
} from './store.js'
import { parseCompanyTickers } from './tickers.js'
import { valueUnitForFilingDate } from './valueUnit.js'

export interface SyncCounts {
  ok: number
  empty: number
  failed: number
  skipped: boolean
}

export const WHALE_PERIODS = 8
const TICKER_TTL_MS = 7 * 24 * 60 * 60 * 1000

export async function syncWhales(opts: {
  transport: SecTransport
  userAgent: string | null
  now?: () => Date
  periods?: number
}): Promise<SyncCounts> {
  if (!opts.userAgent) return { ok: 0, empty: 0, failed: 0, skipped: true }
  const now = opts.now ?? (() => new Date())
  const at = now().toISOString()
  const periods = opts.periods ?? WHALE_PERIODS
  await refreshTickers(opts.transport, now())
  const counts: SyncCounts = { ok: 0, empty: 0, failed: 0, skipped: false }
  for (const inst of listInstitutions()) {
    try {
      const outcome = await syncInstitution(inst, opts.transport, periods, at)
      if (outcome === 'empty') counts.empty += 1
      else counts.ok += 1
      markSync(inst.slug, at, null)
    } catch (err) {
      counts.failed += 1
      const message = err instanceof Error ? err.message : String(err)
      markSync(inst.slug, at, message.slice(0, 500))
    }
  }
  setLastSyncAt(at)
  return counts
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

async function syncInstitution(
  inst: WhaleInstitution,
  transport: SecTransport,
  periods: number,
  fetchedAt: string,
): Promise<'ok' | 'empty'> {
  const doc = JSON.parse(await transport.getText(submissionsUrl(inst.cik))) as unknown
  const selected = selectReportPeriods(filingsFromSubmissions(doc), periods)
  if (selected.length === 0) return 'empty'
  for (const filing of selected) {
    const existing = getFiling(inst.slug, filing.reportDate)
    if (existing?.accession === filing.accessionNumber) continue
    const indexUrl = filingIndexUrl(inst.cik, filing.accessionNumber)
    const href = informationTableXmlPath(await transport.getText(indexUrl))
    if (!href) throw new Error(`找不到信息表 ${filing.accessionNumber}`)
    const xml = await transport.getText(absoluteArchiveUrl(href))
    const unit = valueUnitForFilingDate(filing.filingDate)
    replaceFiling({
      slug: inst.slug,
      accession: filing.accessionNumber,
      form: filing.form,
      reportPeriod: filing.reportDate,
      filedAt: filing.filingDate,
      sourceUrl: indexUrl,
      valueUnit: unit,
      fetchedAt,
      positions: aggregatePositions(parseInformationTable(xml), unit),
    })
  }
  return 'ok'
}
