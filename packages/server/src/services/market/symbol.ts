// packages/server/src/services/market/symbol.ts
//
// 把研报标题里抽出来的代码候选归一化成 Yahoo 口径,并判定市场。
// 只认美股与港股,其余一律返回 null。
//
// 刻意不接受「没有交易所前缀的裸字母代码」:研报里有「### 行业 ETF」
// 「### A 股(中国)」这类标题,接受裸字母会把 ETF / A 当成股票代码。
// 代价是漏掉正文表格里裸写的代码 —— 但本功能本来就只看标题。

export type Market = 'US' | 'HK'

export interface NormalizedSymbol {
  symbol: string
  market: Market
}

/** 美股交易所前缀 → 归为 US */
const US_EXCHANGES = /^(NYSE\s+AMERICAN|NYSEAMERICAN|NYSE|NASDAQ|AMEX)\s*[:：]\s*/
/** 已知但不支持的交易所前缀 → 明确丢弃(而不是当成裸字母) */
const OTHER_EXCHANGES = /^(ASX|LSE|TSX|TSXV|SEHK|HKEX|SSE|SZSE|FRA|ETR)\s*[:：]\s*/

const HK_CODE = /^0*(\d{1,5})\.HK$/
const A_SHARE = /^\d{6}(\.(SH|SZ|SS))?$/
const US_TICKER = /^[A-Z]{1,5}$/

export function normalizeSymbol(raw: string): NormalizedSymbol | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!s) return null

  if (OTHER_EXCHANGES.test(s)) return null

  const us = US_EXCHANGES.exec(s)
  if (us) {
    const ticker = s.slice(us[0].length).trim()
    return US_TICKER.test(ticker) ? { symbol: ticker, market: 'US' } : null
  }

  const hk = HK_CODE.exec(s)
  // Yahoo 的港股代码**恰好 4 位**,不足补零、超出保持原样(港交所已有 5 位代码)。
  // 实测:0700.HK 200 / 700.HK 404;9696.HK 200 / 09696.HK 404 ——
  // 只去前导 0 会把腾讯 0700 变成 700,查不到。
  if (hk) return { symbol: `${hk[1].padStart(4, '0')}.HK`, market: 'HK' }

  if (A_SHARE.test(s)) return null

  return null
}
