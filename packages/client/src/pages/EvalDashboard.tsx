import { useNavigate, Link } from 'react-router-dom'
import { useEval } from '../hooks/useEval'
import type { EvalStatus } from '../types'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const statusLabel: Record<EvalStatus, string> = { none: '未评估', running: '评估中…', done: '已完成', failed: '失败' }
const statusClass: Record<EvalStatus, string> = {
  none: 'text-[#999]',
  running: 'text-[#c9821b]',
  done: 'text-[#1a7f37]',
  failed: 'text-danger',
}

const thtd = 'border-b border-[#eee] px-3 py-2.5 text-left'

export default function EvalDashboard() {
  const { stats, reports, runEval } = useEval()
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5 md:px-6 md:py-7">
      <header className="mb-5 flex flex-wrap items-center gap-4">
        <Link to="/" className="text-[14px] text-[#555] hover:text-black">← 全部报告</Link>
        <h1 className="m-0 text-[22px] font-bold">📊 检索质量评估</h1>
      </header>

      <div className="mb-6 flex flex-wrap gap-3.5">
        <div className="min-w-[120px] rounded-xl border border-[#ececec] bg-white px-[22px] py-4">
          <div className="text-[24px] font-semibold">{stats?.docsEvaluated ?? 0}</div>
          <div className="mt-1 text-[13px] text-[#888]">已评估篇数</div>
        </div>
        <div className="min-w-[120px] rounded-xl border border-[#ececec] bg-white px-[22px] py-4">
          <div className="text-[24px] font-semibold">{pct(stats?.avgRecall ?? null)}</div>
          <div className="mt-1 text-[13px] text-[#888]">平均召回率</div>
        </div>
        <div className="min-w-[120px] rounded-xl border border-[#ececec] bg-white px-[22px] py-4">
          <div className="text-[24px] font-semibold">{pct(stats?.avgPrecision ?? null)}</div>
          <div className="mt-1 text-[13px] text-[#888]">平均精确率</div>
        </div>
        <div className="min-w-[120px] rounded-xl border border-[#ececec] bg-white px-[22px] py-4">
          <div className="text-[24px] font-semibold">{pct(stats?.avgFaithfulness ?? null)}</div>
          <div className="mt-1 text-[13px] text-[#888]">平均忠实度</div>
        </div>
        <div className="min-w-[120px] rounded-xl border border-[#ececec] bg-white px-[22px] py-4">
          <div className="text-[24px] font-semibold">{pct(stats?.avgRelevancy ?? null)}</div>
          <div className="mt-1 text-[13px] text-[#888]">平均相关性</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap md:whitespace-normal text-[14px]">
          <thead>
            <tr>
              <th className={`${thtd} text-[#666] font-semibold`}>报告</th>
              <th className={`${thtd} text-[#666] font-semibold`}>召回</th>
              <th className={`${thtd} text-[#666] font-semibold`}>精确</th>
              <th className={`${thtd} text-[#666] font-semibold`}>忠实</th>
              <th className={`${thtd} text-[#666] font-semibold`}>相关</th>
              <th className={`${thtd} text-[#666] font-semibold`}>题数</th>
              <th className={`${thtd} text-[#666] font-semibold`}>状态</th>
              <th className={`${thtd} text-[#666] font-semibold`}></th>
            </tr>
          </thead>
          <tbody>
            {reports.map(r => (
              <tr key={r.doc_id}>
                <td className={`${thtd} cursor-pointer text-[#1a1a1a] hover:text-gold`} onClick={() => r.status === 'done' && navigate(`/eval/${r.doc_id}`)}>{r.filename}</td>
                <td className={thtd}>{pct(r.avg_recall)}</td><td className={thtd}>{pct(r.avg_precision)}</td><td className={thtd}>{pct(r.avg_faithfulness)}</td><td className={thtd}>{pct(r.avg_relevancy)}</td>
                <td className={thtd}>{r.question_count || '—'}</td>
                <td className={`${thtd} ${statusClass[r.status]}`}>{statusLabel[r.status]}</td>
                <td className={thtd}>
                  <button className="cursor-pointer rounded-lg border border-[#1a1a1a] bg-[#1a1a1a] px-3 py-[5px] text-[13px] text-white disabled:cursor-default disabled:opacity-50" disabled={r.status === 'running'} onClick={() => void runEval(r.doc_id)}>
                    {r.status === 'running' ? '评估中…' : '跑评估'}
                  </button>
                </td>
              </tr>
            ))}
            {reports.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-[#999]">暂无报告</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
