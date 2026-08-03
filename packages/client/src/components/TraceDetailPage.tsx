import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Descriptions, Tag } from 'antd'
import { useTraces, type TraceDetail } from '../hooks/useTraces'
import { SpanWaterfall } from './SpanWaterfall'
import { BackLink } from './BackLink'
import { statusTag } from './TraceList'

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
        <BackLink to="/traces" className="text-[13px] text-violet-600 no-underline hover:underline">返回列表</BackLink>
        <div className="p-12 text-center text-gray-400">trace 不存在</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-5 md:p-6">
        <BackLink to="/traces" className="text-[13px] text-violet-600 no-underline hover:underline">返回列表</BackLink>
        <div className="p-12 text-center text-gray-400">加载中…</div>
      </div>
    )
  }

  const { trace, spans } = detail
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:p-6">
      <BackLink to="/traces" className="text-[13px] text-violet-600 no-underline hover:underline">返回列表</BackLink>
      <div className="mt-3">
        <h1 className="mb-2 font-mono text-[18px] font-bold text-gray-900">{trace.route}</h1>
        <Descriptions size="small" column={{ xs: 1, sm: 2, md: 3 }} className="mt-2">
          <Descriptions.Item label="状态">
            <Tag color={statusTag[trace.status].color}>{statusTag[trace.status].label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="总耗时">{trace.duration_ms}ms</Descriptions.Item>
          <Descriptions.Item label="span">{trace.span_count}</Descriptions.Item>
          <Descriptions.Item label="降级/错误">{trace.degraded_count}/{trace.error_count}</Descriptions.Item>
          <Descriptions.Item label="开始时间">{new Date(trace.started_at).toLocaleString()}</Descriptions.Item>
        </Descriptions>
      </div>
      <SpanWaterfall spans={spans} totalMs={trace.duration_ms} />
    </div>
  )
}
