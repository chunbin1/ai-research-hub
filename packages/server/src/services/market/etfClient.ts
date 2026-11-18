// packages/server/src/services/market/etfClient.ts
//
// A 股 ETF 盘后与实时数据客户端：
// - 东方财富日 K 线（不复权成交额/成交量/收盘价）
// - 东方财富基金历史单位净值（DWJZ）
// - 东方财富批量实时行情（f2 最新价 / f38 场内总份额 / f441 IOPV）
// - 上交所每日 ETF 规模（支持历史日期查询）
// - 深交所每日 ETF 规模列表（最新快照）

export type EtfMarket = 'SH' | 'SZ'

export interface EtfKlineBar {
  tradeDate: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  pctChange: number | null
}

export interface EtfRealtimeQuote {
  code: string
  name: string
  price: number
  amount: number
  totalShares: number | null
  iopv: number | null
}

export interface EtfClientDeps {
  fetch?: typeof globalThis.fetch
}

const REQUEST_TIMEOUT_MS = 8_000
const DEFAULT_UA = 'Mozilla/5.0'

/** 识别 6 位 A 股场内 ETF 代码对应的交易所；非场内宽基/股票返回 null。 */
export function inferEtfMarket(code: string): EtfMarket | null {
  const c = code.trim()
  if (!/^\d{6}$/.test(c)) return null
  if (c.startsWith('51') || c.startsWith('56') || c.startsWith('58')) return 'SH'
  if (c.startsWith('15')) return 'SZ'
  return null
}

export function toSecid(code: string, market: EtfMarket): string {
  return `${market === 'SH' ? '1' : '0'}.${code}`
}

