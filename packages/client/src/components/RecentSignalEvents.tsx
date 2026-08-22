import { useEffect, useState } from 'react'
import { Alert, Space, Tag, Typography } from 'antd'
import { api } from '../api'
import type { SignalEventRow } from '../types'

/** 最近 7 天发生的信号翻转。没有事件时整个不渲染,不占版面。 */
export function RecentSignalEvents({ version }: { version: number }) {
  const [events, setEvents] = useState<SignalEventRow[]>([])

  // version 由 useSignals 在每次成功 refresh 后自增 —— 单靠 [] 只在挂载时拉一次,
  // 扫描完横幅还是旧数据,得靠这个 dep 触发重新拉取
  useEffect(() => {
    let cancelled = false
    void api.listSignalEvents(7)
      .then(rows => { if (!cancelled) setEvents(rows) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [version])

  if (events.length === 0) return null

  return (
    <Alert
      className="mb-4"
      type="info"
      showIcon
      title="最近 7 天的信号"
      description={
        <Space orientation="vertical" size={2}>
          {events.map(e => (
            <Typography.Text key={`${e.symbol}-${e.timeframe}-${e.bar_date}`}>
              {e.bar_date}　<Typography.Text strong>{e.symbol}</Typography.Text>
              　{e.timeframe === '1d' ? '日线' : '周线'}
              　<Tag color={e.direction === 1 ? 'green' : 'red'}>
                {e.direction === 1 ? '翻多' : '翻空'}
              </Tag>
              @ {e.price.toFixed(2)}
            </Typography.Text>
          ))}
        </Space>
      }
    />
  )
}
