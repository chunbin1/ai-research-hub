import { useNavigate, Link } from 'react-router-dom'
import { useEval } from '../hooks/useEval'
import type { EvalStatus } from '../types'
import styles from './EvalDashboard.module.css'

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const statusLabel: Record<EvalStatus, string> = { none: '未评估', running: '评估中…', done: '已完成', failed: '失败' }

export default function EvalDashboard() {
  const { stats, reports, runEval } = useEval()
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.back}>← 全部报告</Link>
        <h1>📊 检索质量评估</h1>
      </header>

      <div className={styles.stats}>
        <div className={styles.stat}><div className={styles.v}>{stats?.docsEvaluated ?? 0}</div><div className={styles.l}>已评估篇数</div></div>
        <div className={styles.stat}><div className={styles.v}>{pct(stats?.avgRecall ?? null)}</div><div className={styles.l}>平均召回率</div></div>
        <div className={styles.stat}><div className={styles.v}>{pct(stats?.avgPrecision ?? null)}</div><div className={styles.l}>平均精确率</div></div>
        <div className={styles.stat}><div className={styles.v}>{pct(stats?.avgFaithfulness ?? null)}</div><div className={styles.l}>平均忠实度</div></div>
        <div className={styles.stat}><div className={styles.v}>{pct(stats?.avgRelevancy ?? null)}</div><div className={styles.l}>平均相关性</div></div>
      </div>

      <table className={styles.table}>
        <thead><tr><th>报告</th><th>召回</th><th>精确</th><th>忠实</th><th>相关</th><th>题数</th><th>状态</th><th></th></tr></thead>
        <tbody>
          {reports.map(r => (
            <tr key={r.doc_id}>
              <td className={styles.name} onClick={() => r.status === 'done' && navigate(`/eval/${r.doc_id}`)}>{r.filename}</td>
              <td>{pct(r.avg_recall)}</td><td>{pct(r.avg_precision)}</td><td>{pct(r.avg_faithfulness)}</td><td>{pct(r.avg_relevancy)}</td>
              <td>{r.question_count || '—'}</td>
              <td className={styles[`s_${r.status}`]}>{statusLabel[r.status]}</td>
              <td>
                <button className={styles.runBtn} disabled={r.status === 'running'} onClick={() => void runEval(r.doc_id)}>
                  {r.status === 'running' ? '评估中…' : '跑评估'}
                </button>
              </td>
            </tr>
          ))}
          {reports.length === 0 && <tr><td colSpan={8} className={styles.empty}>暂无报告</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