function toFinite(val: unknown): number | null {
  if (typeof val === 'number') return Number.isFinite(val) ? val : null
  if (typeof val === 'string') {
    const clean = val.replace(/,/g, '').trim()
    if (!clean || clean === '-') return null
    const n = Number(clean)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function fetchJson<T>(url: string, headers: Record<string, string>, deps: EtfClientDeps): Promise<T> {
  const f = deps.fetch ?? globalThis.fetch
  const res = await f(url, {
    headers: { 'User-Agent': DEFAULT_UA, ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json() as Promise<T>
}

interface EastmoneyKlineResp {
  data?: { name?: string; klines?: string[] } | null
}

export async function fetchEtfKlines(
  code: string,
  market: EtfMarket,
  begYmd: string,
  endYmd: string,
  deps: EtfClientDeps = {},
): Promise<{ name: string; bars: EtfKlineBar[] }> {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${toSecid(code, market)}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f61` +
    `&klt=101&fqt=0&beg=${begYmd}&end=${endYmd}`
  const body = await fetchJson<EastmoneyKlineResp>(url, { Referer: 'https://quote.eastmoney.com/' }, deps)
  const raw = body.data?.klines ?? []
  const bars: EtfKlineBar[] = []
  for (const line of raw) {
    const parts = line.split(',')
    if (parts.length < 7) continue
    const [tradeDate, openS, closeS, highS, lowS, volS, amtS] = parts
    const open = toFinite(openS)
    const close = toFinite(closeS)
    const high = toFinite(highS)
    const low = toFinite(lowS)
    const volLots = toFinite(volS)
    const amount = toFinite(amtS)
    if (!tradeDate || open === null || close === null || high === null || low === null || volLots === null || amount === null) {
      continue
    }
    const prev = bars.length > 0 ? bars[bars.length - 1] : null
    const pctChange = prev && prev.close > 0 ? ((close - prev.close) / prev.close) * 100 : null
    bars.push({
      tradeDate,
      open,
      close,
      high,
      low,
      // 东财 K 线成交量单位是手（100 份），统一换算为份数与总份额同量纲
      volume: volLots * 100,
      amount,
      pctChange,
    })
  }
  return { name: body.data?.name ?? code, bars }
}

interface EastmoneyLsjzResp {
  Data?: { LSJZList?: Array<{ FSRQ?: string; DWJZ?: string }> } | null
}

export async function fetchEtfNavHistory(
  code: string,
  pages = 1,
  pageSize = 20,
  deps: EtfClientDeps = {},
): Promise<Record<string, number>> {
  const navMap: Record<string, number> = {}
  for (let page = 1; page <= pages; page++) {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=${page}&pageSize=${pageSize}`
    const body = await fetchJson<EastmoneyLsjzResp>(url, { Referer: 'https://fundf10.eastmoney.com/' }, deps)
    const list = body.Data?.LSJZList ?? []
    for (const item of list) {
      const dt = item.FSRQ?.trim()
      const nav = toFinite(item.DWJZ)
      if (dt && nav !== null && nav > 0) navMap[dt] = nav
    }
    if (list.length < pageSize) break
  }
  return navMap
}

interface EastmoneyUlistResp {
  data?: {
    diff?: Array<{
      f12?: string
      f14?: string
      f2?: unknown
      f6?: unknown
      f38?: unknown
      f441?: unknown
    }>
  } | null
}

export async function fetchEtfRealtimeBatch(
  items: Array<{ code: string; market: EtfMarket }>,
  deps: EtfClientDeps = {},
): Promise<Record<string, EtfRealtimeQuote>> {
  if (items.length === 0) return {}
  const secids = items.map(i => toSecid(i.code, i.market)).join(',')
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(secids)}&fields=f2,f3,f6,f12,f14,f38,f441`
  const body = await fetchJson<EastmoneyUlistResp>(url, { Referer: 'https://quote.eastmoney.com/' }, deps)
  const out: Record<string, EtfRealtimeQuote> = {}
  for (const row of body.data?.diff ?? []) {
    const code = row.f12?.trim()
    const price = toFinite(row.f2)
    const amount = toFinite(row.f6)
    if (!code || price === null || amount === null) continue
    const shares = toFinite(row.f38)
    const iopv = toFinite(row.f441)
    out[code] = {
      code,
      name: row.f14?.trim() ?? code,
      price,
      amount,
      totalShares: shares !== null && shares > 0 ? shares : null,
      iopv: iopv !== null && iopv > 0 ? iopv : null,
    }
  }
  return out
}

interface SseEtfResp {
  result?: Array<{ SEC_CODE?: string; TOT_VOL?: unknown }>
}

export async function fetchSseDailyShares(
  statDate: string,
  deps: EtfClientDeps = {},
): Promise<Record<string, number>> {
  const url =
    `https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L` +
    `&STAT_DATE=${encodeURIComponent(statDate)}&pageHelp.pageSize=1000`
  const body = await fetchJson<SseEtfResp>(url, { Referer: 'https://www.sse.com.cn/' }, deps)
  const out: Record<string, number> = {}
  for (const row of body.result ?? []) {
    const code = row.SEC_CODE?.trim()
    const wanShares = toFinite(row.TOT_VOL)
    if (code && wanShares !== null && wanShares > 0) {
      out[code] = Math.round(wanShares * 10_000)
    }
  }
  return out
}

interface SzseReportEntry {
  metadata?: { subname?: string; cols?: { dqgm?: string } }
  data?: Array<{ sys_key?: string; dqgm?: string }>
}

export interface SzseLatestShares {
  snapshotDate: string
  shareDate?: string
  totalShares: number
}

export async function fetchSzseLatestShares(
  code: string,
  deps: EtfClientDeps = {},
): Promise<SzseLatestShares | null> {
  const url =
    `https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1945&TABKEY=tab1` +
    `&txtQueryKeyAndJC=${encodeURIComponent(code)}`
  const body = await fetchJson<SzseReportEntry[]>(url, { Referer: 'https://www.szse.cn/' }, deps)
  const report = body?.[0]
  const snapshotDate = report?.metadata?.subname?.trim()
  if (!snapshotDate || !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return null
  const needle = `<u>${code}</u>`
  const row = report?.data?.find(d => d.sys_key?.includes(needle) || d.sys_key?.includes(code))
  const wanShares = toFinite(row?.dqgm)
  if (wanShares === null || wanShares <= 0) return null
  const dqgmCol = report?.metadata?.cols?.dqgm
  const shareDateMatch = typeof dqgmCol === 'string' ? dqgmCol.match(/(\d{4}-\d{2}-\d{2})/) : null
  const shareDate = shareDateMatch?.[1]
  return {
    snapshotDate,
    ...(shareDate ? { shareDate } : {}),
    totalShares: Math.round(wanShares * 10_000),
  }
}

interface EastmoneyStockInfoResp {
  data?: { f57?: string; f58?: string } | null
}

export async function probeEtfInfo(
  code: string,
  deps: EtfClientDeps = {},
): Promise<{ code: string; market: EtfMarket; name: string } | null> {
  const clean = code.trim()
  const market = inferEtfMarket(clean)
  if (!market) return null
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${toSecid(clean, market)}&fields=f57,f58`
  const body = await fetchJson<EastmoneyStockInfoResp>(url, { Referer: 'https://quote.eastmoney.com/' }, deps)
  const gotCode = body.data?.f57?.trim()
  const name = body.data?.f58?.trim()
  if (!gotCode || gotCode !== clean || !name) return null
  return { code: clean, market, name }
}
