import { Navigate } from 'react-router-dom'
import { useHoldings } from '../hooks/useHoldings'
import {
  formatMoney, formatPnl, formatShares, formatUpdatedAt, formatWeight, pnlClassName,
} from '../lib/holdingsView'
import type { HoldingPosition } from '../types'

/** 与信号页同一套左右边距 */
const GUTTER = 'px-[18px] md:px-7 lg:px-10'

function SymbolCell({ row }: { row: HoldingPosition }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[15px] font-medium text-ink">{row.symbol}</span>
      {row.name && <span className="truncate text-[12px] text-ink-faint">{row.name}</span>}
    </div>
  )
}

export default function HoldingsPage() {
  const { snapshot, loading, error } = useHoldings()

  if (loading) {
    return (
      <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-ink-mute ${GUTTER}`}>
        加载中…
      </div>
    )
  }
  if (error) {
    return (
      <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-danger ${GUTTER}`}>
        {error}
      </div>
    )
  }
  // 没有快照时不留空白表。导航入口同样只在有数据时出现。
  if (!snapshot || snapshot.holdings.length === 0 || !snapshot.updatedAt) {
    return <Navigate to="/" replace />
  }

  const updatedAt = snapshot.updatedAt

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
      <div className={`flex flex-col gap-2 border-b border-rule pb-4 pt-3.5 md:border-b-0 md:pb-6 md:pt-8 ${GUTTER}`}>
        <h1 className="m-0 font-serif-sc text-[17px] font-semibold text-ink md:text-[26px]">实盘持仓</h1>
        <p className="m-0 max-w-[640px] text-[12px] leading-[1.65] text-ink-mute md:text-[13px] md:leading-[1.6]">
          外部账户同步的完整持仓。仓位占比按市值合计计算,整份快照共用一个更新时间。
        </p>
      </div>

      <main className={`flex-1 ${GUTTER}`}>
        <p className="m-0 pb-3 text-[12px] text-ink-faint">
          <time dateTime={updatedAt}>更新于 {formatUpdatedAt(updatedAt)}</time>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-t border-ink text-left">
            <thead>
              <tr className="border-b border-rule text-[12px] tracking-[0.02em] text-ink-mute">
                <th scope="col" className="py-3 pr-3 font-normal">标的</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">股数</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">市值</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">成本</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">浮动盈亏</th>
                <th scope="col" className="py-3 text-right font-normal">仓位占比</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.holdings.map(row => (
                <tr key={row.symbol} className="border-b border-row-rule">
                  <td className="py-4 pr-3"><SymbolCell row={row} /></td>
                  <td className="py-4 pr-3 text-right font-numeral text-[16px] text-ink">{formatShares(row.shares)}</td>
                  <td className="py-4 pr-3 text-right font-numeral text-[16px] text-ink">{formatMoney(row.marketValue)}</td>
                  <td className="py-4 pr-3 text-right font-numeral text-[16px] text-ink">{formatMoney(row.cost)}</td>
                  <td className="py-4 pr-3 text-right font-numeral text-[16px] font-semibold">
                    <span className={pnlClassName(row.pnl)}>{formatPnl(row.pnl)}</span>
                  </td>
                  <td className="py-4 text-right font-numeral text-[16px] text-ink">{formatWeight(row.weight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <footer className={`mt-5 border-t border-rule pb-7 pt-4 text-[11px] text-ink-faint md:mt-6 md:pt-5 md:text-[12px] ${GUTTER}`}>
        浮动盈亏:红为盈利,绿为亏损。仓位占比 = 该标的市值 / 全部市值。
      </footer>
    </div>
  )
}
