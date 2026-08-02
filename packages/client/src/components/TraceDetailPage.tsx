import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTraces, type TraceDetail } from '../hooks/useTraces'
import { SpanWaterfall } from './SpanWaterfall'

export function TraceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { fetchDetail } = useTraces()
  const [detail, setDetail] = useState<TraceDetail | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    void fetchDetail(id).then(d => {
      if (d) setDetail(d)
      else setNotFound(true)
    })
  }, [id, fetchDetail])

  if (notFound) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-5 md:p-6">
        <Link to="/traces" className="text-[13px] text-violet-600 no-underline hover:underline">← 返回列表</Link>
        <div className="p-12 text-center text-gray-400">trace 不存在</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-5 md:p-6">
        <Link to="/traces" className="text-[13px] text-violet-600 no-underline hover:underline">← 返回列表</Link>
        <div className="p-12 text-center text-gray-400">加载中…</div>
      </div>
    )
  }

  const { trace, spans } = detail
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:p-6">
      <Link to="/traces" className="text-[13px] text-violet-600 no-underline hover:underline">← 返回列表</Link>
      <div className="mt-3">
        <h1 className="mb-2 font-mono text-[18px] font-bold text-gray-900">{trace.route}</h1>
        <div className="flex flex-wrap gap-4 text-[13px] text-gray-600">
          <span>状态：{trace.status}</span>
          <span>总耗时：{trace.duration_ms}ms</span>
          <span>span：{trace.span_count}</span>
          <span>降级/错误：{trace.degraded_count}/{trace.error_count}</span>
          <span>{new Date(trace.started_at).toLocaleString()}</span>
        </div>
      </div>
      <SpanWaterfall spans={spans} totalMs={trace.duration_ms} />
    </div>
  )
}
