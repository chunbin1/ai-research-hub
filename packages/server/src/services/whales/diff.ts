// 相邻两期的增减。比较股数，不比较市值：价格涨了但股数没变，标成「不变」。
// previous === null 表示库里没有上一份申报，不能把本期全部标成新建仓。

export type ChangeKind = 'new' | 'increased' | 'decreased' | 'unchanged' | 'closed'

export interface DiffLine {
  cusip: string
  putCall: '' | 'Put' | 'Call'
  shareType: string
  issuerName: string
  titleOfClass: string
  shares: number
  valueUsd: number
  valueReported: number
}

export interface DiffPosition extends DiffLine {
  prevShares: number | null
  prevValueUsd: number | null
  shareDelta: number | null
  valueDeltaUsd: number | null
  change: ChangeKind | null
}

function lineKey(row: Pick<DiffLine, 'cusip' | 'putCall' | 'shareType'>): string {
  return `${row.cusip}|${row.putCall}|${row.shareType}`
}

export function diffPositions(
  current: DiffLine[],
  previous: DiffLine[] | null,
): { hasPrevious: boolean; positions: DiffPosition[]; closed: DiffPosition[] } {
  if (previous === null) {
    return {
      hasPrevious: false,
      positions: current.map(row => ({
        ...row,
        prevShares: null,
        prevValueUsd: null,
        shareDelta: null,
        valueDeltaUsd: null,
        change: null,
      })),
      closed: [],
    }
  }

  const prevByKey = new Map(previous.map(row => [lineKey(row), row]))
  const positions = current.map(row => {
    const prev = prevByKey.get(lineKey(row))
    prevByKey.delete(lineKey(row))
    if (!prev) {
      return {
        ...row,
        prevShares: 0,
        prevValueUsd: 0,
        shareDelta: row.shares,
        valueDeltaUsd: row.valueUsd,
        change: 'new' as const,
      }
    }
    const shareDelta = row.shares - prev.shares
    const change: ChangeKind = shareDelta > 0 ? 'increased' : shareDelta < 0 ? 'decreased' : 'unchanged'
    return {
      ...row,
      prevShares: prev.shares,
      prevValueUsd: prev.valueUsd,
      shareDelta,
      valueDeltaUsd: row.valueUsd - prev.valueUsd,
      change,
    }
  })

  const closed = [...prevByKey.values()].map(prev => ({
    cusip: prev.cusip,
    putCall: prev.putCall,
    shareType: prev.shareType,
    issuerName: prev.issuerName,
    titleOfClass: prev.titleOfClass,
    shares: 0,
    valueUsd: 0,
    valueReported: 0,
    prevShares: prev.shares,
    prevValueUsd: prev.valueUsd,
    shareDelta: -prev.shares,
    valueDeltaUsd: -prev.valueUsd,
    change: 'closed' as const,
  }))

  return { hasPrevious: true, positions, closed }
}
