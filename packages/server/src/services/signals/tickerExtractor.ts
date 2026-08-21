// packages/server/src/services/signals/tickerExtractor.ts
//
// 只从标题(文档标题 + 章节标题)抽标的,正文一概不看 —— 标题里抽不到
// 就不加入自选股。这是刻意的取舍:正文的公司扫描表格召回率高得多,
// 但需要 LLM 抽取与人工确认,留给后续版本。
import { normalizeSymbol, type Market } from '../market/symbol.js'

export interface ExtractedTicker {
  symbol: string
  market: Market
  /** 抽中的原始标题串,排错时能一眼看出是从哪句抽的 */
  sourceText: string
}

/** ① 交易所前缀形式:NYSE: ALB / NASDAQ: SGML / ASX: PLS(后者会被 normalizeSymbol 丢掉) */
const WITH_EXCHANGE = /\b(NYSE\s+AMERICAN|NYSEAMERICAN|NYSE|NASDAQ|AMEX|ASX|LSE|TSX|SEHK|HKEX)\s*[:：]\s*([A-Za-z]{1,5})\b/g
/** ② 港股形式:09696.HK / 1772.HK */
const HK_FORM = /\b(0*\d{1,5}\.HK)\b/gi

export function extractTickersFromTitles(titles: string[]): ExtractedTicker[] {
  const out: ExtractedTicker[] = []
  const seen = new Set<string>()

  for (const title of titles) {
    if (!title?.trim()) continue
    const candidates: string[] = []
    for (const m of title.matchAll(WITH_EXCHANGE)) candidates.push(`${m[1]}: ${m[2]}`)
    for (const m of title.matchAll(HK_FORM)) candidates.push(m[1])

    for (const raw of candidates) {
      const norm = normalizeSymbol(raw)
      if (!norm || seen.has(norm.symbol)) continue
      seen.add(norm.symbol)
      out.push({ symbol: norm.symbol, market: norm.market, sourceText: title })
    }
  }
  return out
}
