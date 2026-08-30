import type { SignalRow, SignalSide } from '../types'

/**
 * 信号页的纯展示规则(design_handoff_homepage/README.md「信号追踪」一节)。
 * 全是无状态计算 —— 放在这里而不是页面里,是为了能单测,页面只管把结果画出来。
 */

/** 距止损不足这个百分比就转预警橙 */
export const NEAR_STOP_PCT = 6
/** 进度条画满对应的距离;超过这个值一律满格 */
export const STOP_BAR_FULL_PCT = 17
/** 近 90 天日线翻转达到这个次数就提示震荡 —— 这段时间的日线信号不可信 */
export const WHIPSAW_THRESHOLD = 4

/**
 * 距止损只取绝对值:多头的止损在下方、空头在上方,正负号表达的是方向,
 * 而方向已经由「多 / 空」徽章说清楚了,再带一个 +/- 会和方向色打架。
 */
export function stopDistance(side: SignalSide): number {
  return Math.abs(side.distPct)
}

export function isNearStop(side: SignalSide): boolean {
  return stopDistance(side) < NEAR_STOP_PCT
}

/** 进度条填充宽度,CSS 百分比字符串 */
export function stopBarWidth(side: SignalSide): string {
  const ratio = Math.min(stopDistance(side) / STOP_BAR_FULL_PCT, 1)
  return `${(ratio * 100).toFixed(1)}%`
}

/**
 * 翻转日期:与所在周期的最新 bar 同年时省去年份(08-24),跨年才写全
 * (2025-05-16 起 470 天)—— 省的是噪声,不是信息。
 */
export function formatFlipDate(flipDate: string, barDate: string): string {
  return flipDate.slice(0, 4) === barDate.slice(0, 4) ? flipDate.slice(5) : flipDate
}

/** 'YYYY-MM-DD' → 'MM-DD'(移动端「截至 08-28 收盘」) */
export function shortDate(date: string): string {
  return date.slice(5)
}

/** 任一周期临近止损 —— 筛选胶囊「临近止损」的口径 */
export function isRowNearStop(row: SignalRow): boolean {
  return [row.daily, row.weekly].some(side => side != null && isNearStop(side))
}

export type SignalFilterKey = 'all' | 'HK' | 'US' | 'dailyLong' | 'dailyShort' | 'nearStop'

export const SIGNAL_FILTERS: readonly { key: SignalFilterKey; label: string; group: 'market' | 'trend' }[] = [
  { key: 'all', label: '全部', group: 'market' },
  { key: 'HK', label: '港股', group: 'market' },
  { key: 'US', label: '美股', group: 'market' },
  { key: 'dailyLong', label: '日线多头', group: 'trend' },
  { key: 'dailyShort', label: '日线空头', group: 'trend' },
  { key: 'nearStop', label: '临近止损', group: 'trend' },
]

export function matchesFilter(row: SignalRow, key: SignalFilterKey): boolean {
  switch (key) {
    case 'all': return true
    case 'HK': return row.market === 'HK'
    case 'US': return row.market === 'US'
    case 'dailyLong': return row.daily?.trend === 1
    case 'dailyShort': return row.daily?.trend === -1
    case 'nearStop': return isRowNearStop(row)
  }
}

/** 每个胶囊后面的计数 —— 计数始终按全量算,不受当前选中项影响 */
export function filterCounts(rows: SignalRow[]): Record<SignalFilterKey, number> {
  const counts = {} as Record<SignalFilterKey, number>
  for (const { key } of SIGNAL_FILTERS) counts[key] = rows.filter(r => matchesFilter(r, key)).length
  return counts
}

/**
 * 「数据截至」取所有行里最新的 bar 日期,而不是 lastScanAt ——
 * 扫描时间是「什么时候跑的」,用户要看的是「算到哪一根 K 线」。
 */
export function dataAsOf(rows: SignalRow[]): string | null {
  const dates = rows.flatMap(r => [r.daily?.barDate, r.weekly?.barDate].filter((d): d is string => d != null))
  return dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b))
}
