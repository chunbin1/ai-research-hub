import type { TraceRecord, TraceStatus } from '../types'

interface Props {
  traces: TraceRecord[]
  onSelect: (id: string) => void
}

const statusLabel: Record<TraceStatus, string> = {
  ok: '正常',
  degraded: '降级',
  error: '错误',
}

const badgeClass: Record<TraceStatus, string> = {
  ok: 'bg-[#dcfce7] text-[#16a34a]',
  degraded: 'bg-[#fef3c7] text-[#d97706]',
  error: 'bg-[#fee2e2] text-[#dc2626]',
}

export function TraceList({ traces, onSelect }: Props) {
  if (traces.length === 0) {
    return <div className="p-12 text-center text-gray-400">暂无 trace 记录</div>
  }
  return (
    // 横向滚动发生在组件内部,而不是整个 body
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="[&>th]:border-b [&>th]:border-gray-200 [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:whitespace-nowrap [&>th]:text-gray-600">
            <th>状态</th><th>路由</th><th>耗时</th><th>span</th><th>降级/错误</th><th>时间</th>
          </tr>
        </thead>
        <tbody>
          {traces.map(t => (
            <tr
              key={t.id}
              className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 [&>td]:px-3 [&>td]:py-2 [&>td]:text-gray-900"
              onClick={() => onSelect(t.id)}
            >
              <td>
                <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${badgeClass[t.status]}`}>
                  {statusLabel[t.status]}
                </span>
              </td>
              <td className="font-mono text-[12px]">{t.route}</td>
              <td className="whitespace-nowrap">{t.duration_ms}ms</td>
              <td>{t.span_count}</td>
              <td className="whitespace-nowrap">{t.degraded_count}/{t.error_count}</td>
              <td className="whitespace-nowrap text-gray-400">{new Date(t.started_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
