// SEC Release 34-95148：2023-01-03 及之后提交的 13F，value 改为四舍五入到美元。
// 更早的申报仍是千美元。判断用申报日，不用报告期。

export const DOLLAR_VALUE_SINCE = '2023-01-03'

export type ValueUnit = 'dollars' | 'thousands'

export function valueUnitForFilingDate(filingDate: string): ValueUnit {
  return filingDate >= DOLLAR_VALUE_SINCE ? 'dollars' : 'thousands'
}

export function toUsd(reported: number, unit: ValueUnit): number {
  return unit === 'thousands' ? reported * 1000 : reported
}
