/** 持仓页的数字与更新时间。页面和测试共用,避免两处各写一套格式。 */

export function formatMoney(n: number): string {
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

/** 浮动盈亏:正数带加号,负数带减号,零不带符号。 */
export function formatPnl(n: number): string {
  const body = formatMoney(Math.abs(n))
  if (n > 0) return `+${body}`
  if (n < 0) return `-${body}`
  return body
}

export function formatShares(n: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(n)
}

/** weight 是 0–1 的比例。 */
export function formatWeight(weight: number): string {
  return `${(weight * 100).toFixed(2)}%`
}

/** 表上方那一行。用本地时区,和访客看到的「现在」对齐。 */
export function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 红涨绿跌。零是中性色,不往两边靠。 */
export function pnlClassName(n: number): string {
  if (n > 0) return 'text-long'
  if (n < 0) return 'text-short'
  return 'text-ink'
}
