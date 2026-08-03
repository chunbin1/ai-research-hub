import { Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { TraceRecord, TraceStatus } from '../types'

interface Props {
  traces: TraceRecord[]
  onSelect: (id: string) => void
}

export const statusTag: Record<TraceStatus, { color: string; label: string }> = {
  ok:       { color: 'success', label: '正常' },
  degraded: { color: 'warning', label: '降级' },
  error:    { color: 'error',   label: '错误' },
}

const columns: ColumnsType<TraceRecord> = [
  { title: '状态', dataIndex: 'status', render: (s: TraceStatus) => <Tag color={statusTag[s].color}>{statusTag[s].label}</Tag> },
  { title: '路由', dataIndex: 'route', render: (v: string) => <span className="font-mono text-[12px]">{v}</span> },
  { title: '耗时', dataIndex: 'duration_ms', render: (v: number) => `${v}ms` },
  { title: 'span', dataIndex: 'span_count' },
  { title: '降级/错误', key: 'dg', render: (_, t) => `${t.degraded_count}/${t.error_count}` },
  { title: '时间', dataIndex: 'started_at', render: (v: string) => <span className="text-gray-400">{new Date(v).toLocaleString()}</span> },
]

export function TraceList({ traces, onSelect }: Props) {
  return (
    <Table
      columns={columns}
      dataSource={traces}
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      onRow={t => ({ onClick: () => onSelect(t.id), style: { cursor: 'pointer' } })}
    />
  )
}
