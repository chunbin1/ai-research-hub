// packages/server/src/services/signals/watchlistSync.ts
//
// 把研报标题里的标的接进自选股。只看标题 —— 文档标题 + 各级章节标题,
// 正文一概不看。抽不到就不加,这是刻意的取舍(见 spec「非目标」)。
import { getAllDocuments, readRawMarkdown } from '../documentStore.js'
import { addWatchlistEntry } from '../watchlistStore.js'
import { extractTickersFromTitles } from './tickerExtractor.js'

/** ATX 标题行。与 markdownParser 的 HEADING_RE 同源,允许结尾的闭合 # */
const HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm

/**
 * 抽出全部标题(含文档标题),按出现顺序去重。
 *
 * **直接扫原文,不走 parseMarkdown 的 chunks。** 曾经走过,是个真 bug:
 * chunks 只为**有正文内容**的小节产出,而研报里主标的所在的那个标题
 * (如 `### 4.0 腾讯控股（0700.HK / TCEHY）`)下面往往紧跟着子标题、
 * 自己没有正文段落 —— 于是整个标题连同代码一起消失。线上七篇研报实测:
 * 走 chunks 抽到 8 只,直接扫标题抽到 13 只,漏掉的全是各篇的主标的
 * (0700.HK 腾讯、0883.HK 中海油、1088.HK 中国神华)。
 */
function titlesOf(markdown: string): string[] {
  const titles: string[] = []
  const seen = new Set<string>()
  for (const m of markdown.matchAll(HEADING_RE)) {
    const title = m[1].trim()
    if (title && !seen.has(title)) {
      seen.add(title)
      titles.push(title)
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
