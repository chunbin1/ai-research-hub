// 一次性生成 golden test 用的冻结 fixture。测试本身不联网,只读生成好的 JSON。
// 用法: node scripts/fetch-signal-fixture.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const SYMBOL = 'ALB'
const CUTOFF = '2026-08-20'          // 冻结截止日,保证重新生成结果一致
const OUT = 'packages/server/src/services/signals/__fixtures__/ALB-daily.json'

const url = `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}`
  + '?interval=1d&range=5y&includeAdjustedClose=true'
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
if (!res.ok) throw new Error(`HTTP ${res.status}`)

const r = (await res.json()).chart.result[0]
const q = r.indicators.quote[0]
const adj = r.indicators.adjclose[0].adjclose

const bars = []
for (let i = 0; i < r.timestamp.length; i++) {
  // 四个字段任缺其一就整根跳过 —— JS 里 null 参与算术会静默变成 0,
  // 只挡 close 的话,adjclose 为 null 会让复权因子变 0、整根价格塌成 0。
  if (q.close[i] == null || adj[i] == null || q.high[i] == null || q.low[i] == null) continue
  const date = new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10)
  if (date > CUTOFF) continue
  const f = adj[i] / q.close[i]        // 复权因子
  bars.push({
    date,
    high: q.high[i] * f,
    low: q.low[i] * f,
    close: adj[i],
  })
}

mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true })
writeFileSync(OUT, JSON.stringify(bars))
console.log(`${OUT}: ${bars.length} 根,${bars[0].date} → ${bars[bars.length - 1].date}`)
