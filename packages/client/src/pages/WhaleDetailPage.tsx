import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BackLink } from '../components/BackLink'
import { formatWeight } from '../lib/holdingsView'
import {
  changeClassName, changeLabel, formatShareDelta, formatShares, formatUsd, putCallLabel, securityTitle,
  shareTypeLabel,
  type WhaleDetail, type WhalePosition,
} from '../lib/whaleView'

const GUTTER = 'px-[18px] md:px-7 lg:px-10'

/** 和阅读页工具栏「全部报告」同一套：11px 回退图标、次文字、悬停浅底，右侧细分隔线。 */
function BackToList() {
  return (
    <div className="flex w-fit min-w-0 items-center gap-2.5 self-start">
      <BackLink
        to="/whales"
        className="-ml-1 inline-flex flex-none items-center rounded py-1 pl-1 pr-2 text-[13px] text-ink-soft hover:bg-[#F0EEE8] hover:text-navy"
      >
        名家持仓
      </BackLink>
      <span className="h-3.5 w-px flex-none bg-edge" aria-hidden />
    </div>
  )
}

function ChangeCell({ row, byShares }: { row: WhalePosition; byShares: boolean }) {
  if (!row.change) return <span className="text-ink-mute">—</span>
  const delta = !byShares || row.change === 'unchanged' || row.shareDelta === null
    ? ''
    : ` ${formatShareDelta(row.shareDelta)}`
  return <span className={changeClassName(row.change)}>{changeLabel(row.change)}{delta}</span>
}

function SecurityCell({ row }: { row: WhalePosition }) {
  const option = putCallLabel(row.putCall)
  const amount = shareTypeLabel(row.shareType)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[15px] font-medium text-ink">
        {securityTitle(row)}
        {option && <span className="ml-2 text-[12px] font-normal text-ink-mute">{option}</span>}
        {amount && <span className="ml-2 text-[12px] font-normal text-ink-mute">{amount}</span>}
      </span>
      <span className="truncate text-[12px] text-ink-faint">
        {row.ticker ? `${row.issuerName} · ` : ''}
        <span className="font-sans-sc tabular-nums">{row.cusip}</span>
      </span>
    </div>
  )
}

function PositionTable({ rows, showWeight, byShares, showChange }: { rows: WhalePosition[]; showWeight: boolean; byShares: boolean; showChange: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-t border-ink text-left">
        <thead>
          <tr className="border-b border-rule text-[12px] tracking-[0.02em] text-ink-mute">
            <th scope="col" className="py-3 pr-3 font-normal">标的</th>
            <th scope="col" className="py-3 pr-3 text-right font-normal">数量</th>
            <th scope="col" className="py-3 pr-3 text-right font-normal">市值（美元）</th>
            {showWeight && <th scope="col" className="py-3 pr-3 text-right font-normal">占比</th>}
            {showChange && <th scope="col" className="py-3 text-right font-normal">相对上期</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`${row.cusip}-${row.putCall}-${row.shareType}`} className="border-b border-row-rule">
              <td className="py-4 pr-3"><SecurityCell row={row} /></td>
              <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                {row.valueLabel && row.shares === 0 ? '—' : formatShares(row.shares)}
              </td>
              <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                {row.valueLabel ?? formatUsd(row.valueUsd)}
              </td>
              {showWeight && (
                <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                  {row.weight === null ? '—' : formatWeight(row.weight)}
                </td>
              )}
              {showChange && (
                <td className="py-4 text-right font-sans-sc text-[14px] tabular-nums"><ChangeCell row={row} byShares={byShares} /></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function WhaleDetailPage() {
  const { slug = '' } = useParams()
  const [detail, setDetail] = useState<WhaleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    void fetch(`/api/whales/${encodeURIComponent(slug)}`)
      .then(async response => {
        if (cancelled) return
        if (response.status === 404) {
          const body = await response.json().catch(() => null) as { error?: string } | null
          setError(body?.error === 'whales_disabled' ? '名家持仓已关闭' : '没有这家机构')
          setLoading(false)
          return
        }
        if (!response.ok) {
          setError('持仓加载失败')
          setLoading(false)
          return
        }
        setDetail(await response.json() as WhaleDetail)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError('持仓加载失败')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [slug])

  if (loading) {
    return <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-ink-mute ${GUTTER}`}>加载中…</div>
  }
  if (error || !detail) {
    return (
      <div className={`mx-auto w-full max-w-[1440px] py-8 text-[13px] text-danger ${GUTTER}`}>
        <BackToList />
        <p className="m-0 mt-3">{error ?? '持仓加载失败'}</p>
      </div>
    )
  }

  const { institution, period } = detail
  const house = institution.source === 'house-fd'

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
      <div className={`flex flex-col gap-2 border-b border-rule pb-4 pt-3.5 md:border-b-0 md:pb-6 md:pt-8 ${GUTTER}`}>
        <BackToList />
        <h1 className="m-0 font-serif-sc text-[17px] font-semibold text-ink md:text-[26px]">{institution.manager}</h1>
        <p className="m-0 max-w-[720px] text-[12px] leading-[1.65] text-ink-mute md:text-[13px]">
          {institution.nameZh} · {institution.nameEn}
          {institution.source === 'house-fd' ? '' : ` · CIK ${institution.cik}`}
        </p>
      </div>

      <main className={`flex flex-1 flex-col gap-8 ${GUTTER}`}>
        {!period || institution.dataStatus === 'empty' ? (
          <p className="m-0 py-8 text-[14px] text-ink-mute">暂无数据</p>
        ) : (
          <>
            <div className="flex flex-col gap-1 pt-1 text-[13px] text-ink-soft">
              <p className="m-0">
                报告期 <time dateTime={period.reportPeriod}>{period.reportPeriod}</time>
                {' · '}申报日 <time dateTime={period.filedAt}>{period.filedAt}</time>
                {' · '}{period.form}
                {' · '}
                <a href={period.sourceUrl} className="text-navy" target="_blank" rel="noreferrer">
                  {institution.source === 'house-fd' ? '众议院原文' : 'SEC 原文'}
                </a>
              </p>
              <p className="m-0 text-[12px] text-ink-faint">
                {detail.previousPeriod
                  ? <>对比上期 <time dateTime={detail.previousPeriod.reportPeriod}>{detail.previousPeriod.reportPeriod}</time>。{house ? '增减按申报区间中点，不按股数。' : '增减按股数，不按市值。'}</>
                  : house
                    ? '暂无上期可对比。有上一期时，增减按申报区间中点，不按股数。'
                    : '暂无上期可对比。'}
              </p>
            </div>
            <PositionTable rows={detail.positions} showWeight byShares={!house} showChange={detail.previousPeriod !== null} />
            {detail.closed.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="m-0 font-serif-sc text-[16px] font-semibold text-ink">清仓</h2>
                <PositionTable rows={detail.closed} showWeight={false} byShares={!house} showChange={detail.previousPeriod !== null} />
              </section>
            )}
          </>
        )}
      </main>

      <footer className={`mt-5 border-t border-rule pb-7 pt-4 text-[11px] leading-[1.6] text-ink-faint md:mt-6 md:pt-5 md:text-[12px] ${GUTTER}`}>
        {detail.valueNote} 加仓、新建仓为红，减仓、清仓为绿。
      </footer>
    </div>
  )
}
