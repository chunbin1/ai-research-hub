import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NodeIndexOutlined } from '@ant-design/icons'
import { Select, Button, Alert } from 'antd'
import { useTraces } from '../hooks/useTraces'
import { TraceList } from './TraceList'
import { TraceStats } from './TraceStats'
import { BackLink } from './BackLink'

export function TracesPage() {
  const { traces, stats, loading, error, fetchList, fetchStats } = useTraces()
  const [status, setStatus] = useState('')
  const navigate = useNavigate()

  const load = (): void => {
    void fetchList({ status: status || undefined, limit: 100 })
    void fetchStats()
  }

  useEffect(load, [status])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:p-6">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <BackLink to="/" className="text-[13px] text-violet-600 no-underline hover:underline">返回首页</BackLink>
        <h1 className="m-0 text-[20px] font-bold text-gray-900"><NodeIndexOutlined aria-hidden /> Traces</h1>
        <div className="ml-auto flex gap-2">
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 120 }}
            options={[
              { value: '',         label: '全部状态' },
              { value: 'ok',       label: '正常' },
              { value: 'degraded', label: '降级' },
              { value: 'error',    label: '错误' },
            ]}
          />
          <Button onClick={load}>刷新</Button>
        </div>
      </header>

      {stats && <TraceStats stats={stats} />}

      {error && (
        <Alert
          type="error"
          className="mb-4"
          title={error}
          action={<Button size="small" danger onClick={load}>重试</Button>}
        />
      )}

      {loading
        ? <div className="p-12 text-center text-gray-400">加载中…</div>
        : <TraceList traces={traces} onSelect={id => navigate(`/traces/${id}`)} />}
    </div>
  )
}
