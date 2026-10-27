// SEC company_tickers.json 只有公司名，没有 CUSIP。
// 归一化后刚好一个 ticker 才用。A/B 股（两个 ticker、同一个名字）放弃，避免猜错。

const SUFFIXES = new Set([
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'LTD', 'LIMITED',
  'PLC', 'CO', 'COMPANY', 'LLC', 'LP', 'SA', 'NV', 'AG',
])

export interface TickerRow {
  ticker: string
  title: string
  cik: string
}

export function normalizeIssuerName(name: string): string {
  const cleaned = name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = cleaned.split(' ').filter(Boolean)
  while (parts.length > 1 && parts[0] === 'THE') parts.shift()
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1] ?? '')) parts.pop()
  return parts.join(' ')
}

export function parseCompanyTickers(text: string): TickerRow[] {
  const doc = JSON.parse(text) as Record<string, { ticker?: unknown; title?: unknown; cik_str?: unknown }>
  const rows: TickerRow[] = []
  for (const item of Object.values(doc)) {
    if (!item || typeof item.ticker !== 'string' || typeof item.title !== 'string') continue
    const ticker = item.ticker.trim().toUpperCase()
    if (!ticker) continue
    const cik = typeof item.cik_str === 'number' ? String(item.cik_str).padStart(10, '0') : ''
    rows.push({ ticker, title: item.title.trim(), cik })
  }
  return rows
}

/** 归一化公司名 → 唯一 ticker；重名或未知为 null。 */
export function buildTickerIndex(rows: { ticker: string; title: string }[]): Map<string, string | null> {
  const grouped = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = normalizeIssuerName(row.title)
    if (key.length < 2) continue
    const set = grouped.get(key) ?? new Set<string>()
    set.add(row.ticker.trim().toUpperCase())
    grouped.set(key, set)
  }
  const index = new Map<string, string | null>()
  for (const [key, set] of grouped) {
    index.set(key, set.size === 1 ? [...set][0] ?? null : null)
  }
  return index
}

export function matchTicker(rows: { ticker: string; title: string }[], issuerName: string): string | null {
  const key = normalizeIssuerName(issuerName)
  if (key.length < 2) return null
  return buildTickerIndex(rows).get(key) ?? null
}
