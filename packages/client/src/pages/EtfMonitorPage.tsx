import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Modal, Popconfirm } from 'antd'
import {
  CloseOutlined, LoadingOutlined, PlusOutlined, RightOutlined, SearchOutlined,
  SettingOutlined, ThunderboltOutlined,
} from '@ant-design/icons'
import { fetchEtfCodeHistory } from '../api'
import { useAuth } from '../hooks/useAuth'
import { useEtfMonitor } from '../hooks/useEtfMonitor'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  DATA_STAGE_LABEL,
  ETF_FILTERS,
  ETF_TIER_ORDER,
  RESONANCE_META,
  SIGNAL_LEVEL_META,
  TIER_LABEL,
  filterEtfCounts,
  formatAmountYuanToYi,
  formatPct,
  formatPremium,
  formatRatio,
  formatYi,
  matchesEtfFilter,
  matchesEtfQuery,
  sortEtfRows,
  volBarWidth,
} from '../lib/etfView'
import type { EtfFilterKey, EtfSortKey } from '../lib/etfView'
import type {
  EtfBoardRow,
  EtfDailyMetric,
  EtfDailySummary,
  EtfMonitorParams,
  EtfResonanceLevel,
  EtfSignalLevel,
  EtfTier,
  EtfUniverseEntry,
} from '../types'

const GUTTER = 'px-[18px] md:px-7 lg:px-10'
const GRID = 'grid grid-cols-[24px_minmax(0,1.4fr)_86px_118px_98px_98px_96px] items-center gap-3'
  + ' lg:grid-cols-[24px_minmax(0,1.6fr)_104px_148px_118px_118px_108px] lg:gap-4'
  + ' xl:grid-cols-[24px_minmax(220px,1.8fr)_116px_176px_132px_132px_116px] xl:gap-5'

function resonanceClasses(level: EtfResonanceLevel): string {
  switch (level) {
    case 'strong':
      return 'border-long-edge bg-long-wash text-long'
    case 'watch':
      return 'border-warn-edge bg-[#FDF7ED] text-warn'
    case 'none':
      return 'border-edge bg-aside text-ink-soft'
  }
}

function signalClasses(level: EtfSignalLevel): string {
  switch (level) {
    case 'strong_support':
      return 'border-long-edge bg-long-wash text-long'
    case 'inflow_only':
      return 'border-warn-edge bg-[#FDF7ED] text-warn'
    case 'volume_only':
      return 'border-navy-edge bg-navy-wash text-navy'
    case 'normal':
      return 'border-edge bg-white text-ink-mute'
  }
}

function timelineBarColor(level: EtfResonanceLevel): string {
  switch (level) {
    case 'strong':
      return 'bg-brick'
    case 'watch':
      return 'bg-warn-bar'
    case 'none':
      return 'bg-edge'
  }
}

function barHeightPx(day: EtfDailySummary, maxAmount: number): number {
  if (day.aggregate_vol_ratio != null && day.aggregate_vol_ratio > 0) {
    const ratioClamped = Math.min(Math.max(day.aggregate_vol_ratio, 0.5), 3.5)
    return Math.round(12 + ((ratioClamped - 0.5) / 3.0) * 32)
  }
  if (maxAmount > 0) {
    return Math.round(12 + Math.min(day.total_amount_yi / maxAmount, 1) * 32)
  }
  return 16
}

function pctToneClass(val: number | null): string {
  if (val === null || val === 0) return 'text-ink-soft'
  return val > 0 ? 'text-long' : 'text-short'
}

