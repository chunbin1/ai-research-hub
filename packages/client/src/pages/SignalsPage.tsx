import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Popconfirm } from 'antd'
import {
  LoadingOutlined, PlusOutlined, ReloadOutlined, RightOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import { useSignals } from '../hooks/useSignals'
import { useAuth } from '../hooks/useAuth'
import { useIsMobile } from '../hooks/useIsMobile'
import { SiteHeader } from '../components/SiteHeader'
import { SignalLog } from '../components/SignalLog'
import { RecentSignalEvents } from '../components/RecentSignalEvents'
import { AddSymbolModal } from '../components/AddSymbolModal'
import { DirectionBadge } from '../components/DirectionBadge'
import {
  SIGNAL_FILTERS, WHIPSAW_THRESHOLD, dataAsOf, filterCounts, formatFlipDate, isNearStop,
  matchesFilter, shortDate, stopBarWidth, stopDistance,
} from '../lib/signalView'
import type { SignalFilterKey } from '../lib/signalView'
import type { SignalRow, SignalSide } from '../types'

/**
 * 信号追踪 —— 按 design_handoff_homepage 的信号稿重建。三处关键变更:
 * 1. 行高压缩,英文名单行截断(旧版折三行,一屏只看得到 3 支);
 * 2. 红绿统一表示方向(多 = 红、空 = 绿),不再和涨跌色打架;
 * 3. 「距止损」是安全垫不是涨跌 —— 去掉正负号,改中性色 + 进度条,不足 6% 才转橙。
 *
 * 表格换成 CSS grid 而不是 antd Table:设计稿的列宽、行内两行排版和整行展开
 * 都要按像素还原,Table 的单元格样式改起来比自己画一行更绕。移动端不横滑,
 * 一个标的一张卡(移动稿)。
 *
 * 设计稿里没有的旧功能(来源研报、近 90 天翻转次数、删除)收进展开区 ——
 * 都是看完一眼就不用的信息,占一列会把六个信号列挤扁。
 */

const CAPTION = 'SuperTrend 收盘口径,盘中不更新。信号用全复权价计算,现价显示原始未复权价。'

/**
 * 表头与数据行共用的列宽:平板 / 窄桌面 / 桌面三档(响应式说明.md「信号追踪」)。
 *
 * 「标的」列取 minmax 而不是设计稿的定值:按稿子的 168/190/226 加上其余定宽列,
 * 在各自断点的下沿(768 / 1024)算出来是 972 / 900,都超过可用宽度 —— 稿里的数字
 * 是按断点上沿画的。让标的列吃掉剩余空间,窄处英文名早点截断(稿子也说这是预期),
 * 宽处顺带把 1440 上限撑满,信号列的宽度始终照稿。
 */
const GRID = 'grid grid-cols-[24px_minmax(0,1fr)_104px_104px_96px_104px_96px] items-center gap-3'
  + ' lg:grid-cols-[24px_minmax(0,1fr)_128px_150px_128px_150px_128px] lg:gap-4'
  + ' xl:grid-cols-[24px_minmax(226px,1fr)_128px_172px_150px_172px_150px] xl:gap-5'

/** 主内容区左右内边距:移动 18 / 平板 28 / 桌面 40 */
const GUTTER = 'px-[18px] md:px-7 lg:px-10'

function DirectionCell({ side }: { side: SignalSide | null }) {
  if (!side) return <span className="text-[13px] text-ink-faint">—</span>
  return (
    <div className="flex flex-col items-start gap-1.5">
      <DirectionBadge trend={side.trend} label={side.trend === 1 ? '多' : '空'} className="text-[12px]" />
      {side.flipDate && (
        <span className="font-numeral text-[12px] text-ink-faint">
          {formatFlipDate(side.flipDate, side.barDate)} 起 {side.heldDays ?? '—'} 天
        </span>
      )}
    </div>
  )
}

function StopBar({ side }: { side: SignalSide }) {
  return (
    <span className="block h-[3px] w-[72px] bg-rule xl:w-[88px]" aria-hidden>
      <span
        className={`block h-full ${isNearStop(side) ? 'bg-warn-bar' : 'bg-ink-faint'}`}
        style={{ width: stopBarWidth(side) }}
      />
    </span>
  )
}

function StopCell({ side }: { side: SignalSide | null }) {
  if (!side) return <span className="block text-right text-[13px] text-ink-faint">—</span>
  const near = isNearStop(side)
  return (
    <div className="flex flex-col items-end gap-[5px]">
      <span className={`font-numeral text-[16px] font-semibold ${near ? 'text-warn' : 'text-ink'}`}>
        {stopDistance(side).toFixed(1)}%
      </span>
      <StopBar side={side} />
      <span className="font-numeral text-[11px] text-ink-faint">止损 {side.stopLine.toFixed(2)}</span>
    </div>
  )
}

/** 移动卡片里的一个周期格 */
function TimeframeBox({ label, side }: { label: string; side: SignalSide | null }) {
  const near = side != null && isNearStop(side)
  return (
    <div className={`flex flex-col gap-[7px] border bg-white px-3 py-2.5 ${near ? 'border-warn-edge' : 'border-rule'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-mute">{label}</span>
        {side
          ? <DirectionBadge trend={side.trend} label={side.trend === 1 ? '多' : '空'} className="text-[11px]" />
          : <span className="text-[12px] text-ink-faint">—</span>}
      </div>
      {side && (
        <>
          <div className="flex items-baseline gap-1.5">
            <span className={`font-numeral text-[16px] font-semibold ${near ? 'text-warn' : 'text-ink'}`}>
              {stopDistance(side).toFixed(1)}%
            </span>
            <span className={`text-[11px] ${near ? 'text-warn' : 'text-ink-faint'}`}>距止损</span>
          </div>
          <StopBar side={side} />
          <span className="font-numeral text-[10px] text-ink-faint">
            止损 {side.stopLine.toFixed(2)}
            {side.heldDays != null && ` · ${side.heldDays} 天`}
          </span>
        </>
      )}
    </div>
  )
}

/** 现价:异常标的这一格改讲原因,没有价格就不硬凑一个「—」以外的东西 */
function PriceCell({ row, className = '' }: { row: SignalRow; className?: string }) {
  if (row.status !== 'ok') {
    return <span className={`text-[12px] text-warn ${className}`}>{row.lastError ?? row.status}</span>
  }
  if (row.closeRaw == null) return <span className={`text-[13px] text-ink-faint ${className}`}>—</span>
  return (
    <span className={`flex items-baseline gap-1 ${className}`}>
      <span className="font-numeral text-[17px] font-semibold text-ink">{row.closeRaw.toFixed(2)}</span>
      <span className="text-[11px] text-ink-faint">{row.currency ?? ''}</span>
    </span>
  )
}

/** 代码 + 市场标签 */
function SymbolLine({ row, size }: { row: SignalRow; size: 'desktop' | 'mobile' }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[15px] font-medium text-ink">{row.symbol}</span>
      <span className={`shrink-0 border border-edge px-1.5 py-px text-ink-mute ${size === 'desktop' ? 'text-[11px]' : 'text-[10px]'}`}>
        {row.market === 'US' ? '美股' : '港股'}
      </span>
    </div>
  )
}

/**
 * 英文名 + 两个例外标记(背离 / 震荡)。标记跟着英文名走而不是跟着代码:
 * 代码那一行在平板宽度下只剩 110px 上下,再塞两个方框会把标签挤成竖排;
 * 名字这行本来就允许截断,标记不缩、名字先让位,正好。
 */
function MetaLine({ row, className = '' }: { row: SignalRow; className?: string }) {
  const whipsaw = row.daily != null && row.flips90d >= WHIPSAW_THRESHOLD
  if (!row.name && !row.divergent && !whipsaw) return null
  return (
    <div className={`mt-1 flex min-w-0 items-center gap-1.5 ${className}`}>
      {row.name && <span className="truncate text-ink-faint">{row.name}</span>}
      {row.divergent && (
        <span className="shrink-0 border border-warn-edge px-1.5 py-px text-warn" title="日线与周线方向背离">背离</span>
      )}
      {whipsaw && (
        <span className="shrink-0 border border-warn-edge px-1.5 py-px text-warn" title={`近 90 天翻转 ${row.flips90d} 次`}>
          震荡
        </span>
      )}
    </div>
  )
}

interface ListProps {
  rows: SignalRow[]
  loading: boolean
  /** 空态文案 —— 「一条都没有」和「筛掉了」不是一回事 */
  empty: string
  expanded: string | null
  onToggle: (symbol: string, expandable: boolean) => void
  renderDetail: (row: SignalRow) => ReactNode
}

/** 桌面 / 平板:七列表格,整行可点展开 */
function SignalTable({ rows, loading, empty, expanded, onToggle, renderDetail }: ListProps) {
  return (
    <div className="border-t border-ink">
      <div className={`${GRID} border-b border-rule py-3 text-[12px] tracking-[0.02em] text-ink-mute`}>
        <span aria-hidden />
        <span>标的</span>
        <span className="text-right">现价</span>
        <span>日线</span>
        <span className="text-right">距日线止损</span>
        <span>周线</span>
        <span className="text-right">距周线止损</span>
      </div>

      {loading && Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={`${GRID} border-b border-row-rule py-4`} aria-hidden>
          <span />
          {Array.from({ length: 6 }, (_, c) => (
            <span key={c} className="h-[34px] animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
          ))}
        </div>
      ))}

      {!loading && rows.map(r => {
        const expandable = r.status === 'ok'
        const open = expanded === r.symbol
        return (
          <div key={r.symbol} className="border-b border-row-rule last:border-b-0">
            <div
              className={`${GRID} py-4 transition-colors ${expandable ? 'cursor-pointer hover:bg-aside' : ''}`}
              onClick={() => onToggle(r.symbol, expandable)}
            >
              {expandable
                ? (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-label={`展开 ${r.symbol} 的历史翻转记录`}
                    onClick={e => { e.stopPropagation(); onToggle(r.symbol, true) }}
                    className="text-[14px] leading-none text-ink-faint"
                  >
                    <RightOutlined className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
                  </button>
                )
                : <span aria-hidden />}

              <div className="min-w-0">
                <SymbolLine row={r} size="desktop" />
                <MetaLine row={r} className="text-[12px]" />
              </div>

              <PriceCell row={r} className="justify-end text-right" />
              <DirectionCell side={r.daily} />
              <StopCell side={r.daily} />
              <DirectionCell side={r.weekly} />
              <StopCell side={r.weekly} />
            </div>

            {open && renderDetail(r)}
          </div>
        )
      })}

      {!loading && rows.length === 0 && <p className="py-6 text-[13px] text-ink-faint">{empty}</p>}
    </div>
  )
}

/** 移动端:一个标的一张卡 —— 六列表格横滑要来回拖才对得上一行,卡片能两周期同屏对比 */
function SignalCards({ rows, loading, empty, expanded, onToggle, renderDetail }: ListProps) {
  return (
    <div className="border-t border-ink">
      {loading && Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 border-b border-row-rule py-[15px]" aria-hidden>
          <span className="h-[30px] w-1/2 animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
          <span className="h-[86px] animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
        </div>
      ))}

      {!loading && rows.map(r => {
        const expandable = r.status === 'ok'
        return (
          <article key={r.symbol} className="border-b border-row-rule last:border-b-0">
            <div
              className={`flex flex-col gap-3 py-[15px] ${expandable ? 'cursor-pointer' : ''}`}
              onClick={() => onToggle(r.symbol, expandable)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <SymbolLine row={r} size="mobile" />
                  <MetaLine row={r} className="text-[11px]" />
                </div>
                <PriceCell row={r} className="shrink-0" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <TimeframeBox label="日线" side={r.daily} />
                <TimeframeBox label="周线" side={r.weekly} />
              </div>
            </div>
            {expanded === r.symbol && renderDetail(r)}
          </article>
        )
      })}

      {!loading && rows.length === 0 && <p className="py-6 text-[13px] text-ink-faint">{empty}</p>}
    </div>
  )
}

export default function SignalsPage() {
  const { rows, loading, scanning, error, scan, extract, version, lastScan, add, remove } = useSignals()
  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const isMobile = useIsMobile()
  const [addOpen, setAddOpen] = useState(false)
  const [filter, setFilter] = useState<SignalFilterKey>('all')
  /** 同时只展开一行 —— 展开区里是一张 60 行的日志表,多开几行就找不着北了 */
  const [expanded, setExpanded] = useState<string | null>(null)

  const counts = useMemo(() => filterCounts(rows), [rows])
  const visible = useMemo(() => rows.filter(r => matchesFilter(r, filter)), [rows, filter])
  const asOf = useMemo(() => dataAsOf(rows), [rows])
  const empty = rows.length === 0
    ? '还没有自选股 —— 上传一篇标题里带股票代码的研报,或点「重新抽取」'
    : '没有符合这个筛选的标的'

  const toggle = (symbol: string, expandable: boolean) => {
    if (expandable) setExpanded(cur => (cur === symbol ? null : symbol))
  }

  /** 展开区:设计稿之外的三样东西(来源、翻转次数、删除)+ 历史日志 */
  const detail = (r: SignalRow) => (
    <div className="border-t border-row-rule bg-aside px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-mute">
        {r.sourceDoc && (
          <span>
            来源{' '}
            <Link to={`/reports/${r.sourceDoc.id}`} className="text-navy hover:text-brick" onClick={e => e.stopPropagation()}>
              {r.sourceDoc.filename}
            </Link>
          </span>
        )}
        {r.daily && (
          <span className={r.flips90d >= WHIPSAW_THRESHOLD ? 'text-warn' : undefined}>
            近 90 天翻转 {r.flips90d} 次{r.flips90d >= WHIPSAW_THRESHOLD ? ' · 震荡' : ''}
          </span>
        )}
        {isAdmin && (
          <span className="ml-auto" onClick={e => e.stopPropagation()}>
            <Popconfirm
              title={`确定删除 ${r.symbol}？`}
              description="该标的的历史日志会一并清除,恢复后需要重新扫描。"
              okText="确定"
              cancelText="取消"
              okButtonProps={{ autoInsertSpace: false }}
              cancelButtonProps={{ autoInsertSpace: false }}
              onConfirm={() => void remove(r.symbol)}
            >
              <button type="button" className="text-[12px] text-danger">删除</button>
            </Popconfirm>
          </span>
        )}
      </div>
      <SignalLog symbol={r.symbol} version={version} />
    </div>
  )

  return (
    <div className="flex min-h-screen flex-col bg-page font-sans-sc text-ink">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        <SiteHeader active="/signals" mobile={{ backTo: '/', title: '信号追踪' }} />

        {/* 标题区。移动端标题已经在顶栏里,这里只剩口径说明和操作按钮 */}
        <div className={`flex flex-col gap-3.5 border-b border-rule pb-4 pt-3.5 md:flex-row md:items-end md:justify-between md:gap-10 md:border-b-0 md:pb-6 md:pt-8 ${GUTTER}`}>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 hidden font-serif-sc text-[26px] font-semibold text-ink md:block">信号追踪</h1>
            <p className="m-0 max-w-[640px] text-[12px] leading-[1.65] text-ink-mute md:text-[13px] md:leading-[1.6]">
              {CAPTION}
            </p>
          </div>

          {isAdmin && (
            <div className="flex shrink-0 gap-2.5">
              <button
                type="button"
                aria-label="添加标的"
                onClick={() => setAddOpen(true)}
                className="flex size-11 items-center justify-center rounded-[4px] border border-edge bg-white text-[15px] text-ink-soft hover:border-ink-faint lg:size-auto lg:gap-2 lg:px-[15px] lg:py-[9px] lg:text-[13px]"
              >
                <PlusOutlined className="text-[15px] lg:text-[13px]" aria-hidden />
                <span className="hidden lg:inline">添加标的</span>
              </button>
              <button
                type="button"
                aria-label="重新抽取"
                disabled={scanning}
                onClick={() => void extract()}
                className="flex size-11 items-center justify-center rounded-[4px] border border-edge bg-white text-[15px] text-ink-soft hover:border-ink-faint disabled:opacity-50 lg:size-auto lg:gap-2 lg:px-[15px] lg:py-[9px] lg:text-[13px]"
              >
                {scanning
                  ? <LoadingOutlined className="text-[15px] lg:text-[13px]" aria-hidden />
                  : <ReloadOutlined className="text-[15px] lg:text-[13px]" aria-hidden />}
                <span className="hidden lg:inline">重新抽取</span>
              </button>
              <button
                type="button"
                disabled={scanning}
                onClick={() => void scan()}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[4px] bg-ink text-[13px] font-medium text-page disabled:opacity-60 md:h-auto md:flex-none md:px-[17px] md:py-2.5"
              >
                {scanning
                  ? <LoadingOutlined className="text-[13px]" aria-hidden />
                  : <ThunderboltOutlined className="text-[13px]" aria-hidden />}
                {scanning ? '扫描中…' : '立即扫描'}
              </button>
            </div>
          )}
        </div>

        {(error || lastScan) && (
          <div className={`flex flex-col gap-1.5 pt-3 text-[13px] md:pt-0 md:pb-4 ${GUTTER}`}>
            {error && <p className="m-0 text-danger">{error}</p>}
            {lastScan && (
              <p className={`m-0 ${lastScan.failed > 0 ? 'text-warn' : 'text-ink-mute'}`}>
                扫描完成:共 {lastScan.total},成功 {lastScan.ok},失败 {lastScan.failed},数据不足 {lastScan.insufficient}
              </p>
            )}
          </div>
        )}

        <div className={`pt-4 md:pb-6 md:pt-0 ${GUTTER}`}>
          <RecentSignalEvents version={version} />
        </div>

        {/* 筛选胶囊行。市场与方向是两组,但只单选一项 —— 选中态只有一个填充胶囊,
            与移动端首页的板块筛选保持同一套心智 */}
        <div className={`flex items-center justify-between gap-4 pt-4 md:pb-6 md:pt-0 ${GUTTER}`}>
          <div className="hide-scrollbar -mx-[18px] flex items-center gap-[7px] overflow-x-auto px-[18px] md:mx-0 md:flex-wrap md:px-0">
            {SIGNAL_FILTERS.map((f, i) => (
              <span key={f.key} className="contents">
                {/* 市场组与方向组之间的竖分隔线 */}
                {f.group === 'trend' && SIGNAL_FILTERS[i - 1]?.group === 'market' && (
                  <span className="mx-1.5 h-5 w-px shrink-0 bg-rule" aria-hidden />
                )}
                <button
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`tap-44 shrink-0 whitespace-nowrap rounded-full border px-[13px] py-1.5 text-[12px] ${
                    filter === f.key
                      ? 'border-navy bg-navy text-page'
                      : 'border-edge bg-white text-ink-soft hover:border-ink-faint'
                  }`}
                >
                  {f.label} {counts[f.key]}
                </button>
              </span>
            ))}
          </div>
          {asOf && (
            <span className="hidden shrink-0 whitespace-nowrap text-[12px] text-ink-faint md:block">
              数据截至 {asOf} 收盘
            </span>
          )}
        </div>

        {/* 移动端的计数行(桌面版这两条信息在栏目头与筛选行里) */}
        <div className={`flex items-baseline justify-between pb-2 pt-3 md:hidden ${GUTTER}`}>
          <span className="text-[12px] text-ink-mute">共 {visible.length} 个标的</span>
          {asOf && <span className="font-numeral text-[11px] text-ink-faint">截至 {shortDate(asOf)} 收盘</span>}
        </div>

        <main className={`flex-1 ${GUTTER}`}>
          {/* 桌面七列表格与移动卡片是两套结构,二选一渲染而不是各画一份用 md: 藏起来:
              展开区里的 SignalLog 会自己拉一次日志,两份 DOM 就是两次请求。 */}
          {isMobile
            ? (
              <SignalCards
                rows={visible}
                loading={loading}
                empty={empty}
                expanded={expanded}
                onToggle={toggle}
                renderDetail={detail}
              />
            )
            : (
              <SignalTable
                rows={visible}
                loading={loading}
                empty={empty}
                expanded={expanded}
                onToggle={toggle}
                renderDetail={detail}
              />
            )}
        </main>

        <footer className={`mt-5 flex flex-col gap-1.5 border-t border-rule pb-7 pt-4 text-[11px] text-ink-faint md:mt-6 md:flex-row md:gap-[18px] md:pt-5 md:text-[12px] ${GUTTER}`}>
          <span>多 / 空 = SuperTrend 方向</span>
          <span className="hidden md:inline" aria-hidden>·</span>
          <span>距止损 = 现价到止损位的距离,橙色表示不足 6%</span>
          <span className="hidden md:inline" aria-hidden>·</span>
          <span className="hidden md:inline">展开行可查看历史翻转记录</span>
          <span className="md:hidden">点击标的可查看历史翻转记录</span>
        </footer>

        {isAdmin && (
          <AddSymbolModal
            open={addOpen}
            onCancel={() => setAddOpen(false)}
            onConfirm={add}
          />
        )}
      </div>
    </div>
  )
}
