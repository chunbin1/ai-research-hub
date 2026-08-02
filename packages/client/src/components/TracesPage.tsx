import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTraces } from '../hooks/useTraces'
import { TraceList } from './TraceList'
import { TraceStats } from './TraceStats'

const controlClass = 'border border-gray-200 rounded px-2.5 py-1.5 text-[13px] bg-white cursor-pointer'

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
        <Link to="/" className="text-[13px] text-violet-600 no-underline hover:underline">← 返回首页</Link>
        <h1 className="m-0 text-[20px] font-bold text-gray-900">🔍 Traces</h1>
        <div className="ml-auto flex gap-2">
          <select
            className={controlClass}
            value={status}
            onChange={e => setStatus(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="ok">正常</option>
            <option value="degraded">降级</option>
            <option value="error">错误</option>
          </select>
          <button className={`${controlClass} hover:bg-gray-50`} onClick={load}>刷新</button>
        </div>
      </header>

      {stats && <TraceStats stats={stats} />}

      {error && (
        <div className="mb-4 flex items-center gap-3 rounded bg-[#fee2e2] px-4 py-3 text-[#dc2626]">
          {error}
          <button className="rounded border border-[#dc2626] bg-white px-2.5 py-1 text-[#dc2626] cursor-pointer" onClick={load}>重试</button>
        </div>
      )}

      {loading
        ? <div className="p-12 text-center text-gray-400">加载中…</div>
        : <TraceList traces={traces} onSelect={id => navigate(`/traces/${id}`)} />}
    </div>
  )
}
