// SEC 公平访问：data.sec.gov 和 www.sec.gov 共用一条队列，串行且低于每秒 10 次。

export interface SecTransport {
  getText(url: string): Promise<string>
  getBytes?(url: string): Promise<Uint8Array>
}

export const COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
export const MIN_INTERVAL_MS = 150

export function submissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`
}

export function filingIndexUrl(cik: string, accession: string): string {
  const numeric = cik.replace(/^0+/, '') || '0'
  const compact = accession.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${numeric}/${compact}/${accession}-index.htm`
}

/** 信息表链接只允许打到 SEC 的 https。相对路径按 filing index 所在目录解析。 */
const SEC_ARCHIVE_HOSTS = new Set(['www.sec.gov', 'data.sec.gov'])
const HOUSE_DISCLOSURE_HOST = 'disclosures-clerk.house.gov'

/** getBytes 只给众议院 PDF 用。主机不在白名单就拒绝，避免以后误传 URL 变成开放代理。 */
export function assertHouseDisclosureUrl(raw: string): string {
  let resolved: URL
  try {
    resolved = new URL(raw)
  } catch {
    throw new Error('拒绝非众议院披露地址（无法解析）')
  }
  if (resolved.username || resolved.password) {
    throw new Error('拒绝非众议院披露地址（含凭据）')
  }
  if (resolved.protocol !== 'https:') {
    throw new Error(`拒绝非众议院披露地址（${resolved.protocol || '未知协议'}）`)
  }
  const host = resolved.hostname.toLowerCase().replace(/\.$/, '')
  if (host !== HOUSE_DISCLOSURE_HOST) {
    throw new Error(`拒绝非众议院披露地址（${host || '无主机'}）`)
  }
  return resolved.href
}

export function absoluteArchiveUrl(href: string, indexUrl: string): string {
  const trimmed = href.trim()
  if (!trimmed) throw new Error('拒绝非 SEC 档案地址（空链接）')
  let resolved: URL
  try {
    resolved = new URL(trimmed, indexUrl)
  } catch {
    throw new Error('拒绝非 SEC 档案地址（无法解析）')
  }
  if (resolved.username || resolved.password) {
    throw new Error('拒绝非 SEC 档案地址（含凭据）')
  }
  if (resolved.protocol !== 'https:') {
    throw new Error(`拒绝非 SEC 档案地址（${resolved.protocol || '未知协议'}）`)
  }
  const host = resolved.hostname.toLowerCase().replace(/\.$/, '')
  if (!SEC_ARCHIVE_HOSTS.has(host)) {
    throw new Error(`拒绝非 SEC 档案地址（${host || '无主机'}）`)
  }
  return resolved.href
}

export function createSecLimiter(minIntervalMs = MIN_INTERVAL_MS): () => Promise<void> {
  let next = 0
  return async function wait() {
    const now = Date.now()
    const at = Math.max(now, next)
    next = at + minIntervalMs
    const delay = at - now
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
  }
}

export const SEC_FETCH_TIMEOUT_MS = 30_000

export async function secGetText(
  url: string,
  opts: { userAgent: string; wait: () => Promise<void>; timeoutMs?: number },
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? SEC_FETCH_TIMEOUT_MS
  for (let attempt = 0; attempt < 2; attempt++) {
    await opts.wait()
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': opts.userAgent,
          Accept: 'application/json, text/html, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : ''
      if (name === 'TimeoutError' || name === 'AbortError') throw new Error(`SEC 超时 ${url}`)
      throw err
    }
    if ((response.status === 429 || response.status === 503) && attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    if (!response.ok) throw new Error(`SEC ${response.status} ${url}`)
    return await response.text()
  }
  throw new Error(`SEC retry failed ${url}`)
}

export function createSecTransport(userAgent: string, minIntervalMs = MIN_INTERVAL_MS): SecTransport {
  const wait = createSecLimiter(minIntervalMs)
  return {
    getText(url: string) {
      return secGetText(url, { userAgent, wait })
    },
    async getBytes(url: string) {
      const allowed = assertHouseDisclosureUrl(url)
      await wait()
      const response = await fetch(allowed, {
        headers: { 'User-Agent': userAgent, Accept: 'application/pdf,*/*' },
        signal: AbortSignal.timeout(SEC_FETCH_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`下载失败 ${response.status} ${url}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}
