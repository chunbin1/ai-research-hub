import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons'
import type { EtfDailySummary, EtfResonanceLevel } from '../types'

interface TradeDatePickerProps {
  value: string | null
  availableDates: string[]
  timeline?: EtfDailySummary[]
  onChange: (date: string) => void
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

function parseYmd(ymd: string | null): { year: number; month: number } {
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1 }
}

function buildMonthGrid(year: number, month: number): Array<{ ymd: string; day: number; inMonth: boolean }> {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const cells: Array<{ ymd: string; day: number; inMonth: boolean }> = []

  const prev = shiftMonth(year, month, -1)
  const daysInPrev = new Date(Date.UTC(prev.year, prev.month, 0)).getUTCDate()
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = daysInPrev - i
    cells.push({ ymd: `${prev.year}-${pad2(prev.month)}-${pad2(d)}`, day: d, inMonth: false })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ ymd: `${year}-${pad2(month)}-${pad2(d)}`, day: d, inMonth: true })
  }

  const next = shiftMonth(year, month, 1)
  let nextDay = 1
  while (cells.length % 7 !== 0) {
    cells.push({ ymd: `${next.year}-${pad2(next.month)}-${pad2(nextDay)}`, day: nextDay, inMonth: false })
    nextDay++
  }
  return cells
}

function resonanceDotClass(level: EtfResonanceLevel | undefined): string | null {
  if (level === 'strong') return 'bg-brick'
  if (level === 'watch') return 'bg-warn-bar'
  return null
}

/**
 * 轻量无外部依赖交易日历选择器：
 * - 仅允许选择库内有数据的交易日，非交易日/无数据日置灰禁用
 * - 在日期下方用红/橙圆点提示「强托底共振 / 局部关注」日
 */
export function TradeDatePicker({ value, availableDates, timeline = [], onChange }: TradeDatePickerProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => parseYmd(value ?? availableDates[0] ?? null))
  const wrapRef = useRef<HTMLDivElement>(null)

  const availableSet = useMemo(() => new Set(availableDates), [availableDates])
  const resonanceByDate = useMemo(
    () => new Map(timeline.map(t => [t.trade_date, t.resonance_level])),
    [timeline],
  )
  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month])
  const latestDate = availableDates[0] ?? null

  useEffect(() => {
    if (open) {
      setView(parseYmd(value ?? availableDates[0] ?? null))
    }
  }, [open, value, availableDates])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const pickDate = (ymd: string) => {
    onChange(ymd)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        aria-label="选择历史交易日"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(cur => !cur)}
        className="flex cursor-pointer items-center gap-2 rounded-[4px] border border-edge bg-white px-2.5 py-1 font-numeral text-[12px] text-ink transition-colors hover:border-ink-faint"
      >
        <CalendarOutlined className="text-[12px] text-ink-mute" aria-hidden />
        <span>{value ?? '选择日期'}</span>
        <DownOutlined className={`text-[10px] text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="交易日历"
          className="absolute right-0 top-full z-30 mt-1.5 w-[280px] rounded-[4px] border border-rule bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between border-b border-row-rule pb-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="上一年"
                onClick={() => setView(v => shiftMonth(v.year, v.month, -12))}
                className="flex size-6 cursor-pointer items-center justify-center rounded-[3px] text-[11px] text-ink-mute hover:bg-aside hover:text-ink"
              >
                <DoubleLeftOutlined aria-hidden />
              </button>
              <button
                type="button"
                aria-label="上个月"
                onClick={() => setView(v => shiftMonth(v.year, v.month, -1))}
                className="flex size-6 cursor-pointer items-center justify-center rounded-[3px] text-[11px] text-ink-mute hover:bg-aside hover:text-ink"
              >
                <LeftOutlined aria-hidden />
              </button>
            </div>

            <span className="font-numeral text-[13px] font-semibold text-ink">
              {view.year}年{view.month}月
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="下个月"
                onClick={() => setView(v => shiftMonth(v.year, v.month, 1))}
                className="flex size-6 cursor-pointer items-center justify-center rounded-[3px] text-[11px] text-ink-mute hover:bg-aside hover:text-ink"
              >
                <RightOutlined aria-hidden />
              </button>
              <button
                type="button"
                aria-label="下一年"
                onClick={() => setView(v => shiftMonth(v.year, v.month, 12))}
                className="flex size-6 cursor-pointer items-center justify-center rounded-[3px] text-[11px] text-ink-mute hover:bg-aside hover:text-ink"
              >
                <DoubleRightOutlined aria-hidden />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] text-ink-faint">
            {WEEKDAYS.map(w => (
              <span key={w} className="py-1">{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {cells.map(cell => {
              const available = cell.inMonth && availableSet.has(cell.ymd)
              const selected = cell.ymd === value
              const dot = cell.inMonth ? resonanceDotClass(resonanceByDate.get(cell.ymd)) : null
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  aria-label={cell.ymd}
                  disabled={!available}
                  onClick={() => available && pickDate(cell.ymd)}
                  className={`relative flex h-8 flex-col items-center justify-center rounded-[3px] font-numeral text-[12px] transition-colors ${
                    !cell.inMonth
                      ? 'cursor-default text-ink-faint/35'
                      : selected
                        ? 'bg-navy font-semibold text-page'
                        : available
                          ? 'cursor-pointer font-medium text-ink hover:bg-aside'
                          : 'cursor-not-allowed text-ink-faint/55'
                  }`}
                >
                  <span className="leading-none">{cell.day}</span>
                  {dot && (
                    <span
                      aria-hidden
                      className={`mt-0.5 size-1 rounded-full ${selected ? 'bg-page' : dot}`}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-row-rule pt-2 text-[11px]">
            <div className="flex items-center gap-2 text-ink-faint">
              <span className="flex items-center gap-1"><i className="inline-block size-1.5 rounded-full bg-brick" />强托底</span>
              <span className="flex items-center gap-1"><i className="inline-block size-1.5 rounded-full bg-warn-bar" />关注</span>
            </div>
            {latestDate && (
              <button
                type="button"
                onClick={() => pickDate(latestDate)}
                className="cursor-pointer font-medium text-navy hover:text-brick"
              >
                最新交易日
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
