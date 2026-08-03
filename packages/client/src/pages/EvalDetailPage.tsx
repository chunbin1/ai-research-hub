import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card, Empty } from 'antd'
import { useEval } from '../hooks/useEval'
import { BackLink } from '../components/BackLink'
import type { EvalResultRow } from '../types'

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
    <div className="mx-auto max-w-[860px] px-4 py-5 md:px-6 md:py-7">
      <BackLink to="/eval" className="text-[14px] text-[#555]">评估列表</BackLink>
      <h1 className="mt-3 mb-1.5 text-[22px] font-bold">评估明细</h1>
      <div className="mb-5 text-[#666]">{title}</div>
      {results.map((r, i) => {
        let reason: Record<string, string> = {}
        try { reason = JSON.parse(r.reasoning) } catch { /* ignore */ }
        let sections: string[] = []
        try { sections = JSON.parse(r.retrieved_sections) } catch { /* ignore */ }
        return (
          <Card key={i} size="small" className="mb-3.5" title={`Q${i + 1}. ${r.question}`}>
            <div className="mb-2.5 flex flex-wrap gap-3 text-[13px]">
              <span className={r.recall ? 'text-[#1a7f37]' : 'text-danger'}>召回 {pct(r.recall)}</span>
              <span>精确 {pct(r.precision)}</span><span>忠实 {pct(r.faithfulness)}</span><span>相关 {pct(r.relevancy)}</span>
            </div>
            <div className="my-1.5 text-[14px] leading-[1.6]"><b className="mr-1 text-[#555]">期望答案:</b>{r.expected}</div>
            <div className="my-1.5 text-[14px] leading-[1.6]"><b className="mr-1 text-[#555]">检索到章节:</b>{sections.join(' / ') || '(无)'}</div>
            <div className="my-1.5 text-[14px] leading-[1.6]"><b className="mr-1 text-[#555]">AI 答案:</b>{r.answer}</div>
            {reason.precision && <div className="mt-2 border-t border-dashed border-[#eee] pt-2 text-[12px] text-[#888]">判分理由 — 精确:{reason.precision};忠实:{reason.faithfulness};相关:{reason.relevancy}</div>}
          </Card>
        )
      })}
      {results.length === 0 && <Empty description="无明细" />}
    </div>
  )
}
