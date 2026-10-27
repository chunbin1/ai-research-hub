// SEC 公平访问：data.sec.gov 和 www.sec.gov 共用一条队列，串行且低于每秒 10 次。

export interface SecTransport {
  getText(url: string): Promise<string>
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

export function absoluteArchiveUrl(href: string): string {
  if (href.startsWith('https://') || href.startsWith('http://')) return href
  if (href.startsWith('/')) return `https://www.sec.gov${href}`
  return `https://www.sec.gov/${href}`
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

export async function secGetText(
  url: string,
  opts: { userAgent: string; wait: () => Promise<void> },
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await opts.wait()
    const response = await fetch(url, {
      headers: {
        'User-Agent': opts.userAgent,
        Accept: 'application/json, text/html, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    })
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
  }
}
