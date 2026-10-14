// packages/server/src/services/market/cnSymbolSearch.ts
//
// 中文简称 / 拼音 / 别名这一路。Yahoo /v1/finance/search 对纯中文直接 400,
// 英文名也只认它自己收录的法定名(智谱上市后英文名是 Z.AI,搜 Zhipu 对不上)。
// 腾讯 smartbox 按中文名、拼音缩写(zp)和常见别名(zhipu、Z.AI)返回港股与美股,
// 新上市的 5 位港股代码也在里面。这里只负责把候选收成和 Yahoo 同一套
// SymbolSearchHit,权证 / 人民币柜台 / ETF / 粉单 / A 股一律丢掉。
import { normalizeSymbol } from './symbol.js'
import { YahooError, type SymbolSearchHit, type YahooDeps } from './yahooClient.js'

const SUGGEST_URL = 'https://smartbox.gtimg.cn/s3/'
/** 单次 smartbox 请求的上限。缩短候选最多再打 4 次,不能让一路挂起拖住 Yahoo。 */
const CN_FETCH_TIMEOUT_MS = 3000

/**
 * 用户经常在简称后面再接组织形式(阿里巴巴集团、腾讯控股有限公司)。
 * 上游只索引简称或法定中文名,这些尾巴要削掉再查一次。
 * 按长度从长到短,避免「公司」先于「有限公司」被削掉。
 */
const ORG_SUFFIXES = [
  '股份有限公司',
  '有限责任公司',
  '集团股份',
  '控股集团',
  '有限公司',
  '集团',
  '控股',
  '国际',
  '股份',
  '公司',
]

/** smartbox 美股代码后缀 → 交给 normalizeSymbol 的交易所前缀。`.ps` 是粉单,不在这里。 */
const US_SUFFIX: Record<string, string> = {
  oq: 'NASDAQ',
  n: 'NYSE',
  am: 'AMEX',
}

/** 正股名字上的投票权 / 次级上市后缀,匹配简称时不当成名字的一部分。 */
function coreName(name: string): string {
  return name.replace(/-(W|SW|S|B|SS)$/i, '')
}

function stripOrgSuffix(name: string): string | null {
  for (const suffix of ORG_SUFFIXES) {
    if (name.endsWith(suffix) && name.length - suffix.length >= 2) {
      return name.slice(0, -suffix.length)
    }
  }
  return null
}

/**
 * 全名比上游索引的简称长一截时,按这个顺序再试,最多 4 次:
 * 先削「集团 / 有限公司」这类尾巴,再取开头的连续汉字,最后逐字缩短。
 * 原查询本身不在里面 —— 调用方已经查过了。
 */
export function shortenCandidates(query: string): string[] {
  const q = query.trim()
  const out: string[] = []
  const push = (s: string) => {
    const t = s.trim()
    if (t.length < 2 || t === q || out.includes(t)) return
    out.push(t)
  }

  let cur = q
  for (let i = 0; i < 2; i++) {
    const next = stripOrgSuffix(cur)
    if (!next) break
    push(next)
    cur = next
  }

  const leading = /^[\u3400-\u9fff]+/.exec(q)?.[0] ?? ''
  if (leading) push(leading)
  for (let n = leading.length - 1; n >= 2 && out.length < 4; n--) {
    push(leading.slice(0, n))
  }
  return out.slice(0, 4)
}