function EtfRowDetail({
  row,
  refreshToken,
  isAdmin,
  onUpdateTier,
  onDisable,
  onDelete,
}: {
  row: EtfBoardRow
  refreshToken: string | null
  isAdmin: boolean
  onUpdateTier: (code: string, tier: EtfTier) => Promise<string | null>
  onDisable: (code: string) => Promise<string | null>
  onDelete: (code: string) => Promise<string | null>
}) {
  const [history, setHistory] = useState<EtfDailyMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    void fetchEtfCodeHistory(row.code, 15)
      .then(res => {
        if (!cancelled) setHistory(res.history)
      })
      .catch(e => {
        if (!cancelled) setErr(e instanceof Error ? e.message : '历史明细加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [row.code, refreshToken])

  return (
    <div className="border-t border-row-rule bg-aside px-4 py-4" onClick={e => e.stopPropagation()}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink-mute">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>{row.market === 'SH' ? '上交所' : '深交所'} · {row.code}</span>
          <span>梯队：{TIER_LABEL[row.tier]}</span>
          {row.metric?.share_delta != null && (
            <span className="font-numeral">
              份额变动 {row.metric.share_delta > 0 ? '+' : ''}{(row.metric.share_delta / 1e8).toFixed(2)}亿份
            </span>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
              <span>梯队</span>
              <select
                aria-label={`调整 ${row.code} 梯队`}
                disabled={busy}
                value={row.tier}
                onChange={async e => {
                  setBusy(true)
                  await onUpdateTier(row.code, e.target.value as EtfTier)
                  setBusy(false)
                }}
                className="rounded-[4px] border border-edge bg-white px-2 py-1 text-[12px] text-ink"
              >
                {ETF_TIER_ORDER.map(t => (
                  <option key={t} value={t}>{TIER_LABEL[t]}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onDisable(row.code)
                setBusy(false)
              }}
              className="rounded-[4px] border border-edge bg-white px-2.5 py-1 text-[12px] text-ink-soft hover:border-ink-faint disabled:opacity-50"
            >
              停用
            </button>
            <Popconfirm
              title={`确定彻底删除 ${row.code}（${row.name}）？`}
              description="该 ETF 的历史日度数据会一并删除；若只是暂不跟踪建议使用「停用」。"
              okText="确定"
              cancelText="取消"
              okButtonProps={{ autoInsertSpace: false }}
              cancelButtonProps={{ autoInsertSpace: false }}
              onConfirm={async () => {
                setBusy(true)
                await onDelete(row.code)
                setBusy(false)
              }}
            >
              <button type="button" disabled={busy} className="text-[12px] text-danger disabled:opacity-50">
                删除
              </button>
            </Popconfirm>
          </div>
        )}
      </div>

      {loading && <p className="m-0 text-[12px] text-ink-faint">加载近 15 日走势…</p>}
      {!loading && err && <p className="m-0 text-[12px] text-danger">{err}</p>}
      {!loading && !err && history.length === 0 && (
        <p className="m-0 text-[12px] text-ink-faint">暂无历史记录</p>
      )}
      {!loading && !err && history.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-rule text-ink-mute">
                <th className="py-1.5 pr-3 font-normal">日期</th>
                <th className="py-1.5 pr-3 text-right font-normal">收盘 / 涨跌</th>
                <th className="py-1.5 pr-3 text-right font-normal">成交额</th>
                <th className="py-1.5 pr-3 text-right font-normal">20日放量</th>
                <th className="py-1.5 pr-3 text-right font-normal">溢价率</th>
                <th className="py-1.5 pr-3 text-right font-normal">净申购</th>
                <th className="py-1.5 font-normal">状态</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 15).map(item => {
                const sig = SIGNAL_LEVEL_META[item.signal_level]
                return (
                  <tr key={item.trade_date} className="border-b border-row-rule last:border-b-0">
                    <td className="py-1.5 pr-3 font-numeral text-ink-soft">{item.trade_date}</td>
                    <td className="py-1.5 pr-3 text-right font-numeral">
                      <span className="text-ink">{item.close.toFixed(3)}</span>{' '}
                      <span className={pctToneClass(item.pct_change)}>{formatPct(item.pct_change)}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-numeral text-ink-soft">
                      {formatAmountYuanToYi(item.amount)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-numeral text-ink">
                      {formatRatio(item.vol_ratio_20)}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-numeral ${pctToneClass(item.premium_rate)}`}>
                      {formatPremium(item.premium_rate)}
                      {item.nav_source === 'iopv' && (
                        <span className="ml-1 rounded-[2px] border border-edge bg-white px-1 text-[10px] text-ink-mute">
                          IOPV
                        </span>
                      )}
                    </td>
                    <td className={`py-1.5 pr-3 text-right font-numeral ${pctToneClass(item.net_inflow_yi)}`}>
                      {formatYi(item.net_inflow_yi, true)}
                    </td>
                    <td className="py-1.5">
                      <span className={`inline-block rounded-[3px] border px-1.5 py-px text-[11px] ${signalClasses(item.signal_level)}`}>
                        {sig.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface TableProps {
  rows: EtfBoardRow[]
  loading: boolean
  empty: string
  groupByTier: boolean
  volRatioThreshold: number
  expanded: string | null
  onToggle: (code: string) => void
  renderDetail: (row: EtfBoardRow) => ReactNode
}

function EtfTable({ rows, loading, empty, groupByTier, volRatioThreshold, expanded, onToggle, renderDetail }: TableProps) {
  let prevTier: EtfTier | null = null
  return (
    <div className="border-t border-ink">
      <div className={`${GRID} border-b border-rule py-3 text-[12px] tracking-[0.02em] text-ink-mute`}>
        <span aria-hidden />
        <span>ETF 标的</span>
        <span className="text-right">收盘 / 涨跌</span>
        <span>成交额与放量</span>
        <span className="text-right">收盘溢价率</span>
        <span className="text-right">净申购估算</span>
        <span>当日状态</span>
      </div>

      {loading && Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`${GRID} border-b border-row-rule py-3.5`} aria-hidden>
          <span />
          {Array.from({ length: 6 }, (_, c) => (
            <span key={c} className="h-[40px] animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
          ))}
        </div>
      ))}

      {!loading && rows.map(r => {
        const showGroupHeader = groupByTier && r.tier !== prevTier
        prevTier = r.tier
        const open = expanded === r.code
        const m = r.metric
        const sig = m ? SIGNAL_LEVEL_META[m.signal_level] : null
        return (
          <div key={r.code} className="border-b border-row-rule last:border-b-0">
            {showGroupHeader && (
              <div className="border-b border-row-rule bg-aside/60 px-2 py-1.5 text-[11px] font-medium tracking-[0.04em] text-ink-mute">
                {TIER_LABEL[r.tier]}
              </div>
            )}
            <div
              className={`${GRID} cursor-pointer py-3.5 transition-colors hover:bg-aside`}
              onClick={() => onToggle(r.code)}
            >
              <button
                type="button"
                aria-expanded={open}
                aria-label={`展开 ${r.code} 历史走势`}
                onClick={e => { e.stopPropagation(); onToggle(r.code) }}
                className="text-[13px] leading-none text-ink-faint"
              >
                <RightOutlined className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-numeral text-[15px] font-medium text-ink">{r.code}</span>
                  <span className="truncate text-[14px] text-ink">{r.name}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                  <span className="border border-edge bg-white px-1.5 py-px text-ink-mute">{TIER_LABEL[r.tier]}</span>
                  <span>{r.market === 'SH' ? '沪市' : '深市'}</span>
                </div>
              </div>

              <div className="text-right">
                {m ? (
                  <>
                    <div className="font-numeral text-[15px] font-semibold text-ink">{m.close.toFixed(3)}</div>
                    <div className={`font-numeral text-[12px] ${pctToneClass(m.pct_change)}`}>
                      {formatPct(m.pct_change)}
                    </div>
                  </>
                ) : <span className="text-[12px] text-ink-faint">—</span>}
              </div>

              <div className="flex flex-col gap-1">
                {m ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2 font-numeral text-[13px]">
                      <span className="text-ink-soft">{formatAmountYuanToYi(m.amount)}</span>
                      <span className={`font-semibold ${m.vol_ratio_20 != null && m.vol_ratio_20 >= volRatioThreshold ? 'text-long' : 'text-ink'}`}>
                        {formatRatio(m.vol_ratio_20)}
                      </span>
                    </div>
                    <span className="block h-[3px] w-full bg-rule" aria-hidden>
                      <span
                        className={`block h-full ${m.vol_ratio_20 != null && m.vol_ratio_20 >= volRatioThreshold ? 'bg-brick' : 'bg-ink-faint'}`}
                        style={{ width: volBarWidth(m.vol_ratio_20) }}
                      />
                    </span>
                  </>
                ) : <span className="text-[12px] text-ink-faint">—</span>}
              </div>

              <div className="text-right">
                {m ? (
                  <div className="flex items-center justify-end gap-1">
                    <span className={`font-numeral text-[14px] font-medium ${pctToneClass(m.premium_rate)}`}>
                      {formatPremium(m.premium_rate)}
                    </span>
                    {m.nav_source === 'iopv' && (
                      <span
                        title="收盘官方净值尚未公布，当前按实时 IOPV 估算"
                        className="rounded-[2px] border border-edge bg-aside px-1 py-px text-[10px] text-ink-mute"
                      >
                        IOPV
                      </span>
                    )}
                  </div>
                ) : <span className="text-[12px] text-ink-faint">—</span>}
              </div>

              <div className="text-right">
                {m ? (
                  <span className={`font-numeral text-[14px] font-semibold ${pctToneClass(m.net_inflow_yi)}`}>
                    {formatYi(m.net_inflow_yi, true)}
                  </span>
                ) : <span className="text-[12px] text-ink-faint">—</span>}
              </div>

              <div>
                {sig ? (
                  <span className={`inline-block rounded-[3px] border px-2 py-0.5 text-[11px] ${signalClasses(m!.signal_level)}`}>
                    {sig.label}
                  </span>
                ) : <span className="text-[12px] text-ink-faint">待扫描</span>}
              </div>
            </div>

            {open && renderDetail(r)}
          </div>
        )
      })}

      {!loading && rows.length === 0 && <p className="py-6 text-[13px] text-ink-faint">{empty}</p>}
    </div>
  )
}

function EtfCards({ rows, loading, empty, expanded, onToggle, renderDetail }: Omit<TableProps, 'groupByTier' | 'volRatioThreshold'>) {
  return (
    <div className="border-t border-ink">
      {loading && Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5 border-b border-row-rule py-4" aria-hidden>
          <span className="h-[24px] w-2/3 animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
          <span className="h-[64px] animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" />
        </div>
      ))}

      {!loading && rows.map(r => {
        const m = r.metric
        const sig = m ? SIGNAL_LEVEL_META[m.signal_level] : null
        const open = expanded === r.code
        return (
          <article key={r.code} className="border-b border-row-rule last:border-b-0">
            <div className="flex flex-col gap-2.5 py-3.5" onClick={() => onToggle(r.code)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-numeral text-[15px] font-medium text-ink">{r.code}</span>
                    <span className="truncate text-[14px] font-medium text-ink">{r.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
                    <span className="border border-edge bg-white px-1.5 py-px text-ink-mute">{TIER_LABEL[r.tier]}</span>
                    {sig && (
                      <span className={`rounded-[3px] border px-1.5 py-px ${signalClasses(m!.signal_level)}`}>
                        {sig.label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {m ? (
                    <>
                      <div className="font-numeral text-[15px] font-semibold text-ink">{m.close.toFixed(3)}</div>
                      <div className={`font-numeral text-[11px] ${pctToneClass(m.pct_change)}`}>
                        {formatPct(m.pct_change)}
                      </div>
                    </>
                  ) : <span className="text-[12px] text-ink-faint">待扫描</span>}
                </div>
              </div>

              {m && (
                <div className="grid grid-cols-3 gap-2 border border-rule bg-white px-2.5 py-2 text-[12px]">
                  <div>
                    <div className="text-[10px] text-ink-faint">成交 / 放量</div>
                    <div className="font-numeral font-semibold text-ink">
                      {formatAmountYuanToYi(m.amount)} · {formatRatio(m.vol_ratio_20)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-ink-faint">溢价率</div>
                    <div className={`font-numeral font-medium ${pctToneClass(m.premium_rate)}`}>
                      {formatPremium(m.premium_rate)}
                      {m.nav_source === 'iopv' && (
                        <span className="ml-1 border border-edge px-1 text-[9px] text-ink-mute">IOPV</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-ink-faint">净申购</div>
                    <div className={`font-numeral font-semibold ${pctToneClass(m.net_inflow_yi)}`}>
                      {formatYi(m.net_inflow_yi, true)}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`展开 ${r.code} 历史走势`}
                  onClick={e => { e.stopPropagation(); onToggle(r.code) }}
                  className="text-[11px] text-navy"
                >
                  {open ? '收起 15 日走势' : '查看 15 日走势'}
                </button>
              </div>
            </div>
            {open && renderDetail(r)}
          </article>
        )
      })}

      {!loading && rows.length === 0 && <p className="py-6 text-[13px] text-ink-faint">{empty}</p>}
    </div>
  )
}

function ParamsModal({
  open,
  params,
  onCancel,
  onSave,
}: {
  open: boolean
  params: EtfMonitorParams
  onCancel: () => void
  onSave: (patch: Partial<EtfMonitorParams>) => Promise<string | null>
}) {
  const [volRatio, setVolRatio] = useState(String(params.volRatioThreshold))
  const [premium, setPremium] = useState(String(params.premiumThreshold))
  const [inflow, setInflow] = useState(String(params.inflowThresholdYi))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setVolRatio(String(params.volRatioThreshold))
      setPremium(String(params.premiumThreshold))
      setInflow(String(params.inflowThresholdYi))
      setErr(null)
    }
  }, [open, params])

  const submit = async () => {
    const v = Number(volRatio)
    const p = Number(premium)
    const inf = Number(inflow)
    if (!Number.isFinite(v) || !Number.isFinite(p) || !Number.isFinite(inf)) {
      setErr('请输入有效数字')
      return
    }
    setSaving(true)
    const msg = await onSave({
      volRatioThreshold: v,
      premiumThreshold: p,
      inflowThresholdYi: inf,
    })
    setSaving(false)
    if (msg) setErr(msg)
    else onCancel()
  }

  return (
    <Modal
      open={open}
      title="托底判定阈值设置"
      onCancel={onCancel}
      onOk={() => void submit()}
      okText="保存并重算"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      destroyOnHidden
    >
      <div className="flex flex-col gap-3 py-2 text-[13px]">
        <label className="flex flex-col gap-1">
          <span className="text-ink-soft">20 日放量倍数阈值（默认 1.8x）</span>
          <input
            type="number"
            step="0.1"
            value={volRatio}
            onChange={e => setVolRatio(e.target.value)}
            className="rounded-[4px] border border-edge px-3 py-1.5 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-soft">收盘溢价率阈值 %（默认 0.05%）</span>
          <input
            type="number"
            step="0.01"
            value={premium}
            onChange={e => setPremium(e.target.value)}
            className="rounded-[4px] border border-edge px-3 py-1.5 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-soft">单只净申购阈值（亿元，默认 5.0）</span>
          <input
            type="number"
            step="0.5"
            value={inflow}
            onChange={e => setInflow(e.target.value)}
            className="rounded-[4px] border border-edge px-3 py-1.5 text-ink"
          />
        </label>
        {err && <p className="m-0 text-[12px] text-danger">{err}</p>}
      </div>
    </Modal>
  )
}

function ManageUniverseModal({
  open,
  disabledUniverse,
  onCancel,
  onAdd,
  onRestore,
}: {
  open: boolean
  disabledUniverse: EtfUniverseEntry[]
  onCancel: () => void
  onAdd: (code: string, tier: EtfTier) => Promise<string | null>
  onRestore: (code: string) => Promise<string | null>
}) {
  const [code, setCode] = useState('')
  const [tier, setTier] = useState<EtfTier>('mega')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCode('')
      setErr(null)
    }
  }, [open])

  const submitAdd = async () => {
    const trimmed = code.trim()
    if (!/^\d{6}$/.test(trimmed)) {
      setErr('请输入 6 位沪深 ETF 代码')
      return
    }
    setSubmitting(true)
    setErr(null)
    const msg = await onAdd(trimmed, tier)
    setSubmitting(false)
    if (msg) setErr(msg)
    else setCode('')
  }

  return (
    <Modal
      open={open}
      title="管理监控 ETF 标的池"
      onCancel={onCancel}
      footer={null}
      destroyOnHidden
    >
      <div className="flex flex-col gap-4 py-2 text-[13px]">
        <div className="flex flex-col gap-2 rounded-[4px] border border-rule bg-aside p-3">
          <span className="font-medium text-ink">新增 ETF（自动校验名称并回溯历史）</span>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              aria-label="ETF 代码"
              placeholder="6位代码如 510300"
              value={code}
              onChange={e => setCode(e.target.value)}
              className="min-w-[140px] flex-1 rounded-[4px] border border-edge bg-white px-2.5 py-1.5 text-ink"
            />
            <select
              aria-label="选择梯队"
              value={tier}
              onChange={e => setTier(e.target.value as EtfTier)}
              className="rounded-[4px] border border-edge bg-white px-2.5 py-1.5 text-ink"
            >
              {ETF_TIER_ORDER.map(t => (
                <option key={t} value={t}>{TIER_LABEL[t]}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submitAdd()}
              className="rounded-[4px] bg-ink px-3 py-1.5 text-page disabled:opacity-50"
            >
              {submitting ? '添加中…' : '添加 ETF'}
            </button>
          </div>
          {err && <p className="m-0 text-[12px] text-danger">{err}</p>}
        </div>

        <div>
          <div className="mb-2 text-[12px] font-medium text-ink-mute">
            已停用标的（{disabledUniverse.length}）
          </div>
          {disabledUniverse.length === 0 ? (
            <p className="m-0 text-[12px] text-ink-faint">当前没有已停用的 ETF</p>
          ) : (
            <div className="flex flex-col divide-y divide-row-rule rounded-[4px] border border-rule bg-white">
              {disabledUniverse.map(entry => (
                <div key={entry.code} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <span className="font-numeral font-medium text-ink">{entry.code}</span>{' '}
                    <span className="text-ink-soft">{entry.name}</span>{' '}
                    <span className="text-[11px] text-ink-faint">({TIER_LABEL[entry.tier]})</span>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitting(true)
                      const msg = await onRestore(entry.code)
                      setSubmitting(false)
                      if (msg) setErr(msg)
                    }}
                    className="rounded-[4px] border border-navy-edge bg-navy-wash px-2.5 py-1 text-[12px] text-navy hover:border-navy disabled:opacity-50"
                  >
                    恢复启用
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function EtfMonitorPage() {
  const {
    board,
    timeline,
    selectedDate,
    selectDate,
    loading,
    boardLoading,
    scanning,
    disabled,
    error,
    lastScanResult,
    scan,
    addEtf,
    updateEtf,
    deleteEtf,
    saveParams,
  } = useEtfMonitor()

  const { user } = useAuth()
  const isAdmin = user?.isAdmin === true
  const isMobile = useIsMobile()

  const [filter, setFilter] = useState<EtfFilterKey>('all')
  const [sortKey, setSortKey] = useState<EtfSortKey>('default')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [timelineDays, setTimelineDays] = useState<60 | 90>(60)
  const [paramsOpen, setParamsOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const rows = board?.rows ?? []
  const searched = useMemo(() => rows.filter(r => matchesEtfQuery(r, query)), [rows, query])
  const counts = useMemo(() => filterEtfCounts(searched), [searched])
  const visible = useMemo(() => {
    const filtered = searched.filter(r => matchesEtfFilter(r, filter))
    return sortEtfRows(filtered, sortKey)
  }, [searched, filter, sortKey])

  const visibleTimeline = useMemo(() => timeline.slice(-timelineDays), [timeline, timelineDays])
  const maxTimelineAmount = useMemo(
    () => visibleTimeline.reduce((max, d) => Math.max(max, d.total_amount_yi), 0),
    [visibleTimeline],
  )

  const summary = board?.summary ?? null
  const activeDate = summary?.trade_date ?? selectedDate ?? null
  const resonance = summary ? RESONANCE_META[summary.resonance_level] : null
  const empty = rows.length === 0
    ? '还没有可展示的 ETF 数据，请管理员点击「立即扫描」或等待盘后定时扫描'
    : query.trim() !== '' && searched.length === 0
      ? `没有匹配「${query.trim()}」的 ETF`
      : '当前筛选下没有符合条件的宽基 ETF'

  if (disabled) {
    return (
      <div className={`mx-auto flex w-full max-w-[1440px] flex-1 flex-col py-10 ${GUTTER}`}>
        <div className="rounded-[4px] border border-rule bg-white px-6 py-8 text-center">
          <h1 className="m-0 font-serif-sc text-[20px] font-semibold text-ink">ETF 托底监控未启用</h1>
          <p className="mt-2 mb-0 text-[13px] text-ink-mute">
            服务端当前通过环境变量关闭了 A 股宽基 ETF 托底监控（ETF_MONITOR=off）。
          </p>
        </div>
      </div>
    )
  }

  const toggleExpand = (code: string) => {
    setExpanded(cur => (cur === code ? null : code))
  }

  const detailRefreshToken = [
    board?.lastScanAt ?? '',
    board?.summary?.updated_at ?? '',
    board?.params.volRatioThreshold ?? '',
    board?.params.premiumThreshold ?? '',
    board?.params.inflowThresholdYi ?? '',
  ].join('|')

  const renderDetail = (r: EtfBoardRow) => (
    <EtfRowDetail
      row={r}
      refreshToken={detailRefreshToken}
      isAdmin={isAdmin}
      onUpdateTier={(code, tier) => updateEtf(code, { tier })}
      onDisable={code => updateEtf(code, { enabled: false })}
      onDelete={deleteEtf}
    />
  )

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
      {/* 标题与管理员动作区 */}
      <div className={`flex flex-col gap-3.5 border-b border-rule pb-4 pt-3.5 md:flex-row md:items-end md:justify-between md:gap-8 md:border-b-0 md:pb-5 md:pt-8 ${GUTTER}`}>
        <div className="flex flex-col gap-2">
          <h1 className="m-0 font-serif-sc text-[18px] font-semibold text-ink md:text-[26px]">
            国家队托底监控
          </h1>
          <p className="m-0 max-w-[700px] text-[12px] leading-[1.65] text-ink-mute md:text-[13px] md:leading-[1.6]">
            A 股核心宽基 ETF 盘后三维监控：20 日均额放量 + 收盘溢价率 + 场内份额净申赎，识别多梯队真金白银托底共振。
          </p>
        </div>

        {isAdmin && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setParamsOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-[4px] border border-edge bg-white px-3 text-[13px] text-ink-soft hover:border-ink-faint"
            >
              <SettingOutlined aria-hidden />
              <span>参数设置</span>
            </button>
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              className="flex h-10 items-center gap-1.5 rounded-[4px] border border-edge bg-white px-3 text-[13px] text-ink-soft hover:border-ink-faint"
            >
              <PlusOutlined aria-hidden />
              <span>管理标的</span>
            </button>
            <button
              type="button"
              disabled={scanning}
              onClick={() => void scan()}
              className="flex h-10 items-center gap-1.5 rounded-[4px] bg-ink px-4 text-[13px] font-medium text-page disabled:opacity-60"
            >
              {scanning ? <LoadingOutlined aria-hidden /> : <ThunderboltOutlined aria-hidden />}
              <span>{scanning ? '扫描中…' : '立即扫描'}</span>
            </button>
          </div>
        )}
      </div>

      {(error || lastScanResult) && (
        <div className={`flex flex-col gap-1 pb-3 text-[13px] ${GUTTER}`}>
          {error && <p className="m-0 text-danger">{error}</p>}
          {lastScanResult && (
            <p className={`m-0 ${lastScanResult.failed > 0 ? 'text-warn' : 'text-ink-mute'}`}>
              扫描完成：共 {lastScanResult.total} 只，成功 {lastScanResult.ok} 只，失败 {lastScanResult.failed} 只
              {lastScanResult.latestDate ? `（最新交易日 ${lastScanResult.latestDate}）` : ''}
            </p>
          )}
        </div>
      )}

      {/* 顶部总览卡 */}
      <section className={`pb-5 ${GUTTER}`}>
        <div className="rounded-[4px] border border-rule bg-white p-4 md:p-5">
          {loading ? (
            <div className="h-[104px] animate-skeleton rounded-sm bg-[#EDEAE4] motion-reduce:animate-none" aria-hidden />
          ) : summary && resonance ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-row-rule pb-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className={`rounded-[3px] border px-2.5 py-0.5 text-[13px] font-semibold ${resonanceClasses(summary.resonance_level)}`}>
                    {resonance.label}
                  </span>
                  <span className="font-numeral text-[14px] font-medium text-ink">
                    {summary.trade_date}
                  </span>
                  <span className="rounded-[3px] border border-edge bg-aside px-2 py-0.5 text-[11px] text-ink-soft">
                    {DATA_STAGE_LABEL[summary.data_stage]}
                  </span>
                  {boardLoading && <span className="text-[11px] text-ink-faint">切换中…</span>}
                </div>

                <div className="flex items-center gap-2 text-[12px]">
                  {selectedDate && board?.availableDates[0] && selectedDate !== board.availableDates[0] && (
                    <button
                      type="button"
                      onClick={() => selectDate(undefined)}
                      className="text-navy hover:text-brick"
                    >
                      回到最新
                    </button>
                  )}
                  {board && board.availableDates.length > 0 && (
                    <select
                      aria-label="选择历史交易日"
                      value={activeDate ?? ''}
                      onChange={e => selectDate(e.target.value || undefined)}
                      className="rounded-[4px] border border-edge bg-white px-2 py-1 font-numeral text-[12px] text-ink"
                    >
                      {board.availableDates.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="mt-3.5 grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <div className="text-[11px] text-ink-mute">触发托底宽基</div>
                  <div className="mt-1 font-numeral text-[22px] font-semibold text-ink">
                    {summary.support_etf_count} / {summary.active_count} 只
                  </div>
                  <div className="text-[11px] text-ink-faint">其中放量 {summary.volume_spike_count} 只</div>
                </div>
                <div>
                  <div className="text-[11px] text-ink-mute">覆盖风格梯队</div>
                  <div className="mt-1 font-numeral text-[22px] font-semibold text-ink">
                    {summary.support_tier_count} / 4 个梯队
                  </div>
                  <div className="text-[11px] text-ink-faint">{resonance.desc}</div>
                </div>
                <div>
                  <div className="text-[11px] text-ink-mute">合计成交额 / 整体放量</div>
                  <div className="mt-1 flex items-baseline gap-2 font-numeral">
                    <span className="text-[22px] font-semibold text-ink">
                      {formatYi(summary.total_amount_yi)}
                    </span>
                    <span className="text-[14px] text-ink-soft">
                      {formatRatio(summary.aggregate_vol_ratio)}
                    </span>
                  </div>
                  <div className="text-[11px] text-ink-faint">相对近 20 日均额</div>
                </div>
                <div>
                  <div className="text-[11px] text-ink-mute">合计净申购估算</div>
                  <div className={`mt-1 font-numeral text-[22px] font-semibold ${pctToneClass(summary.total_net_inflow_yi)}`}>
                    {formatYi(summary.total_net_inflow_yi, true)}
                  </div>
                  <div className="text-[11px] text-ink-faint">场内份额变动 × 净值</div>
                </div>
              </div>
            </>
          ) : (
            <p className="m-0 text-[13px] text-ink-mute">
              尚无收盘汇总数据，请先执行一次扫描（首次会自动回溯近 90 个交易日）。
            </p>
          )}
        </div>
      </section>

      {/* 历史共振时间轴 */}
      {visibleTimeline.length > 0 && (
        <section className={`pb-5 ${GUTTER}`}>
          <div className="rounded-[4px] border border-rule bg-white px-4 py-3">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 text-[12px] text-ink-mute">
                <span className="font-medium text-ink">历史共振时间轴</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 bg-brick" />强托底</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 bg-warn-bar" />局部关注</span>
                <span className="flex items-center gap-1"><i className="inline-block size-2 bg-edge" />常规</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  aria-pressed={timelineDays === 60}
                  onClick={() => setTimelineDays(60)}
                  className={`rounded-[3px] border px-2 py-0.5 ${timelineDays === 60 ? 'border-navy bg-navy text-page' : 'border-edge text-ink-soft'}`}
                >
                  近60日
                </button>
                <button
                  type="button"
                  aria-pressed={timelineDays === 90}
                  onClick={() => setTimelineDays(90)}
                  className={`rounded-[3px] border px-2 py-0.5 ${timelineDays === 90 ? 'border-navy bg-navy text-page' : 'border-edge text-ink-soft'}`}
                >
                  近90日
                </button>
              </div>
            </div>

            <div className="hide-scrollbar flex h-[50px] items-end gap-[3px] overflow-x-auto pb-1">
              {visibleTimeline.map(day => {
                const isSelected = day.trade_date === activeDate
                const tip = `${day.trade_date} · ${RESONANCE_META[day.resonance_level].label} · 触发 ${day.support_etf_count} 只 · 净申购 ${formatYi(day.total_net_inflow_yi, true)}`
                return (
                  <button
                    key={day.trade_date}
                    type="button"
                    aria-label={tip}
                    title={tip}
                    onClick={() => selectDate(day.trade_date)}
                    className={`min-w-[6px] flex-1 rounded-t-[2px] transition-opacity hover:opacity-80 ${timelineBarColor(day.resonance_level)} ${
                      isSelected ? 'ring-2 ring-ink ring-offset-1' : ''
                    }`}
                    style={{ height: `${barHeightPx(day, maxTimelineAmount)}px` }}
                  />
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* 筛选、搜索与排序 */}
      <div className={`flex flex-col gap-3 pb-4 md:flex-row md:items-center md:justify-between md:gap-4 ${GUTTER}`}>
        <div className="hide-scrollbar -mx-[18px] flex items-center gap-[7px] overflow-x-auto px-[18px] md:mx-0 md:flex-wrap md:px-0">
          {ETF_FILTERS.map(f => (
            <button
              key={f.key}
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
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 md:w-[196px] md:flex-none">
            <SearchOutlined
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              aria-label="搜索 ETF"
              placeholder="搜索代码或名称"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
              className="h-9 w-full rounded-[4px] border border-edge bg-white pl-9 pr-8 text-[13px] text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
            {query !== '' && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-[11px] leading-none text-ink-faint hover:text-ink-soft"
              >
                <CloseOutlined aria-hidden />
              </button>
            )}
          </div>

          <select
            aria-label="排序方式"
            value={sortKey}
            onChange={e => setSortKey(e.target.value as EtfSortKey)}
            className="h-9 rounded-[4px] border border-edge bg-white px-2.5 text-[12px] text-ink-soft"
          >
            <option value="default">按梯队分组</option>
            <option value="vol_ratio_20">按放量倍数</option>
            <option value="premium_rate">按溢价率</option>
            <option value="net_inflow_yi">按净申购</option>
            <option value="amount">按成交额</option>
          </select>
        </div>
      </div>

      {/* 主表格 / 卡片列表 */}
      <main className={`flex-1 ${GUTTER}`}>
        {isMobile ? (
          <EtfCards
            rows={visible}
            loading={loading}
            empty={empty}
            expanded={expanded}
            onToggle={toggleExpand}
            renderDetail={renderDetail}
          />
        ) : (
          <EtfTable
            rows={visible}
            loading={loading}
            empty={empty}
            groupByTier={sortKey === 'default'}
            volRatioThreshold={board?.params.volRatioThreshold ?? 1.8}
            expanded={expanded}
            onToggle={toggleExpand}
            renderDetail={renderDetail}
          />
        )}
      </main>

      <footer className={`mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-rule pb-7 pt-4 text-[11px] text-ink-faint md:text-[12px] ${GUTTER}`}>
        <span>盘后三波扫描（北京时间 15:10 初算 · 20:00 官方净值 · 次日 08:45 补齐份额）</span>
        <span>·</span>
        <span>IOPV 标记表示当日官方净值尚未公布，溢价率暂按实时 IOPV 估算</span>
        <span>·</span>
        <span>点击任意行可展开近 15 个交易日走势</span>
      </footer>

      {isAdmin && board && (
        <>
          <ParamsModal
            open={paramsOpen}
            params={board.params}
            onCancel={() => setParamsOpen(false)}
            onSave={saveParams}
          />
          <ManageUniverseModal
            open={manageOpen}
            disabledUniverse={board.disabledUniverse}
            onCancel={() => setManageOpen(false)}
            onAdd={addEtf}
            onRestore={code => updateEtf(code, { enabled: true })}
          />
        </>
      )}
    </div>
  )
}
