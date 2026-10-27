import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatUsd, securityTitle, type WhaleSummary } from '../lib/whaleView'

const GUTTER = 'px-[18px] md:px-7 lg:px-10'

export default function WhalesPage() {
  const [institutions, setInstitutions] = useState<WhaleSummary[] | null>(null)
  const [valueNote, setValueNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/whales')
      .then(async response => {
        if (cancelled) return
        if (response.status === 404) {
          const body = await response.json().catch(() => null) as { error?: string } | null
          if (body?.error === 'whales_disabled') {
            setError('大佬持仓已关闭')
            setLoading(false)
            return
          }
        }
        if (!response.ok) {
          setError('大佬持仓加载失败')
          setLoading(false)
          return
        }
        const body = await response.json() as { institutions: WhaleSummary[]; valueNote?: string }
        setInstitutions(body.institutions)
        setValueNote(body.valueNote ?? '')
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError('大佬持仓加载失败')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-ink-mute ${GUTTER}`}>加载中…</div>
  }
  if (error) {
    return <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-danger ${GUTTER}`}>{error}</div>
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
      <div className={`flex flex-col gap-2 border-b border-rule pb-4 pt-3.5 md:border-b-0 md:pb-6 md:pt-8 ${GUTTER}`}>
        <h1 className="m-0 font-serif-sc text-[17px] font-semibold text-ink md:text-[26px]">大佬持仓</h1>
        <p className="m-0 max-w-[640px] text-[12px] leading-[1.65] text-ink-mute md:text-[13px] md:leading-[1.6]">
          美国 SEC Form 13F 的公开申报。
        </p>
      </div>

      <main className={`flex-1 ${GUTTER}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-t border-ink text-left">
            <thead>
              <tr className="border-b border-rule text-[12px] tracking-[0.02em] text-ink-mute">
                <th scope="col" className="py-3 pr-3 font-normal">管理人</th>
                <th scope="col" className="py-3 pr-3 font-normal">机构</th>
                <th scope="col" className="py-3 pr-3 font-normal">报告期</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">持仓数</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">市值合计（美元）</th>
                <th scope="col" className="py-3 pr-3 font-normal">第一大持仓</th>
                <th scope="col" className="py-3 font-normal">状态</th>
              </tr>
            </thead>
            <tbody>
              {(institutions ?? []).map(row => (
                <tr key={row.slug} className="border-b border-row-rule">
                  <td className="py-4 pr-3">
                    <Link to={`/whales/${row.slug}`} className="text-[15px] font-medium text-ink hover:text-brick">
                      {row.manager}
                    </Link>
                  </td>
                  <td className="py-4 pr-3 text-[13px] text-ink-soft">{row.nameZh}</td>
                  <td className="py-4 pr-3 font-sans-sc text-[14px] tabular-nums text-ink">
                    {row.latest ? <time dateTime={row.latest.reportPeriod}>{row.latest.reportPeriod}</time> : '—'}
                  </td>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                    {row.latest ? row.latest.positionCount : '—'}
                  </td>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                    {row.latest ? formatUsd(row.latest.totalValueUsd) : '—'}
                  </td>
                  <td className="py-4 pr-3 text-[13px] text-ink">
                    {row.latest?.top ? securityTitle(row.latest.top) : '—'}
                  </td>
                  <td className="py-4 text-[13px]">
                    {row.dataStatus === 'empty' ? (
                      <div className="flex flex-col gap-1">
                        <span className="text-ink-mute">暂无数据</span>
                        {row.syncError && <span className="text-[12px] text-ink-faint">最近一次拉取失败</span>}
                      </div>
                    ) : (
                      <span className="text-ink-soft">{row.latest?.form}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <footer className={`mt-5 border-t border-rule pb-7 pt-4 text-[11px] leading-[1.6] text-ink-faint md:mt-6 md:pt-5 md:text-[12px] ${GUTTER}`}>
        {valueNote || '市值单位为美元。'} 13F 通常在季末后 45 天内申报，只覆盖美国披露范围内的多头。
      </footer>
    </div>
  )
}
