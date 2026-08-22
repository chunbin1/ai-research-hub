// packages/server/src/services/signals/watchlistSync.ts
//
// 把研报标题里的标的接进自选股。只看标题 —— 文档标题 + 各级章节标题,
// 正文一概不看。抽不到就不加,这是刻意的取舍(见 spec「非目标」)。
import { parseMarkdown } from '../markdownParser.js'
import { getAllDocuments, readRawMarkdown } from '../documentStore.js'
import { addWatchlistEntry } from '../watchlistStore.js'
import { extractTickersFromTitles } from './tickerExtractor.js'

/** 抽出文档标题 + 去重后的全部章节标题 */
function titlesOf(markdown: string): string[] {
  const { displayName, chunks } = parseMarkdown(markdown)
  const titles = displayName ? [displayName] : []
  const seen = new Set<string>()
  for (const c of chunks) {
    if (c.section_title && !seen.has(c.section_title)) {
      seen.add(c.section_title)
      titles.push(c.section_title)
    }
  }
  return titles
}

/** 返回该文档标题里识别出的全部 symbol(含此前已存在的) */
export function syncWatchlistFromMarkdown(docId: string, markdown: string): string[] {
  const tickers = extractTickersFromTitles(titlesOf(markdown))
  for (const t of tickers) {
    addWatchlistEntry({
      symbol: t.symbol, market: t.market, sourceDoc: docId, sourceText: t.sourceText,
    })
  }
  return tickers.map(t => t.symbol)
}

/** 对全部已有报告重跑一遍抽取(幂等) */
export function syncWatchlistFromAllDocuments(): { documents: number; symbols: string[] } {
  const docs = getAllDocuments()
  const symbols = new Set<string>()
  for (const doc of docs) {
    const md = readRawMarkdown(doc.id)
    if (!md) continue
    for (const s of syncWatchlistFromMarkdown(doc.id, md)) symbols.add(s)
  }
  return { documents: docs.length, symbols: [...symbols].sort() }
}
