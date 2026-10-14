// packages/server/src/services/market/symbolSearch.ts
//
// 添加标的的搜索入口。两路合并:
//   - Yahoo:代码与英文法定名(2513.HK / Z.AI / ALB)
//   - 中文行情源:中文简称、拼音、别名,以及 Yahoo 还没索引好的新上市港股
// 任一路失败而另一路已经有结果时,照样把结果返回 —— 中文源挂了不该让
// 「ALB」也搜不出来;两路都没有,才把故障抛出去。
import { searchCnSymbols } from './cnSymbolSearch.js'
import { searchYahooSymbols, type SymbolSearchHit, type YahooDeps } from './yahooClient.js'

const MAX_HITS = 12

function dedupe(hits: SymbolSearchHit[]): SymbolSearchHit[] {
  const seen = new Set<string>()
  const out: SymbolSearchHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.symbol)) continue
    seen.add(hit.symbol)
    out.push(hit)
    if (out.length >= MAX_HITS) break
  }
  return out
}

export async function searchSymbols(
  query: string,
  deps: YahooDeps = {},
): Promise<SymbolSearchHit[]> {
  const q = query.trim()
  if (!q) return []

  const [yahooSettled, cnSettled] = await Promise.allSettled([
    searchYahooSymbols(q, deps),
    searchCnSymbols(q, deps),
  ])

  const yahooHits = yahooSettled.status === 'fulfilled' ? yahooSettled.value : []
  const cnHits = cnSettled.status === 'fulfilled' ? cnSettled.value : []
  // 查询里有汉字时,中文源是按简称排过的,放前面。
  // 否则 Yahoo 会把「智谱AI」当成「AI」,一串美股把真正的港股挤出前 12 条。
  const cjk = /[\u3400-\u9fff]/.test(q)
  const hits = dedupe(cjk ? [...cnHits, ...yahooHits] : [...yahooHits, ...cnHits])
  if (hits.length > 0) return hits

  if (yahooSettled.status === 'rejected') throw yahooSettled.reason
  if (cnSettled.status === 'rejected') throw cnSettled.reason
  return []
}
