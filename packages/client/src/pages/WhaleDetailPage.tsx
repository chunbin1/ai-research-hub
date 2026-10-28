import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { BackLink } from '../components/BackLink'
import { formatWeight } from '../lib/holdingsView'
import {
  changeClassName, changeLabel, formatGain, formatPrice, formatShareDelta, formatShares, formatUsd, gainClassName,
  putCallLabel, securityTitle, shareTypeLabel,
  type WhaleCostSummary, type WhaleDetail, type WhalePosition,
} from '../lib/whaleView'

const GUTTER = 'px-[18px] md:px-7 lg:px-10'

/** 和阅读页工具栏「全部报告」同一套：11px 回退图标、次文字、悬停浅底。详情页右侧没有后续控件，不加分隔线。 */
function BackToList() {
  return (
    <div className="w-fit min-w-0 self-start">
      <BackLink
        to="/whales"
        className="-ml-1 inline-flex flex-none items-center rounded py-1 pl-1 pr-2 text-[13px] text-ink-soft hover:bg-[#F0EEE8] hover:text-navy"
      >
        名家持仓
      </BackLink>
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

/** 估算成本一格：每股成本；从库内最早一期起算的，下面小字标出起算期。 */
function CostCell({ row }: { row: WhalePosition }) {
  if (!row.cost) return <span className="text-ink-mute">—</span>
  return (
    <div className="flex flex-col items-end gap-1">
      <span>{formatPrice(row.cost.costPerShare)}</span>
      {!row.cost.fromStart && (
        <span className="text-[11px] text-ink-faint" title="库内最早一期已持有，成本只从这一期期末价算起">
          起算 {row.cost.since}
        </span>
      )}
    </div>
  )
}

function CostSummaryLine({ summary }: { summary: WhaleCostSummary }) {
  const covered = summary.coveredWeight < 0.9995
  const partial = summary.partialWeight > 0.0005
  return (
    <p className="m-0 text-[13px] text-ink-soft">
      估算成本合计 <span className="font-sans-sc tabular-nums text-ink">{formatUsd(summary.costUsd)}</span> 美元
      {' · '}期末市值 <span className="font-sans-sc tabular-nums text-ink">{formatUsd(summary.valueUsd)}</span> 美元
      {' · '}相对成本 <span className={`font-sans-sc tabular-nums ${gainClassName(summary.gain)}`}>{formatGain(summary.gain)}</span>
      {(covered || partial) && (
        <span className="text-[12px] text-ink-faint">
          （{covered ? `覆盖本期市值的 ${formatWeight(summary.coveredWeight)}` : ''}
          {covered && partial ? '；' : ''}
          {partial ? `其中 ${formatWeight(summary.partialWeight)} 的成本只从库内最早一期起算` : ''}）
        </span>
      )}
    </p>
  )
}

function PositionTable({ rows, showWeight, byShares, showChange, showCost }: {
  rows: WhalePosition[]
  showWeight: boolean
  byShares: boolean
  showChange: boolean
  showCost: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full ${showCost ? 'min-w-[1080px]' : 'min-w-[760px]'} border-t border-ink text-left`}>
        <thead>
          <tr className="border-b border-rule text-[12px] tracking-[0.02em] text-ink-mute">
            <th scope="col" className="py-3 pr-3 font-normal">标的</th>
            <th scope="col" className="py-3 pr-3 text-right font-normal">数量</th>
            <th scope="col" className="py-3 pr-3 text-right font-normal">市值（美元）</th>
            {showWeight && <th scope="col" className="py-3 pr-3 text-right font-normal">占比</th>}
            {showCost && (
              <>
                <th scope="col" className="py-3 pr-3 text-right font-normal">期末价</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">估算成本</th>
                <th scope="col" className="py-3 pr-3 text-right font-normal">相对成本</th>
              </>
            )}
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
              {showCost && (
                <>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                    {row.cost ? formatPrice(row.cost.pricePerShare) : '—'}
                  </td>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums text-ink">
                    <CostCell row={row} />
                  </td>
                  <td className="py-4 pr-3 text-right font-sans-sc text-[16px] tabular-nums">
                    {row.cost
                      ? <span className={gainClassName(row.cost.gain)}>{formatGain(row.cost.gain)}</span>
                      : <span className="text-ink-mute">—</span>}
                  </td>
                </>
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

function loadErrorMessage(code: string | undefined): string {
  if (code === 'whales_disabled') return '名家持仓已关闭'
  if (code === 'invalid_input') return '报告期格式不对'
  if (code === 'period_not_found') return '没有这一报告期'
  if (code === 'not_found') return '没有这家机构'
  return '持仓加载失败'
}

function recoveredPeriodMessage(code: 'invalid_input' | 'period_not_found'): string {
  if (code === 'invalid_input') return '报告期格式不对，已回到最新一期'
  return '没有这一报告期，已回到最新一期'
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export default function WhaleDetailPage() {
  const { slug = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const periodQuery = searchParams.get('period') ?? ''
  const [detail, setDetail] = useState<WhaleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 非法期或缺期会清掉 query 再拉最新一期。清 query 会重跑 effect，用 ref 把提示留到这次成功加载。
  const recoveryNotice = useRef<{ slug: string; message: string } | null>(null)

  useEffect(() => {
    // 回退最新一期时刚清掉 query。同一条数据已经在手里，不要再打一次请求，
    // 否则会闪一下「加载中」，StrictMode 再跑一遍 effect 还会把提示清掉。
    if (periodQuery === '' && recoveryNotice.current?.slug === slug) {
      setNotice(recoveryNotice.current.message)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const query = periodQuery ? `?period=${encodeURIComponent(periodQuery)}` : ''

    void (async () => {
      try {
        const response = await fetch(`/api/whales/${encodeURIComponent(slug)}${query}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null
          if (controller.signal.aborted) return
          const code = body?.error
          if ((code === 'invalid_input' || code === 'period_not_found') && periodQuery) {
            const fallback = await fetch(`/api/whales/${encodeURIComponent(slug)}`, { signal: controller.signal })
            if (controller.signal.aborted) return
            if (fallback.ok) {
              const data = await fallback.json() as WhaleDetail
              if (controller.signal.aborted) return
              const message = recoveredPeriodMessage(code)
              recoveryNotice.current = { slug, message }
              setDetail(data)
              setNotice(message)
              setError(null)
              setLoading(false)
              setSearchParams(prev => {
                const params = new URLSearchParams(prev)
                params.delete('period')
                return params
              }, { replace: true })
              return
            }
            const fallbackBody = await fallback.json().catch(() => null) as { error?: string } | null
            if (controller.signal.aborted) return
            recoveryNotice.current = null
            setDetail(null)
            setNotice(null)
            setError(loadErrorMessage(fallbackBody?.error ?? code))
            setLoading(false)
            return
          }
          recoveryNotice.current = null
          setDetail(null)
          setNotice(null)
          setError(loadErrorMessage(code))
          setLoading(false)
          return
        }
        const data = await response.json() as WhaleDetail
        if (controller.signal.aborted) return
        setDetail(data)
        if (recoveryNotice.current?.slug === slug && periodQuery === '') setNotice(recoveryNotice.current.message)
        else setNotice(null)
        recoveryNotice.current = null
        setLoading(false)
      } catch (err) {
        if (controller.signal.aborted || isAbort(err)) return
        recoveryNotice.current = null
        setDetail(null)
        setNotice(null)
        setError('持仓加载失败')
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [slug, periodQuery, setSearchParams])

  function choosePeriod(next: string) {
    const latestPeriod = detail?.periods[0]?.reportPeriod
    const params = new URLSearchParams(searchParams)
    if (!latestPeriod || next === latestPeriod) params.delete('period')
    else params.set('period', next)
    setSearchParams(params, { replace: true })
  }

  if (loading && (!detail || detail.institution.slug !== slug)) {
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
  const showCost = !house && detail.positions.some(row => row.cost)

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
      <div className={`flex flex-col gap-2 border-b border-rule pb-4 pt-3.5 md:border-b-0 md:pb-6 md:pt-8 ${GUTTER}`}>
        <BackToList />
        <h1 className="m-0 font-serif-sc text-[17px] font-semibold text-ink md:text-[26px]">{institution.manager}</h1>
        {notice && <p role="status" className="m-0 text-[13px] text-danger">{notice}</p>}
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
              <p className="m-0 flex flex-wrap items-center gap-x-1">
                {detail.periods.length > 1 ? (
                  <label className="inline-flex items-center gap-1.5">
                    报告期
                    <select
                      aria-label="报告期"
                      value={periodQuery || period.reportPeriod}
                      disabled={loading}
                      onChange={event => choosePeriod(event.target.value)}
                      className="h-8 cursor-pointer rounded border border-edge bg-white pl-2 pr-1 text-[13px] text-ink hover:border-navy disabled:cursor-not-allowed"
                    >
                      {detail.periods.map(row => (
                        <option key={row.reportPeriod} value={row.reportPeriod}>{row.reportPeriod}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>报告期 <time dateTime={period.reportPeriod}>{period.reportPeriod}</time></>
                )}
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
            {detail.costSummary && <CostSummaryLine summary={detail.costSummary} />}
            {loading && <p className="m-0 text-[13px] text-ink-mute">加载中</p>}
            <PositionTable
              rows={detail.positions}
              showWeight
              byShares={!house}
              showChange={detail.previousPeriod !== null}
              showCost={showCost}
            />
            {detail.closed.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="m-0 font-serif-sc text-[16px] font-semibold text-ink">清仓</h2>
                <PositionTable
                  rows={detail.closed}
                  showWeight={false}
                  byShares={!house}
                  showChange={detail.previousPeriod !== null}
                  showCost={false}
                />
              </section>
            )}
          </>
        )}
      </main>

      <footer className={`mt-5 border-t border-rule pb-7 pt-4 text-[11px] leading-[1.6] text-ink-faint md:mt-6 md:pt-5 md:text-[12px] ${GUTTER}`}>
        {detail.valueNote}{' '}
        {detail.costNote
          ? `${detail.costNote}加仓、新建仓、高于成本为红，减仓、清仓、低于成本为绿。`
          : '申报没有买入成本，这里不算浮盈。加仓、新建仓为红，减仓、清仓为绿。'}
      </footer>
    </div>
  )
}
