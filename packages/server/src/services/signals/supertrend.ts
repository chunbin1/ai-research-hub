// packages/server/src/services/signals/supertrend.ts
//
// SuperTrend 引擎。纯数学函数、零 IO、零依赖、不含业务策略 —— 递归棘轮逻辑一旦写错,
// 整个看板的数字全是错的却看不出来,所以它必须能对着固定数组逐根校验。
//
// 语义严格对齐 Pine v6:ATR 用 ta.rma(Wilder 平滑,SMA 播种),
// 源用 hl2,棘轮比较用 close[i-1],趋势判定用上一根的 up/dn。

export interface Bar {
  date: string
  high: number
  low: number
  close: number
}

export interface SupertrendPoint {
  date: string
  trend: 1 | -1
  up: number
  dn: number
  atr: number
}

export function supertrend(
  bars: Bar[],
  opts: { period?: number; mult?: number } = {},
): SupertrendPoint[] {
  const period = opts.period ?? 10
  const mult = opts.mult ?? 3
  // 数学守卫:period 至少为 2(为 1 时循环首轮就要读 bars[-1]),
  // 且至少 period+1 根才算得出 ATR。「预热不足不给信号」的业务门槛
  // 在 scanner 里(MIN_BARS),不放这里 —— 那是策略,不是数学。
  if (period < 2 || bars.length < period + 1) return []

  const n = bars.length

  // 真实波幅。首根没有前收,退化为 high - low(与 Pine 的 ta.tr 一致)
  const tr = new Array<number>(n)
  tr[0] = bars[0].high - bars[0].low
  for (let i = 1; i < n; i++) {
    const pc = bars[i - 1].close
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - pc),
      Math.abs(bars[i].low - pc),
    )
  }

  // ta.rma:前 period 根取 SMA 播种,其后 Wilder 平滑
  const atr = new Array<number>(n)
  let seed = 0
  for (let i = 0; i < period; i++) seed += tr[i]
  atr[period - 1] = seed / period
  for (let i = period; i < n; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
  }

  const out: SupertrendPoint[] = []
  let up: number | null = null
  let dn: number | null = null
  let trend: 1 | -1 = 1

  for (let i = period - 1; i < n; i++) {
    const b = bars[i]
    const src = (b.high + b.low) / 2
    const rawUp = src - mult * atr[i]
    const rawDn = src + mult * atr[i]
    const up1: number = up ?? rawUp
    const dn1: number = dn ?? rawDn
    const prevClose = bars[i - 1].close

    // 棘轮:趋势未破时线只许朝有利方向走
    up = prevClose > up1 ? Math.max(rawUp, up1) : rawUp
    dn = prevClose < dn1 ? Math.min(rawDn, dn1) : rawDn
    // 粘性:两条线都没被击穿就维持原状
    trend = b.close > dn1 ? 1 : b.close < up1 ? -1 : trend

    out.push({ date: b.date, trend, up, dn, atr: atr[i] })
  }
  return out
}
