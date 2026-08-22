// packages/server/src/services/signals/weekly.ts
//
// 日线聚合为周线。不单独请求 Yahoo 的 interval=1wk —— 一次日线请求就能同时
// 得到两个周期,请求数减半,且「本周是否已结束」由我们自己判定。
import type { Bar } from './supertrend.js'

/** 'YYYY-MM-DD' → ISO 周键,如 '2026-W34'。跨年时归属 ISO 年而非日历年。 */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  // ISO 规则:把日期挪到本周周四,该周四所在的年份就是 ISO 年
  const day = d.getUTCDay() || 7          // 周日 0 → 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const isoYear = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

/**
 * 按 ISO 周聚合。`todayIso` 默认取当前 UTC 日期 —— 一律用 UTC,
 * 因为 Yahoo 日线 bar 的 UTC 日期恰好等于该市场的交易日(美股 13:30 UTC 开盘、
 * 港股 01:30 UTC 开盘,都落在同一 UTC 日),用本地时区反而会错位。
 *
 * 前置条件:`bars` 必须按日期升序传入 —— 组内「最后一根赢」和 Map 插入顺序
 * 等价于时间顺序,都依赖这一点,函数内部不做排序或校验。
 */
export function toWeekly(bars: Bar[], todayIso?: string): Bar[] {
  const today = todayIso ?? new Date().toISOString().slice(0, 10)
  const currentWeek = isoWeekKey(today)

  const groups = new Map<string, Bar>()
  for (const b of bars) {
    const key = isoWeekKey(b.date)
    const cur = groups.get(key)
    if (!cur) {
      groups.set(key, { date: b.date, high: b.high, low: b.low, close: b.close })
    } else {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.close = b.close      // 组内最后一根的收盘
      cur.date = b.date        // 组内最后一个交易日
    }
  }

  // 本周尚未结束,周 K 未收盘 —— 丢弃
  groups.delete(currentWeek)
  return [...groups.values()]
}
