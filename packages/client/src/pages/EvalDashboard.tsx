import { useNavigate } from 'react-router-dom'
import { BarChartOutlined } from '@ant-design/icons'
import { Card, Statistic, Table, Tag, Button } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEval } from '../hooks/useEval'
import { BackLink } from '../components/BackLink'
import type { EvalReportRow, EvalStatus } from '../types'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

const statusTag: Record<EvalStatus, { color: string; label: string }> = {
  none:    { color: 'default',    label: '未评估' },
  running: { color: 'processing', label: '评估中…' },
  done:    { color: 'success',    label: '已完成' },
  failed:  { color: 'error',      label: '失败' },
}

export default function EvalDashboard() {
  const { stats, reports, runEval } = useEval()
  const navigate = useNavigate()

  const metrics = [
    { title: '已评估篇数', value: stats?.docsEvaluated ?? 0 },
    { title: '平均召回率', value: pct(stats?.avgRecall ?? null) },
    { title: '平均精确率', value: pct(stats?.avgPrecision ?? null) },
    { title: '平均忠实度', value: pct(stats?.avgFaithfulness ?? null) },
    { title: '平均相关性', value: pct(stats?.avgRelevancy ?? null) },
  ]

  const columns: ColumnsType<EvalReportRow> = [
    {
      title: '报告',
      dataIndex: 'filename',
      render: (v: string, r) => (
        <span
          className={r.status === 'done' ? 'cursor-pointer hover:text-gold' : ''}
          onClick={() => r.status === 'done' && navigate(`/eval/${r.doc_id}`)}
        >{v}</span>
      ),
    },
    { title: '召回', dataIndex: 'avg_recall',       render: pct },
    { title: '精确', dataIndex: 'avg_precision',    render: pct },
    { title: '忠实', dataIndex: 'avg_faithfulness', render: pct },
    { title: '相关', dataIndex: 'avg_relevancy',    render: pct },
    { title: '题数', dataIndex: 'question_count', render: (v: number) => v || '—' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: EvalStatus) => <Tag color={statusTag[s].color}>{statusTag[s].label}</Tag>,
    },
    {
      title: '',
      key: 'action',
      render: (_, r) => (
        <Button
          size="small"
          type="primary"
          disabled={r.status === 'running'}
          onClick={() => void runEval(r.doc_id)}
        >{r.status === 'running' ? '评估中…' : '跑评估'}</Button>
      ),
    },
  ]

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:px-6 md:py-7">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <BackLink to="/" className="text-[14px] text-[#555] hover:text-black">全部报告</BackLink>
        <h1 className="m-0 text-[22px] font-bold"><BarChartOutlined aria-hidden /> 检索质量评估</h1>
      </header>

      <div className="mb-6 flex flex-wrap gap-3.5">
        {metrics.map(m => (
          <Card key={m.title} size="small" className="min-w-[120px]">
            <Statistic title={m.title} value={m.value} />
          </Card>
        ))}
      </div>

      <Table
        columns={columns}
        dataSource={reports}
        rowKey="doc_id"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
      />
    </div>
  )
}
