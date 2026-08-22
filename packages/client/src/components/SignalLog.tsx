import { useEffect, useState } from 'react'
import { Empty, Radio, Table, Tag } from 'antd'
import { api } from '../api'
import type { SignalStateRow } from '../types'

/** 展开行里的每日状态日志 —— 「保留每天的日志」这个需求的可见出口 */
export function SignalLog({ symbol, version }: { symbol: string; version: number }) {
  const [timeframe, setTimeframe] = useState<'1d' | '1wk'>('1d')
  const [states, setStates] = useState<SignalStateRow[]>([])
  const [loading, setLoading] = useState(true)

  // version 由 useSignals 在每次成功 refresh 后自增。行已经展开着的时候扫描一次,
  // 只靠 [symbol, timeframe] 是看不出数据变了的,得靠这个 dep 触发重新拉取
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void api.getSignalLog(symbol, timeframe, 60)
      .then(rows => { if (!cancelled) setStates(rows) })
      .catch(() => { if (!cancelled) setStates([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol, timeframe, version])

  const columns = [
    { title: '交易日', dataIndex: 'bar_date', key: 'bar_date' },
    {
      title: '趋势', dataIndex: 'trend', key: 'trend',
      render: (t: 1 | -1) => <Tag color={t === 1 ? 'green' : 'red'}>{t === 1 ? '多头' : '空头'}</Tag>,
    },
    { title: '止损线', dataIndex: 'stop_line', key: 'stop_line', render: (v: number) => v.toFixed(2) },
    { title: '收盘(原始)', dataIndex: 'close_raw', key: 'close_raw', render: (v: number) => v.toFixed(2) },
    { title: '收盘(复权)', dataIndex: 'close_adj', key: 'close_adj', render: (v: number) => v.toFixed(2) },
    { title: 'ATR', dataIndex: 'atr', key: 'atr', render: (v: number) => v.toFixed(2) },
  ]

  return (
    <div className="p-2">
      <Radio.Group
        className="mb-3"
        value={timeframe}
        onChange={e => setTimeframe(e.target.value as '1d' | '1wk')}
        options={[{ label: '日线', value: '1d' }, { label: '周线', value: '1wk' }]}
        optionType="button"
        size="small"
      />
      {/* 这张嵌套表没有自己的 scroll.x,靠 antd 默认的 min-width: 100% 撑满父级。
          这依赖外层 SignalsPage 的 Table 保持一个具体像素的 scroll.x —— 那边一旦
          改回 'max-content',约束就变成循环的,布局会直接撑爆(实测到过 500048px)。 */}
      <Table<SignalStateRow>
        rowKey="bar_date"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={states}
        pagination={false}
        scroll={{ y: 320 }}
        locale={{ emptyText: <Empty description="暂无日志 —— 该标的还没扫描成功" /> }}
      />
    </div>
  )
}
