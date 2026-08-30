import { useEffect, useState } from 'react'
import { api } from '../api'
import { shortDate } from '../lib/signalView'
import { DirectionBadge } from './DirectionBadge'
import type { SignalEventRow } from '../types'

/**
 * 最近 7 天发生的信号翻转。没有事件时整个不渲染,不占版面。
 *
 * 设计稿把改版前的蓝底 info 通知框换成了与研报列表同一套的纸感条:
 * 左边框 2px 墨黑,底 #F5F3EE(见「组件 3.2」)。外边距交给调用方,
 * 这样桌面端跟着主内容区的 40px 走、移动端跟着 18px 走。
 */
export function RecentSignalEvents({ version }: { version: number }) {
  const [events, setEvents] = useState<SignalEventRow[]>([])

  // version 由 useSignals 在每次成功 refresh 后自增 —— 单靠 [] 只在挂载时拉一次,
  // 扫描完横幅还是旧数据,得靠这个 dep 触发重新拉取
  useEffect(() => {
    let cancelled = false
    void api.listSignalEvents(7)
      .then(rows => { if (!cancelled) setEvents(rows) })
      .catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [version])

  if (events.length === 0) return null

  return (
    <section className="border border-[#E1DED7] border-l-2 border-l-ink bg-aside px-4 py-3.5 md:flex md:gap-10 md:px-[22px] md:py-[18px]">
      <div className="flex items-baseline justify-between md:w-[148px] md:shrink-0 md:flex-col md:items-start md:gap-1.5">
        <h2 className="m-0 font-serif-sc text-[14px] font-semibold text-ink md:text-[15px]">最近 7 天的信号</h2>
        <span className="text-[11px] text-ink-faint md:text-[12px]">{events.length} 条翻转</span>
      </div>

      <div className="mt-1.5 min-w-0 flex-1 md:mt-0">
        {events.map(e => (
          <div
            key={`${e.symbol}-${e.timeframe}-${e.bar_date}`}
            className="flex items-center gap-2 py-1 text-[11px] md:grid md:grid-cols-[104px_96px_60px_1fr] md:gap-5 md:border-b md:border-row-rule md:py-[7px] md:text-[12px] md:last:border-b-0"
          >
            <span className="hidden font-numeral text-[13px] text-ink-faint md:block">{e.bar_date}</span>
            <span className="w-[74px] shrink-0 text-[13px] font-medium text-ink md:w-auto md:text-[14px]">{e.symbol}</span>
            <span className="text-ink-mute">{e.timeframe === '1d' ? '日线' : '周线'}</span>
            {/* 移动端 contents 把徽章和价位摊回外层 flex,价位才能 ml-auto 靠右 */}
            <span className="contents md:flex md:items-center md:gap-3">
              <DirectionBadge
                trend={e.direction}
                label={e.direction === 1 ? '翻多' : '翻空'}
                className="text-[11px] md:text-[12px]"
              />
              <span className="ml-auto whitespace-nowrap font-numeral text-[12px] text-ink-faint md:ml-0 md:text-[14px] md:text-ink-soft">
                <span className="md:hidden">{shortDate(e.bar_date)} </span>@ {e.price.toFixed(2)}
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
