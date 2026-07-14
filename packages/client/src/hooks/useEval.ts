import { useCallback, useEffect, useState } from 'react'
import type { EvalReportRow, EvalStats, EvalResultRow } from '../types'

export function useEval() {
  const [stats, setStats] = useState<EvalStats | null>(null)
  const [reports, setReports] = useState<EvalReportRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDashboard = useCallback(async () => {
    try {
      const r = await fetch('/api/eval')
      if (!r.ok) { setReports([]); setStats(null); return }
      const d = await r.json() as { stats: EvalStats; reports: EvalReportRow[] }
      setStats(d.stats); setReports(d.reports)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchDashboard() }, [fetchDashboard])

  // 有 running 时轮询
  useEffect(() => {
    if (!reports.some(r => r.status === 'running')) return
    const t = setInterval(() => void fetchDashboard(), 4000)
    return () => clearInterval(t)
  }, [reports, fetchDashboard])

  const runEval = useCallback(async (docId: string) => {
    await fetch('/api/eval/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId }) })
    await fetchDashboard()
  }, [fetchDashboard])

  const fetchDetail = useCallback(async (docId: string) => {
    const r = await fetch(`/api/eval/${docId}`)
    if (!r.ok) return null
    return r.json() as Promise<{ run: { avg_recall: number; avg_precision: number; avg_faithfulness: number; avg_relevancy: number; question_count: number; status: string }; results: EvalResultRow[] }>
  }, [])

  return { stats, reports, loading, fetchDashboard, runEval, fetchDetail }
}
