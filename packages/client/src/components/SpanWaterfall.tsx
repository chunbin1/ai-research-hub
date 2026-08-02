import { useState } from 'react'
import type { SpanRecord, TraceStatus } from '../types'
import { buildWaterfall } from '../lib/waterfall'

interface Props {
  spans: SpanRecord[]
  totalMs: number
}

const barClass: Record<TraceStatus, string> = {
  ok: 'bg-[#16a34a]',
  degraded: 'bg-[#d97706]',
  error: 'bg-[#dc2626]',
}

function fmtMeta(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function SpanWaterfall({ spans, totalMs }: Props) {
  const rows = buildWaterfall(spans, totalMs)
  const [selected, setSelected] = useState<string | null>(null)

  if (rows.length === 0) {
    return <div className="p-6 text-center text-gray-400">该 trace 没有 span</div>
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <div className="flex min-w-[560px] flex-col gap-0.5">
        {rows.map(({ span, depth, leftPct, widthPct }) => (
          <div key={span.id}>
            <div
              className="grid grid-cols-[220px_1fr_72px] items-center gap-2 rounded py-1 cursor-pointer hover:bg-gray-50"
              onClick={() => setSelected(selected === span.id ? null : span.id)}
            >
              <div className="flex items-center gap-1.5 overflow-hidden text-[12px] text-gray-900" style={{ paddingLeft: depth * 16 + 8 }}>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{span.name}</span>
                {span.status !== 'ok' && (
                  <span className="shrink-0 rounded bg-gray-100 px-[5px] py-[1px] text-[10px] text-gray-600">{span.status === 'error' ? '错误' : '降级'}</span>
                )}
              </div>
              <div className="relative h-4 rounded bg-gray-100">
                <div
                  className={`absolute top-0 h-4 min-w-[2px] rounded ${barClass[span.status]}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`${span.duration_ms}ms`}
                />
              </div>
              <div className="text-right text-[11px] text-gray-400">{span.duration_ms}ms</div>
            </div>

            {selected === span.id && (
              <div className="mt-1 mb-2 ml-2 rounded bg-gray-50 px-3 py-[10px] text-[12px] text-gray-900">
                {span.degraded_reason && (
                  <div className="mb-1.5 break-words"><b>降级原因：</b>{span.degraded_reason}</div>
                )}
                {span.error_message && (
                  <div className="mb-1.5 break-words"><b>错误：</b>{span.error_message}</div>
                )}
                <div className="mb-1.5 break-words">
                  <b>输入：</b>{span.input ?? <i className="text-gray-400">内容未记录</i>}
                </div>
                <div className="mb-1.5 break-words">
                  <b>输出：</b>{span.output ?? <i className="text-gray-400">内容未记录</i>}
                </div>
                <div className="mb-1.5 break-words">
                  <b>metadata：</b>
                  <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-2 text-[11px] whitespace-pre-wrap text-[#f9fafb]">{fmtMeta(span.metadata)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
