import type { TraceStats as TraceStatsData } from '../hooks/useTraces'
import { statBars } from '../lib/statBars'

interface Props {
  stats: TraceStatsData
}

export function TraceStats({ stats }: Props) {
  const bars = statBars(stats.byReason)
  return (
    <div className="mb-5 flex flex-col gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:flex-row md:items-start md:gap-6">
      <div className="flex shrink-0 gap-4">
        <div className="min-w-[96px] rounded border border-gray-200 bg-white px-4 py-3 text-center">
          <div className="text-[24px] leading-[1.2] font-bold text-gray-900">{stats.total}</div>
          <div className="mt-1 text-[12px] text-gray-600">总 trace 数</div>
        </div>
        <div className="min-w-[96px] rounded border border-gray-200 bg-white px-4 py-3 text-center">
          <div className="text-[24px] leading-[1.2] font-bold text-[#d97706]">{stats.degradedPct}%</div>
          <div className="mt-1 text-[12px] text-gray-600">降级率</div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-2 text-[12px] font-semibold text-gray-600">降级原因</div>
        {bars.length === 0 ? (
          <div className="text-[12px] text-gray-400">暂无降级</div>
        ) : (
          bars.map(b => (
            <div key={b.reason} className="mb-1.5 grid grid-cols-[100px_1fr_32px] items-center gap-2 md:grid-cols-[160px_1fr_40px]">
              <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-gray-900" title={b.reason}>{b.reason}</span>
              <span className="relative h-3 overflow-hidden rounded bg-gray-100">
                <span className="absolute top-0 left-0 h-3 min-w-[2px] rounded bg-[#d97706]" style={{ width: `${b.pct}%` }} />
              </span>
              <span className="text-right text-[12px] text-gray-600">{b.count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