/** 响应里的中文有时是 `\u667a\u8c31` 这种转义,有时已经是 UTF-8。两种都收。 */
function decodeUnicodeEscapes(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * 港股人民币柜台的代码在 8xxxx(80700、83690、89988)。
 * 名字以 r / wr 结尾不是柜台的充分条件:Uber、Star 这类名字也会撞上。
 */
function isRmbCounter(market: string, code: string): boolean {
  if (market !== 'hk') return false
  const digits = code.replace(/\D/g, '')
  if (!digits) return false
  const normalized = digits.length >= 5 ? digits : digits.padStart(5, '0')
  return normalized.length === 5 && normalized.startsWith('8')
}

/**
 * smartbox 把港股投票权 / 次级上市写成名字尾巴:`美团w` → `美团-W`。
 * 只动港股。美股名字(Snow)末尾的 w 是拼写,不是后缀。
 */
function displayName(market: string, name: string): string {
  if (market !== 'hk') return name
  if (/sw$/i.test(name)) return `${name.slice(0, -2)}-SW`
  if (/w$/i.test(name)) return `${name.slice(0, -1)}-W`
  return name
}

function classifyHint(market: string, code: string, name: string, type: string): SymbolSearchHit | null {
  if (!code || !name || type !== 'GP') return null
  if (/[购沽]|etf|做空|做多/i.test(name)) return null
  if (isRmbCounter(market, code)) return null

  if (market === 'hk') {
    if (!/^\d{1,5}$/.test(code)) return null
    const norm = normalizeSymbol(`${code}.HK`)
    if (!norm) return null
    return { symbol: norm.symbol, name: displayName(market, name), market: 'HK', exchange: 'Hong Kong' }
  }

  if (market === 'us') {
    const m = /^([A-Za-z]{1,5})\.(oq|n|am)$/i.exec(code)
    if (!m) return null
    const prefix = US_SUFFIX[m[2].toLowerCase()]
    const norm = normalizeSymbol(`${prefix}: ${m[1]}`)
    if (!norm) return null
    return { symbol: norm.symbol, name: displayName(market, name), market: 'US', exchange: prefix }
  }

  return null
}

function parseHint(body: string): SymbolSearchHit[] {
  const decoded = decodeUnicodeEscapes(body)
  const matched = /v_hint="([^"]*)"/.exec(decoded)
  if (!matched) {
    throw new YahooError('中文行情源响应缺少 v_hint', 'bad_response')
  }
  const hint = matched[1]
  // `N` 是上游的「没有匹配」,不是一只代码为 N 的股票。
  if (hint === 'N' || hint === '') return []

  const hits: SymbolSearchHit[] = []
  const seen = new Set<string>()
  for (const row of hint.split('^')) {
    if (!row) continue
    const [market, code, name, , type] = row.split('~')
    const hit = classifyHint((market ?? '').toLowerCase(), (code ?? '').trim(), (name ?? '').trim(), (type ?? '').trim())
    if (!hit || seen.has(hit.symbol)) continue
    seen.add(hit.symbol)
    hits.push(hit)
  }
  return hits
}

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

function cnTimeoutMs(deps: YahooDeps): number {
  const ms = deps.cnTimeoutMs
  if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return ms
  return CN_FETCH_TIMEOUT_MS
}

async function fetchCnOnce(query: string, deps: YahooDeps): Promise<SymbolSearchHit[]> {
  const doFetch = deps.fetchImpl ?? fetch
  const url = `${SUGGEST_URL}?v=2&q=${encodeURIComponent(query)}&t=all`
  let res: Response
  try {
    res = await doFetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(cnTimeoutMs(deps)),
    })
  } catch (err) {
    if (isAbortLike(err)) {
      throw new YahooError(`搜索「${query}」: 中文行情源超时`, 'bad_response')
    }
    throw err
  }
  if (res.status === 404) return []
  if (!res.ok) {
    throw new YahooError(`搜索「${query}」: 中文行情源 HTTP ${res.status}`, 'bad_response')
  }
  let text: string
  try {
    text = await res.text()
  } catch {
    throw new YahooError(`搜索「${query}」: 中文行情源响应不是文本`, 'bad_response')
  }
  try {
    return parseHint(text)
  } catch (err) {
    if (err instanceof YahooError) throw err
    throw new YahooError(`搜索「${query}」: 中文行情源响应无法解析`, 'bad_response')
  }
}

/**
 * 用户输入的全名以某条命中的中文名为前缀,才接受缩短后的结果。
 * 「智谱华章」收「智谱」,不收缩短到「华」时冒出来的别的公司。
 */
function extendsListedName(query: string, hit: SymbolSearchHit): boolean {
  const core = hit.name ? coreName(hit.name) : ''
  return core.length >= 2 && query.startsWith(core)
}

/**
 * 按中文名、拼音或别名搜美股 / 港股。空串不打网络。
 * 全称对不上时再试缩短后的简称,仍然要求公司名是用户输入的前缀。
 */
export async function searchCnSymbols(
  query: string,
  deps: YahooDeps = {},
): Promise<SymbolSearchHit[]> {
  const q = query.trim()
  if (!q) return []

  const direct = await fetchCnOnce(q, deps)
  if (direct.length > 0) return direct
  // 没有汉字就不必缩短 —— 「zhipu」「zp」这类别名上游自己会命中,缩短只会放大噪音。
  if (!/[\u3400-\u9fff]/.test(q)) return []

  for (const candidate of shortenCandidates(q)) {
    const hits = await fetchCnOnce(candidate, deps)
    const matched = hits.filter(hit => extendsListedName(q, hit))
    if (matched.length > 0) return matched
  }
  return []
}
