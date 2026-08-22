import { useNavigate } from 'react-router-dom'
import { Alert, Button, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useSignals } from '../hooks/useSignals'
import { useAuth } from '../hooks/useAuth'
import { BackLink } from '../components/BackLink'
import { SignalLog } from '../components/SignalLog'
import { RecentSignalEvents } from '../components/RecentSignalEvents'
import type { SignalRow, SignalSide } from '../types'

/** 近 90 天日线翻转达到这个次数就提示震荡 —— 这段时间的日线信号不可信 */
const WHIPSAW_THRESHOLD = 4

function TrendCell({ side }: { side: SignalSide | null }) {
  if (!side) return <Typography.Text type="secondary">—</Typography.Text>
  const up = side.trend === 1
  return (
    <Space orientation="vertical" size={0}>
      <Tag color={up ? 'green' : 'red'}>{up ? '🟢多' : '🔴空'}</Tag>
      {side.flipDate && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {side.flipDate} 起 {side.heldDays ?? '—'} 天
        </Typography.Text>
      )}
    </Space>
  )
}

function DistCell({ side }: { side: SignalSide | null }) {
  if (!side) return <Typography.Text type="secondary">—</Typography.Text>
  return (
    <Space orientation="vertical" size={0}>
      <Typography.Text type={side.distPct >= 0 ? 'success' : 'danger'}>
        {side.distPct >= 0 ? '+' : ''}{side.distPct.toFixed(1)}%
      </Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        止损 {side.stopLine.toFixed(2)}
      </Typography.Text>
    </Space>
  )
}

export default function SignalsPage() {
  const { rows, loading, scanning, error, scan, extract } = useSignals()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const navigate = useNavigate()

  const columns: ColumnsType<SignalRow> = [
    {
      title: '标的', dataIndex: 'symbol', key: 'symbol',
      render: (_: unknown, r: SignalRow) => (
        <Space orientation="vertical" size={0}>
          <Space size={4}>
            <Typography.Text strong>{r.symbol}</Typography.Text>
            <Tag>{r.market === 'US' ? '美股' : '港股'}</Tag>
          </Space>
          {r.name && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.name}</Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '现价', key: 'price',
      render: (_: unknown, r: SignalRow) =>
        r.status !== 'ok'
          ? <Typography.Text type="warning">{r.lastError ?? r.status}</Typography.Text>
          : r.closeRaw == null
            ? <Typography.Text type="secondary">—</Typography.Text>
            : <span>{r.closeRaw.toFixed(2)} {r.currency ?? ''}</span>,
    },
    { title: '日线', key: 'daily', render: (_: unknown, r: SignalRow) => <TrendCell side={r.daily} /> },
    { title: '距日线止损', key: 'dailyDist', render: (_: unknown, r: SignalRow) => <DistCell side={r.daily} /> },
    { title: '周线', key: 'weekly', render: (_: unknown, r: SignalRow) => <TrendCell side={r.weekly} /> },
    { title: '距周线止损', key: 'weeklyDist', render: (_: unknown, r: SignalRow) => <DistCell side={r.weekly} /> },
    {
      title: '共振', key: 'resonance',
      render: (_: unknown, r: SignalRow) => {
        if (!r.daily || !r.weekly) return <Typography.Text type="secondary">—</Typography.Text>
        if (r.divergent) return <Tag color="orange">⚠️ 背离</Tag>
        return <Tag color={r.daily.trend === 1 ? 'green' : 'red'}>{r.daily.trend === 1 ? '双多' : '双空'}</Tag>
      },
    },
    {
      title: '90天翻转', key: 'flips',
      render: (_: unknown, r: SignalRow) => {
        // 没有日线信号的行不显示这一列 —— 「0 次」会把「没数据」说成「确认没震荡」
        if (!r.daily) return <Typography.Text type="secondary">—</Typography.Text>
        return r.flips90d >= WHIPSAW_THRESHOLD
          ? <Typography.Text type="danger">{r.flips90d} 次 · 震荡</Typography.Text>
          : <span>{r.flips90d} 次</span>
      },
    },
    {
      title: '来源', key: 'source',
      render: (_: unknown, r: SignalRow) =>
        r.sourceDoc
          ? <Button type="link" size="small" onClick={() => navigate(`/reports/${r.sourceDoc!.id}`)}>
              {r.sourceDoc.filename}
            </Button>
          : <Typography.Text type="secondary">—</Typography.Text>,
    },
  ]

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      {/* 九列需要约 1282px;max-w-7xl(1280) 减去内边距只剩 1232,来源列会被永久截掉。
          窄屏仍由 Table 自己的横向滚动兜底。 */}
      <BackLink to="/">返回首页</BackLink>
      <div className="mb-4 mt-3 flex flex-wrap items-center justify-between gap-3">
        <Typography.Title level={3} style={{ margin: 0 }}>信号追踪</Typography.Title>
        {isAdmin && (
          <Space>
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={scanning}
              onClick={() => void extract()}
              autoInsertSpace={false}
            >
              重新抽取
            </Button>
            <Button
              type="primary"
              icon={<ThunderboltOutlined aria-hidden />}
              loading={scanning}
              onClick={() => void scan()}
              autoInsertSpace={false}
            >
              立即扫描
            </Button>
          </Space>
        )}
      </div>

      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        SuperTrend 收盘口径,盘中不更新。信号用全复权价计算,现价显示原始未复权价。
      </Typography.Paragraph>

      {error && <Alert type="error" title={error} showIcon className="mb-4" />}

      <RecentSignalEvents />

      <Table<SignalRow>
        rowKey="symbol"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        // 必须是具体像素而不是 'max-content':展开行里的 SignalLog 是一张带
        // `min-width: 100%` 的嵌套表格,父级若是 max-content 就构成循环约束 ——
        // 浏览器实测会把表格撑到 500000px,除「标的」外所有列被推出屏幕。
        scroll={{ x: 1280 }}
        locale={{ emptyText: '还没有自选股 —— 上传一篇标题里带股票代码的研报,或点「重新抽取」' }}
        expandable={{
          expandedRowRender: (r) => <SignalLog symbol={r.symbol} />,
          rowExpandable: (r) => r.status === 'ok',
        }}
      />
    </div>
  )
}
