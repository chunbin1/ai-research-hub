// 估算持仓成本。13F 没有成交价，只能从库里各期申报倒推：
// - 每期的期末价 = 该行市值 ÷ 股数
// - 加仓的股数按当期期末价计入，减仓不改每股成本（移动加权平均）
// - 某期没有这一行就算清仓，之后再出现从头算
// - 股数和期末价同时按整数倍反向跳变，当作拆股 / 合股，不当作买卖
// 只算普通股（SH、非期权）。期权的 value 是标的市值，本金行没有每股价格。
// 库里最早一期就已持有的仓位，成本只能从那一期期末价起算，fromStart 为 false。

export interface CostLine {
  cusip: string
  putCall: '' | 'Put' | 'Call'
  shareType: string
  shares: number
  valueUsd: number
}

export interface CostPeriod {
  reportPeriod: string
  positions: CostLine[]
}

export interface CostEstimate {
  /** 每股估算成本（美元）。 */
  costPerShare: number
  /** 本期期末价（美元）。 */
  pricePerShare: number
  /** 期末价相对估算成本的涨跌，0.25 即 +25%。 */
  gain: number
  /** 从哪一期开始算的成本。 */
  since: string
  /** true：库里看得到建仓那一期；false：最早一期已经持有，成本只是从那期起算。 */
  fromStart: boolean
}

const SPLIT_RATIOS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50]

export function costKey(row: Pick<CostLine, 'cusip' | 'putCall' | 'shareType'>): string {
  return `${row.cusip}|${row.putCall}|${row.shareType}`
}

export function costEligible(row: CostLine): boolean {
  return row.putCall === '' && row.shareType.toUpperCase() === 'SH' && row.shares > 0 && row.valueUsd > 0
}

/**
 * 股数大约放大 n 倍、价格大约缩到 1/n：拆股，返回 n。合股返回 1/n。
 * 同一季里拆股之后再加减仓，股数不会正好是 n 倍，所以股数只要求接近 n 倍（±1/4），再看价格。
 * 股数不变时不会落进 2 倍的区间，价格大跌也不会被当成拆股。
 */
export function detectSplit(prevShares: number, shares: number, prevPrice: number, price: number): number | null {
  if (prevShares <= 0 || prevPrice <= 0 || price <= 0) return null
  const shareRatio = shares / prevShares
  const priceRatio = price / prevPrice
  let best: { factor: number; miss: number } | null = null
  for (const n of SPLIT_RATIOS) {
    for (const factor of [n, 1 / n]) {
      if (shareRatio < factor * 0.75 || shareRatio > factor * 1.33) continue
      const adjusted = priceRatio * factor
      if (adjusted < 0.67 || adjusted > 1.5) continue
      // 没有交易的拆股股数正好是 n 倍，价格却会顺带涨跌，所以股数的偏差权重更大。
      const miss = 3 * Math.abs(Math.log(shareRatio / factor)) + Math.abs(Math.log(adjusted))
      if (!best || miss < best.miss) best = { factor, miss }
    }
  }
  return best?.factor ?? null
}

interface State {
  shares: number
  cost: number
  price: number
  since: string
  fromStart: boolean
}

/** periods 从旧到新。返回最后一期每一行的估算。 */
export function estimateCosts(periods: CostPeriod[]): Map<string, CostEstimate> {
  let states = new Map<string, State>()
  periods.forEach((period, index) => {
    const next = new Map<string, State>()
    for (const row of period.positions) {
      if (!costEligible(row)) continue
      const key = costKey(row)
      const price = row.valueUsd / row.shares
      let prev = states.get(key)
      if (!prev) {
        next.set(key, { shares: row.shares, cost: price, price, since: period.reportPeriod, fromStart: index > 0 })
        continue
      }
      const factor = detectSplit(prev.shares, row.shares, prev.price, price)
      if (factor !== null) prev = { ...prev, shares: prev.shares * factor, cost: prev.cost / factor }
      const cost = row.shares > prev.shares
        ? (prev.cost * prev.shares + (row.shares - prev.shares) * price) / row.shares
        : prev.cost
      next.set(key, { shares: row.shares, cost, price, since: prev.since, fromStart: prev.fromStart })
    }
    states = next
  })
  const out = new Map<string, CostEstimate>()
  for (const [key, state] of states) {
    out.set(key, {
      costPerShare: state.cost,
      pricePerShare: state.price,
      gain: state.price / state.cost - 1,
      since: state.since,
      fromStart: state.fromStart,
    })
  }
  return out
}
