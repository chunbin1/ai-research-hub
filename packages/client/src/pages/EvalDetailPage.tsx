import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useEval } from '../hooks/useEval'
import type { EvalResultRow } from '../types'
import styles from './EvalDetailPage.module.css'

const pct = (v: number) => `${Math.round(v * 100)}%`

export default function EvalDetailPage() {
  const { docId = '' } = useParams()
  const { fetchDetail } = useEval()
  const [results, setResults] = useState<EvalResultRow[]>([])
  const [title, setTitle] = useState('')

  useEffect(() => {
    void fetchDetail(docId).then(d => {
      if (d) { setResults(d.results); setTitle(`召回${pct(d.run.avg_recall)} · 精确${pct(d.run.avg_precision)} · 忠实${pct(d.run.avg_faithfulness)} · 相关${pct(d.run.avg_relevancy)}`) }
    })
  }, [docId, fetchDetail])

  return (
    <div className={styles.page}>
      <Link to="/eval" className={styles.back}>← 评估列表</Link>
      <h1 className={styles.h1}>评估明细</h1>
      <div className={styles.summary}>{title}</div>
      {results.map((r, i) => {
        let reason: Record<string, string> = {}
        try { reason = JSON.parse(r.reasoning) } catch { /* ignore */ }
        let sections: string[] = []
        try { sections = JSON.parse(r.retrieved_sections) } catch { /* ignore */ }
        return (
          <div key={i} className={styles.card}>
            <div className={styles.q}>Q{i + 1}. {r.question}</div>
            <div className={styles.scores}>
              <span className={r.recall ? styles.ok : styles.bad}>召回 {pct(r.recall)}</span>
              <span>精确 {pct(r.precision)}</span><span>忠实 {pct(r.faithfulness)}</span><span>相关 {pct(r.relevancy)}</span>
            </div>
            <div className={styles.row}><b>期望答案:</b>{r.expected}</div>
            <div className={styles.row}><b>检索到章节:</b>{sections.join(' / ') || '(无)'}</div>
            <div className={styles.row}><b>AI 答案:</b>{r.answer}</div>
            {reason.precision && <div className={styles.reason}>判分理由 — 精确:{reason.precision};忠实:{reason.faithfulness};相关:{reason.relevancy}</div>}
          </div>
        )
      })}
      {results.length === 0 && <p className={styles.empty}>无明细</p>}
    </div>
  )
}
